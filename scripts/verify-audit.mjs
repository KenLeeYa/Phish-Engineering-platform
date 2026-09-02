import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const positional = process.argv.slice(2).find((value) => !value.startsWith("--"));
const inputPath = positional ? path.resolve(positional) : "";
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const expectedFinalHash = argument("--expected-final-hash")?.toLowerCase();
if (!inputPath) {
  throw new Error("Usage: node scripts/verify-audit.mjs <audit-export.json> [--expected-final-hash <sha256>]");
}
const exported = JSON.parse(await fs.readFile(inputPath, "utf8"));
if (!Array.isArray(exported.records) || exported.algorithm !== "SHA-256 hash chain") {
  throw new Error("Unsupported audit export format.");
}
if (exported.complete !== true || exported.assurance !== "exported_file_consistency_only") {
  throw new Error("Audit export lacks an explicit completeness and assurance declaration.");
}
if (exported.totalRecords !== exported.records.length) throw new Error("Record count metadata mismatch.");
if ((exported.firstRecordId ?? null) !== (exported.records.at(0)?.id ?? null)) {
  throw new Error("First record boundary mismatch.");
}
if ((exported.lastRecordId ?? null) !== (exported.records.at(-1)?.id ?? null)) {
  throw new Error("Last record boundary mismatch.");
}
let previousHash = "0".repeat(64);
let previousId = -1;
for (const [index, record] of exported.records.entries()) {
  if (!Number.isInteger(record.id) || record.id <= previousId) {
    throw new Error(`Record IDs are not strictly increasing at record ${index + 1}.`);
  }
  if (record.previousHash !== previousHash) throw new Error(`Hash chain break at record ${index + 1}.`);
  const { hash, ...payload } = record;
  const expected = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (hash !== expected) throw new Error(`Hash mismatch at record ${index + 1}.`);
  previousHash = hash;
  previousId = record.id;
}
if (exported.finalHash !== previousHash) throw new Error("Final hash mismatch.");
if (expectedFinalHash && expectedFinalHash !== previousHash) {
  throw new Error("Final hash does not match the independently supplied anchor.");
}
process.stdout.write(`${JSON.stringify({
  verified: true,
  assurance: expectedFinalHash ? "matched_external_anchor" : "exported_file_consistency_only",
  recordCount: exported.records.length,
  firstRecordId: exported.firstRecordId,
  lastRecordId: exported.lastRecordId,
  finalHash: previousHash,
}, null, 2)}\n`);
