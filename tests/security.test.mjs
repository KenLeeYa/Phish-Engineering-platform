import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPassword,
  hashToken,
  tokensMatch,
  validatePassword,
  verifyPassword,
} from "../dist/domain/security.js";

test("passwords are scrypt-hashed and verified without plaintext storage", async () => {
  const password = "Safety-River-2026!";
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
});

test("password policy and constant-time token comparison reject unsafe values", () => {
  assert.throws(() => validatePassword("short", "admin"), /12/);
  assert.throws(() => validatePassword("my-admin-password-2026", "admin"), /帳號/);
  assert.equal(tokensMatch(hashToken("token"), hashToken("token")), true);
  assert.equal(tokensMatch(hashToken("token"), hashToken("other")), false);
});
