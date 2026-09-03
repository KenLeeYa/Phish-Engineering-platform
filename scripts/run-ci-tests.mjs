import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const excluded = new Set(["full-pilot.integration.test.mjs"]);
const testFiles = fs.readdirSync("tests", { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs") && !excluded.has(entry.name))
  .map((entry) => path.join("tests", entry.name))
  .sort();

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
