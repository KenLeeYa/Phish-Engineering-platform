import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const source = path.resolve(argument("--database") ?? "");
const output = path.resolve(argument("--output") ?? "");
if (!argument("--database") || !argument("--output")) {
  throw new Error("Usage: node scripts/backup-database.mjs --database <source.sqlite> --output <new-backup.sqlite>");
}
if (source === output) throw new Error("Backup output must differ from the source database.");
if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("Source database does not exist.");
if (fs.existsSync(output)) throw new Error("Backup output already exists; choose a new immutable file name.");
if (!/\.(?:sqlite|db)$/i.test(output)) throw new Error("Backup output must use .sqlite or .db extension.");
const outputDirectory = path.dirname(output);
if (outputDirectory === path.parse(outputDirectory).root) throw new Error("Refusing to write a backup directly to a filesystem root.");

await fsPromises.mkdir(outputDirectory, { recursive: true });
const database = new DatabaseSync(source, { readOnly: true });
try {
  const escapedOutput = output.replaceAll("'", "''");
  database.exec(`VACUUM INTO '${escapedOutput}'`);
} finally {
  database.close();
}

const verification = new DatabaseSync(output, { readOnly: true });
try {
  const quickCheck = verification.prepare("PRAGMA quick_check").get();
  if (Object.values(quickCheck ?? {})[0] !== "ok") throw new Error("Backup quick_check failed.");
} finally {
  verification.close();
}
const content = await fsPromises.readFile(output);
process.stdout.write(`${JSON.stringify({
  source,
  output,
  sizeBytes: content.length,
  sha256: crypto.createHash("sha256").update(content).digest("hex"),
  verified: true,
}, null, 2)}\n`);
