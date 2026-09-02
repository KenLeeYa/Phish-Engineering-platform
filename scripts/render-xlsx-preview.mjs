import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : "";
const sheetName = process.argv[4] || "摘要";
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/render-xlsx-preview.mjs <input.xlsx> <output.png> [sheet-name]");
}
const candidates = [
  process.env.SEA_ARTIFACT_TOOL_MODULE,
  path.resolve("node_modules/@oai/artifact-tool/dist/artifact_tool.mjs"),
].filter(Boolean);
const modulePath = candidates.find((candidate) => fs.existsSync(candidate));
if (!modulePath) throw new Error("@oai/artifact-tool runtime not found.");
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(modulePath).href);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const inspection = await workbook.inspect({
  kind: "sheet,formula,drawing",
  sheetId: sheetName,
  range: "A1:L30",
  maxChars: 6_000,
  options: { maxResults: 100 },
});
const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
await fsPromises.writeFile(outputPath, new Uint8Array(await preview.arrayBuffer()));
process.stdout.write(`${JSON.stringify({ inputPath, outputPath, sheetName, inspection }, null, 2)}\n`);
