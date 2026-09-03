import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  buildTenantDeploymentPlan,
  parseSaaSTenantRegistry,
} from "../dist/domain/saas.js";

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    "用法：node scripts/plan-saas-tenant.mjs --registry <json> [--validate-only] "
      + "[--tenant <id> --data-root <absolute-path> --output <json>]\n",
  );
  process.exitCode = 2;
}

function parseArguments(values) {
  const options = { validateOnly: false };
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--validate-only") {
      options.validateOnly = true;
      continue;
    }
    if (!["--registry", "--tenant", "--data-root", "--output"].includes(argument)) {
      usage(`未知參數：${argument}`);
      return null;
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      usage(`${argument} 缺少值。`);
      return null;
    }
    options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return;
  if (!options.registry) return usage("必須提供 --registry。 ");

  const registryPath = path.resolve(options.registry);
  const registry = parseSaaSTenantRegistry(JSON.parse(await fs.readFile(registryPath, "utf8")));
  if (options.validateOnly) {
    process.stdout.write(`SaaS registry 驗證通過：${registry.tenants.length} 個 tenant。\n`);
    return;
  }
  if (!options.tenant || !options.dataRoot) {
    return usage("產生部署計畫需要 --tenant 與 --data-root。 ");
  }

  const plan = buildTenantDeploymentPlan(registry, options.tenant, options.dataRoot);
  const content = `${JSON.stringify(plan, null, 2)}\n`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`已產生不含秘密值的部署計畫：${outputPath}\n`);
    return;
  }
  process.stdout.write(content);
}

main().catch((error) => {
  process.stderr.write(`SaaS 計畫失敗：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
