import assert from "node:assert/strict";
import test from "node:test";
import { readRuntimeConfig } from "../dist/config.js";

const remoteBaseline = {
  SEA_BIND_HOST: "0.0.0.0",
  SEA_PORT: "4280",
  SEA_ALLOW_REMOTE_ADMIN: "true",
  SEA_ADMIN_HOSTNAMES: "admin.customer.example",
  SEA_SECURE_COOKIES: "true",
  SEA_REMOTE_HTTPS_PROXY: "true",
  SEA_TRACKING_ORIGINS: "https://training.customer.example",
};

test("remote administration requires HTTPS acknowledgement, secure cookies and distinct exact hostnames", () => {
  assert.throws(
    () => readRuntimeConfig({ ...remoteBaseline, SEA_SECURE_COOKIES: "false" }),
    /SEA_SECURE_COOKIES/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...remoteBaseline, SEA_REMOTE_HTTPS_PROXY: "false" }),
    /SEA_REMOTE_HTTPS_PROXY/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...remoteBaseline, SEA_TRACKING_ORIGINS: "http://training.customer.example" }),
    /HTTPS/,
  );
  assert.throws(
    () => readRuntimeConfig({ ...remoteBaseline, SEA_TRACKING_ORIGINS: "https://admin.customer.example" }),
    /必須分離/,
  );
  const config = readRuntimeConfig(remoteBaseline);
  assert.deepEqual(config.allowedAdminHosts, ["admin.customer.example"]);
  assert.deepEqual(config.allowedTrackingHosts, ["training.customer.example"]);
  assert.deepEqual(config.allowedTrackingOrigins, ["https://training.customer.example"]);
  assert.equal(config.secureCookies, true);
});
