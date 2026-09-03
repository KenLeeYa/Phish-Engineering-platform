import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SaaSManifestValidationError,
  SaaSQuotaExceededError,
  assertQuotaAvailable,
  buildTenantDeploymentPlan,
  parseSaaSTenantRegistry,
  tenantManifestDigest,
} from "../dist/domain/saas.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(path.join(projectRoot, "config", "saas-tenants.example.json"), "utf8"));

function clone(value) {
  return structuredClone(value);
}

test("SaaS registry validates and produces a deterministic no-secret deployment plan", () => {
  const registry = parseSaaSTenantRegistry(fixture);
  const tenant = registry.tenants[0];
  const digest = tenantManifestDigest(tenant);
  const reorderedTenant = Object.fromEntries(Object.entries(tenant).reverse());
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, tenantManifestDigest(reorderedTenant));

  const dataRoot = path.resolve(projectRoot, ".local-data", "saas-test");
  const plan = buildTenantDeploymentPlan(registry, tenant.tenantId, dataRoot);
  assert.equal(plan.tenantId, tenant.tenantId);
  assert.equal(plan.runtimeEnvironment.SEA_DEPLOYMENT_MODE, "saas_tenant_cell");
  assert.ok(plan.runtimeEnvironment.SEA_DATABASE_PATH.startsWith(dataRoot));
  assert.equal(plan.requiredSecrets.length, 5);
  assert.doesNotMatch(JSON.stringify(plan), /password|AKIA|sk_live_/i);
  assert.ok(plan.requiredSecrets.every((item) => item.reference.startsWith("secret://")));
});

test("SaaS registry requires maker-checker tenant approval", () => {
  const candidate = clone(fixture);
  candidate.tenants[0].lifecycle.approvedBy = candidate.tenants[0].lifecycle.requestedBy;
  assert.throws(() => parseSaaSTenantRegistry(candidate), /申請人與核准人必須不同/);
});

test("SaaS registry rejects embedded credentials", () => {
  const candidate = clone(fixture);
  candidate.tenants[0].identity.password = "not-allowed";
  assert.throws(() => parseSaaSTenantRegistry(candidate), /不得保存秘密/);
});

test("SaaS registry rejects cross-tenant domain collisions", () => {
  const candidate = clone(fixture);
  const second = clone(candidate.tenants[0]);
  second.tenantId = "tenant-demo-002";
  second.slug = "demo-enterprise-two";
  second.domains.adminHost = "awareness-admin-two.example.com";
  second.domains.trackingHost = "awareness-training-two.example.com";
  second.identity.redirectUri = "https://awareness-admin-two.example.com/api/auth/oidc/callback";
  candidate.tenants.push(second);
  assert.throws(() => parseSaaSTenantRegistry(candidate), /recipient domain/);
});

test("SaaS deployment plan requires approval and an absolute data root", () => {
  const candidate = clone(fixture);
  candidate.tenants[0].lifecycle.status = "pending_approval";
  candidate.tenants[0].lifecycle.approvedBy = null;
  candidate.tenants[0].lifecycle.approvedAt = null;
  const registry = parseSaaSTenantRegistry(candidate);
  assert.throws(() => buildTenantDeploymentPlan(registry, "tenant-demo-001", projectRoot), /尚未完成獨立核准/);

  const approved = parseSaaSTenantRegistry(fixture);
  assert.throws(
    () => buildTenantDeploymentPlan(approved, "tenant-demo-001", "relative-data"),
    SaaSManifestValidationError,
  );
});

test("quota helper permits the boundary and rejects overages", () => {
  assert.doesNotThrow(() => assertQuotaAvailable("test", 9, 1, 10));
  assert.throws(() => assertQuotaAvailable("test", 9, 2, 10), SaaSQuotaExceededError);
});
