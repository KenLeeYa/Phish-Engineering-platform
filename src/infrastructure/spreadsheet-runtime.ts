import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "../config.js";

interface ArtifactModule {
  FileBlob: { load(filePath: string): Promise<unknown> };
  SpreadsheetFile: {
    importXlsx(input: unknown): Promise<ArtifactWorkbook>;
    exportXlsx(workbook: ArtifactWorkbook): Promise<{ save(filePath: string): Promise<void> }>;
  };
  Workbook: { create(): ArtifactWorkbook };
}

interface ArtifactWorkbook {
  worksheets: {
    add(name: string): ArtifactSheet;
    getItem(name: string): ArtifactSheet;
    getItemAt(index: number): ArtifactSheet;
  };
  inspect(input: Record<string, unknown>): Promise<unknown>;
  render(input: Record<string, unknown>): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

interface ArtifactSheet {
  showGridLines: boolean;
  getUsedRange(valuesOnly?: boolean): { values: unknown[][] } | null;
  getRange(address: string): any;
  getRangeByIndexes(row: number, column: number, rowCount: number, columnCount: number): any;
  freezePanes: { freezeRows(count: number): void };
  charts: { add(type: string, source: unknown): any };
  tables: { add(address: string, headers: boolean, name: string): any };
  mergeCells(address: string): void;
}

export class SpreadsheetRuntimeUnavailableError extends Error {}
export class SpreadsheetInputLimitError extends Error {}

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 500;
const MAX_WORKSHEET_ROWS = 50_000;
const MAX_WORKSHEET_COLUMNS = 64;
const MAX_WORKSHEET_CELLS = 750_000;
const MAX_CELL_TEXT = 4_096;

export function validateXlsxContainer(buffer: Buffer): void {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new SpreadsheetInputLimitError("檔案不是有效的 XLSX ZIP 容器。");
  }
  const searchStart = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetInputLimitError("XLSX 缺少 ZIP 中央目錄。");
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new SpreadsheetInputLimitError("不支援多磁碟或 ZIP64 XLSX。");
  }
  if (!entryCount || entryCount > MAX_ZIP_ENTRIES) {
    throw new SpreadsheetInputLimitError(`XLSX 壓縮項目最多 ${MAX_ZIP_ENTRIES} 筆。`);
  }
  if (centralOffset + centralSize > eocd || centralOffset + centralSize > buffer.length) {
    throw new SpreadsheetInputLimitError("XLSX 中央目錄範圍不正確。");
  }

  let offset = centralOffset;
  let totalUncompressed = 0;
  const names = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw new SpreadsheetInputLimitError("XLSX 中央目錄項目不完整。");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) throw new SpreadsheetInputLimitError("XLSX 中央目錄長度不正確。");
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if ((flags & 0x1) !== 0) throw new SpreadsheetInputLimitError("不支援加密的 XLSX。");
    if (!name || name.startsWith("/") || name.startsWith("\\") || name.split(/[\\/]/).includes("..")) {
      throw new SpreadsheetInputLimitError("XLSX 包含不安全的壓縮項目路徑。");
    }
    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new SpreadsheetInputLimitError("XLSX 單一項目解壓後超過 32 MB。");
    }
    if (uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_EXPANSION_RATIO)) {
      throw new SpreadsheetInputLimitError("XLSX 壓縮展開比例異常。");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new SpreadsheetInputLimitError("XLSX 解壓後總大小超過 64 MB。");
    }
    names.add(name);
    offset = end;
  }
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) {
    throw new SpreadsheetInputLimitError("ZIP 容器不是有效的 XLSX 工作簿。");
  }
  if ([...names].some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) {
    throw new SpreadsheetInputLimitError("不接受含 VBA 專案的工作簿。");
  }
}

function validateWorksheetValues(values: unknown[][]): void {
  if (values.length > MAX_WORKSHEET_ROWS) {
    throw new SpreadsheetInputLimitError(`工作表最多 ${MAX_WORKSHEET_ROWS} 列。`);
  }
  let cellCount = 0;
  for (const row of values) {
    if (!Array.isArray(row) || row.length > MAX_WORKSHEET_COLUMNS) {
      throw new SpreadsheetInputLimitError(`工作表最多 ${MAX_WORKSHEET_COLUMNS} 欄。`);
    }
    cellCount += row.length;
    if (cellCount > MAX_WORKSHEET_CELLS) {
      throw new SpreadsheetInputLimitError(`工作表最多 ${MAX_WORKSHEET_CELLS} 個儲存格。`);
    }
    if (row.some((value) => typeof value === "string" && value.length > MAX_CELL_TEXT)) {
      throw new SpreadsheetInputLimitError(`單一儲存格文字最多 ${MAX_CELL_TEXT} 個字元。`);
    }
  }
}

function candidateModules(): string[] {
  const configured = process.env.SEA_ARTIFACT_TOOL_MODULE?.trim();
  return [
    configured ?? "",
    path.join(PROJECT_ROOT, "node_modules", "@oai", "artifact-tool", "dist", "artifact_tool.mjs"),
  ].filter(Boolean);
}

async function loadArtifactModule(): Promise<ArtifactModule> {
  const modulePath = candidateModules().find((candidate) => fs.existsSync(candidate));
  if (!modulePath) {
    throw new SpreadsheetRuntimeUnavailableError(
      "找不到 @oai/artifact-tool。請在一次性部署設定中安裝報表 runtime，或設定 SEA_ARTIFACT_TOOL_MODULE。",
    );
  }
  return (await import(pathToFileURL(modulePath).href)) as ArtifactModule;
}

export class SpreadsheetRuntime {
  async readFirstWorksheet(buffer: Buffer, preferredName?: string): Promise<unknown[][]> {
    validateXlsxContainer(buffer);
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sea-xlsx-"));
    const inputPath = path.join(directory, "input.xlsx");
    try {
      await fsPromises.writeFile(inputPath, buffer, { mode: 0o600 });
      const artifact = await loadArtifactModule();
      const blob = await artifact.FileBlob.load(inputPath);
      const workbook = await artifact.SpreadsheetFile.importXlsx(blob);
      let sheet: ArtifactSheet;
      try {
        sheet = preferredName ? workbook.worksheets.getItem(preferredName) : workbook.worksheets.getItemAt(0);
      } catch {
        sheet = workbook.worksheets.getItemAt(0);
      }
      const values = sheet.getUsedRange(true)?.values ?? [];
      validateWorksheetValues(values);
      return values;
    } finally {
      await fsPromises.rm(directory, { recursive: true, force: true });
    }
  }

  async createWorkbook(): Promise<{ artifact: ArtifactModule; workbook: ArtifactWorkbook }> {
    const artifact = await loadArtifactModule();
    return { artifact, workbook: artifact.Workbook.create() };
  }
}

export type { ArtifactModule, ArtifactSheet, ArtifactWorkbook };
