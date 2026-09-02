import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!databasePath) throw new Error("Usage: node scripts/check-database.mjs <database.sqlite>");

const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const quickCheck = database.prepare("PRAGMA quick_check").all().map((row) => Object.values(row)[0]);
  if (quickCheck.length !== 1 || quickCheck[0] !== "ok") {
    throw new Error(`SQLite quick_check failed: ${JSON.stringify(quickCheck)}`);
  }
  const migrations = database
    .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
    .all();
  process.stdout.write(`${JSON.stringify({ databasePath, quickCheck: "ok", migrations }, null, 2)}\n`);
} finally {
  database.close();
}
