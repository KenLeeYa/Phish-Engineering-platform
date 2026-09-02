import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../dist/web/server.js";

const BOOTSTRAP_TOKEN = "qa-vendor-report-bootstrap-token";

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const outputDirectory = process.argv[3] ? path.resolve(process.argv[3]) : "";
if (!inputPath || !outputDirectory) {
  throw new Error("Usage: npm run build && node scripts/qa-vendor-report.mjs <rawdata.xlsx> <output-directory>");
}

function cookies(response) {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function cookieValue(header, name) {
  const prefix = `${name}=`;
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}

await fs.mkdir(outputDirectory, { recursive: true });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sea-vendor-qa-"));
const app = await createApp({
  databasePath: path.join(temporary, "qa.sqlite"),
  reportDirectory: outputDirectory,
  pickupDirectory: path.join(temporary, "pickup"),
  secretVaultPath: path.join(temporary, "vault.json"),
  workerEnabled: false,
  allowedAdminHosts: ["localhost"],
  allowedTrackingOrigins: ["http://localhost"],
  bootstrapToken: BOOTSTRAP_TOKEN,
});
try {
  const setup = await app.inject({
    method: "POST",
    url: "/api/setup",
    headers: { "content-type": "application/json", "x-bootstrap-token": BOOTSTRAP_TOKEN },
    payload: {
      organizationName: "Local QA",
      displayName: "QA Administrator",
      username: "qa-admin",
      password: "QA-Report-Safety-2026!",
    },
  });
  if (setup.statusCode !== 201) throw new Error(setup.body);
  const cookie = cookies(setup);
  const csrf = cookieValue(cookie, "sea_csrf");
  const input = await fs.readFile(inputPath);
  const query = new URLSearchParams({
    fileName: path.basename(inputPath),
    campaignName: `${path.basename(inputPath, path.extname(inputPath))} 演練結果`,
  });
  const report = await app.inject({
    method: "POST",
    url: `/api/reports/vendor-rawdata?${query}`,
    headers: {
      cookie,
      "x-csrf-token": csrf,
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    payload: input,
  });
  if (report.statusCode !== 201) throw new Error(report.body);
  const payload = report.json();
  const files = [];
  for (const artifact of payload.artifacts) {
    const download = await app.inject({
      method: "GET",
      url: `/api/report-artifacts/${artifact.id}/download`,
      headers: { cookie },
    });
    if (download.statusCode !== 200) throw new Error(download.body);
    const destination = path.join(outputDirectory, artifact.fileName);
    await fs.writeFile(destination, download.rawPayload, { mode: 0o600 });
    files.push({ ...artifact, path: destination });
  }
  await fs.rm(path.join(outputDirectory, payload.artifacts[0]?.externalJobId ?? "__none__"), {
    recursive: true,
    force: true,
  });
  process.stdout.write(`${JSON.stringify({ files, analysis: payload.analysis }, null, 2)}\n`);
} finally {
  await app.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
