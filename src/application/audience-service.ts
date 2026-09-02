import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import type { PlatformSettings } from "../domain/settings.js";
import {
  SpreadsheetInputLimitError,
  SpreadsheetRuntime,
  SpreadsheetRuntimeUnavailableError,
} from "../infrastructure/spreadsheet-runtime.js";
import {
  ContentConflictError,
  ContentNotFoundError,
  ContentStore,
  type RecipientRecordInput,
} from "../infrastructure/content-store.js";
import { AppError, type PublicUser } from "./platform-service.js";

const MAX_CSV_BYTES = 1024 * 1024;
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HEADER_ALIASES = {
  email: ["email", "e-mail", "電子郵件", "郵件地址", "信箱"],
  displayName: ["姓名", "受測人", "name", "displayname", "display_name"],
  department: ["部門", "department", "dept"],
  businessUnit: ["部群", "事業群", "businessunit", "business_unit", "unit"],
};

type RosterLayout = "headered" | "headerless_department_name_email_unit";

interface ParsedRoster {
  recipients: RecipientRecordInput[];
  layout: RosterLayout;
  totalRows: number;
  skippedRows: number;
  duplicateRows: number;
  rowErrors: Array<{ row: number; reason: string }>;
}

function recordFrom(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_INPUT", "輸入格式不正確。");
  }
  return value as Record<string, unknown>;
}

function textField(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  optional = false,
): string {
  if (typeof value !== "string") throw new AppError(400, "INVALID_INPUT", `${label}格式不正確。`);
  const normalized = value.trim();
  if (optional && !normalized) return "";
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new AppError(400, "INVALID_INPUT", `${label}長度必須介於 ${minimum} 到 ${maximum} 個字元。`);
  }
  return normalized;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function headerIndex(headers: string[], aliases: string[]): number {
  const normalizedAliases = aliases.map(normalizedHeader);
  return headers.findIndex((header) => normalizedAliases.includes(normalizedHeader(header)));
}

function boundedCell(row: string[], index: number, maximum: number): string {
  if (index < 0) return "";
  return String(row[index] ?? "").trim().slice(0, maximum);
}

function detectHeaderlessReferenceLayout(rows: string[][]): {
  layout: RosterLayout;
  dataStartIndex: number;
  indexes: { email: number; displayName: number; department: number; businessUnit: number };
} | null {
  if (rows.length < 2) return null;
  const sample = rows.slice(0, Math.min(rows.length, 50));
  const populatedRatio = (column: number) =>
    sample.filter((row) => boundedCell(row, column, 4_096)).length / sample.length;
  const emailRatio =
    sample.filter((row) => EMAIL_PATTERN.test(boundedCell(row, 2, 254).toLowerCase())).length /
    sample.length;
  if (
    emailRatio < 0.9 ||
    populatedRatio(0) < 0.8 ||
    populatedRatio(1) < 0.8 ||
    populatedRatio(3) < 0.8
  ) {
    return null;
  }
  return {
    layout: "headerless_department_name_email_unit",
    dataStartIndex: 0,
    indexes: { department: 0, displayName: 1, email: 2, businessUnit: 3 },
  };
}

export function parseRosterCsv(csvText: string, allowedDomains: string[]): ParsedRoster {
  if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) {
    throw new AppError(413, "CSV_TOO_LARGE", "CSV 超過 1 MB 上限。");
  }

  let rows: string[][];
  try {
    rows = parse(csvText, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      max_record_size: 64 * 1024,
    }) as string[][];
  } catch {
    throw new AppError(400, "INVALID_CSV", "CSV 格式無法解析，請確認編碼、引號與分隔符號。");
  }
  return parseRosterRows(rows, allowedDomains);
}

export function parseRosterRows(inputRows: unknown[][], allowedDomains: string[]): ParsedRoster {
  const rows = inputRows
    .map((row) => row.map((value) => String(value ?? "").trim()))
    .filter((row) => row.some(Boolean));
  if (!rows.length) throw new AppError(400, "EMPTY_CSV", "名單沒有可匯入的資料。");

  const headers = rows[0] ?? [];
  let indexes = {
    email: headerIndex(headers, HEADER_ALIASES.email),
    displayName: headerIndex(headers, HEADER_ALIASES.displayName),
    department: headerIndex(headers, HEADER_ALIASES.department),
    businessUnit: headerIndex(headers, HEADER_ALIASES.businessUnit),
  };
  let layout: RosterLayout = "headered";
  let dataStartIndex = 1;
  if (indexes.email < 0) {
    const detected = detectHeaderlessReferenceLayout(rows);
    if (!detected) {
      throw new AppError(
        400,
        "MISSING_EMAIL_COLUMN",
        "名單缺少 Email 標題，且不符合無標題 A=部門、B=姓名、C=Email、D=部群／廠區格式。",
      );
    }
    ({ indexes, layout, dataStartIndex } = detected);
  }
  const totalRows = rows.length - dataStartIndex;
  if (!totalRows) throw new AppError(400, "EMPTY_CSV", "名單必須包含至少一筆資料。");
  if (totalRows > MAX_ROWS) throw new AppError(413, "TOO_MANY_ROWS", `名單最多 ${MAX_ROWS} 筆資料。`);

  const allowed = new Set(allowedDomains.map((domain) => domain.toLowerCase()));
  const accepted = new Map<string, RecipientRecordInput>();
  const rowErrors: ParsedRoster["rowErrors"] = [];
  let skippedRows = 0;
  let duplicateRows = 0;

  for (let index = dataStartIndex; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const sourceRow = index + 1;
    const email = boundedCell(row, indexes.email, 254).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      skippedRows += 1;
      if (rowErrors.length < 50) rowErrors.push({ row: sourceRow, reason: "Email 格式不正確" });
      continue;
    }
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (!allowed.has(domain)) {
      skippedRows += 1;
      if (rowErrors.length < 50) rowErrors.push({ row: sourceRow, reason: "不在內部收件網域" });
      continue;
    }

    if (accepted.has(email)) duplicateRows += 1;
    accepted.set(email, {
      id: crypto.randomUUID(),
      email,
      emailNormalized: email,
      displayName: boundedCell(row, indexes.displayName, 120) || email.slice(0, email.indexOf("@")),
      department: boundedCell(row, indexes.department, 120),
      businessUnit: boundedCell(row, indexes.businessUnit, 120),
    });
  }

  return {
    recipients: [...accepted.values()],
    layout,
    totalRows,
    skippedRows,
    duplicateRows,
    rowErrors,
  };
}

export class AudienceService {
  constructor(
    private readonly store: ContentStore,
    private readonly getSettings: () => PlatformSettings,
    private readonly spreadsheets = new SpreadsheetRuntime(),
  ) {}

  listGroups() {
    return this.store.listRecipientGroups();
  }

  createGroup(user: PublicUser, input: unknown) {
    const record = recordFrom(input);
    const name = textField(record.name, "群組名稱", 2, 100);
    const description = textField(record.description ?? "", "群組說明", 0, 500, true);
    try {
      return this.store.createRecipientGroup({
        id: crypto.randomUUID(),
        name,
        nameNormalized: name.toLowerCase(),
        description,
        userId: user.id,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof ContentConflictError) {
        throw new AppError(409, "GROUP_CONFLICT", error.message);
      }
      throw error;
    }
  }

  getGroup(groupId: string) {
    try {
      return this.store.getRecipientGroup(groupId);
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new AppError(404, "GROUP_NOT_FOUND", error.message);
      }
      throw error;
    }
  }

  importCsv(user: PublicUser, groupId: string, input: unknown) {
    const record = recordFrom(input);
    if (typeof record.csvText !== "string") {
      throw new AppError(400, "INVALID_INPUT", "缺少 CSV 文字內容。");
    }
    const recipientDomains = this.getSettings().scope.recipientDomains;
    if (!recipientDomains.length) {
      throw new AppError(409, "RECIPIENT_SCOPE_REQUIRED", "請先在設定頁建立內部收件網域。");
    }

    const parsed = parseRosterCsv(record.csvText, recipientDomains);
    if (!parsed.recipients.length) {
      throw new AppError(400, "NO_VALID_RECIPIENTS", "CSV 沒有符合內部網域且格式正確的收件人。");
    }
    try {
      const stored = this.store.importRecipients({
        groupId,
        recipients: parsed.recipients,
        userId: user.id,
        occurredAt: new Date().toISOString(),
        quality: {
          layout: parsed.layout,
          totalRows: parsed.totalRows,
          skippedRows: parsed.skippedRows,
          duplicateRows: parsed.duplicateRows,
        },
      });
      return {
        ...stored,
        totalRows: parsed.totalRows,
        acceptedRows: parsed.recipients.length,
        layout: parsed.layout,
        skippedRows: parsed.skippedRows,
        duplicateRows: parsed.duplicateRows,
        rowErrors: parsed.rowErrors,
        group: this.store.getRecipientGroup(groupId),
      };
    } catch (error) {
      if (error instanceof ContentNotFoundError) {
        throw new AppError(404, "GROUP_NOT_FOUND", error.message);
      }
      throw error;
    }
  }

  async importXlsx(user: PublicUser, groupId: string, buffer: Buffer) {
    if (!buffer.length) throw new AppError(400, "EMPTY_XLSX", "XLSX 檔案內容為空。");
    if (buffer.length > MAX_XLSX_BYTES) throw new AppError(413, "XLSX_TOO_LARGE", "XLSX 超過 5 MB 上限。");
    if (buffer.subarray(0, 4).toString("hex") !== "504b0304") {
      throw new AppError(400, "INVALID_XLSX", "檔案不是有效的 XLSX ZIP 容器。");
    }
    const recipientDomains = this.getSettings().scope.recipientDomains;
    if (!recipientDomains.length) {
      throw new AppError(409, "RECIPIENT_SCOPE_REQUIRED", "請先在設定頁建立內部收件網域。");
    }
    let rows: unknown[][];
    try {
      rows = await this.spreadsheets.readFirstWorksheet(buffer);
    } catch (error) {
      if (error instanceof SpreadsheetRuntimeUnavailableError) {
        throw new AppError(503, "SPREADSHEET_RUNTIME_REQUIRED", error.message);
      }
      if (error instanceof SpreadsheetInputLimitError) {
        throw new AppError(413, "XLSX_LIMIT_REJECTED", error.message);
      }
      throw new AppError(400, "INVALID_XLSX", "XLSX 無法解析，請確認工作簿未損壞且第一個工作表為名單。");
    }
    const parsed = parseRosterRows(rows, recipientDomains);
    if (!parsed.recipients.length) {
      throw new AppError(400, "NO_VALID_RECIPIENTS", "XLSX 沒有符合內部網域且格式正確的收件人。");
    }
    try {
      const stored = this.store.importRecipients({
        groupId,
        recipients: parsed.recipients,
        userId: user.id,
        occurredAt: new Date().toISOString(),
        quality: {
          sourceType: "xlsx",
          layout: parsed.layout,
          totalRows: parsed.totalRows,
          skippedRows: parsed.skippedRows,
          duplicateRows: parsed.duplicateRows,
        },
      });
      return {
        ...stored,
        totalRows: parsed.totalRows,
        acceptedRows: parsed.recipients.length,
        layout: parsed.layout,
        skippedRows: parsed.skippedRows,
        duplicateRows: parsed.duplicateRows,
        rowErrors: parsed.rowErrors,
        group: this.store.getRecipientGroup(groupId),
      };
    } catch (error) {
      if (error instanceof ContentNotFoundError) throw new AppError(404, "GROUP_NOT_FOUND", error.message);
      throw error;
    }
  }
}
