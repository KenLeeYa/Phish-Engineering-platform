import assert from "node:assert/strict";
import test from "node:test";
import {
  applySettingsUpdate,
  buildReadiness,
  createInitialSettings,
} from "../dist/domain/settings.js";

test("scope settings are normalized and keep delivery disabled", () => {
  const initial = createInitialSettings("測試公司");
  const settings = applySettingsUpdate(initial, {
    recipientDomains: ["CUSTOMER.EXAMPLE", "customer.example"],
    senderDomains: "Awareness.Customer.Example",
    testRecipientEmails: "Tester@Customer.Example",
  });

  assert.deepEqual(settings.scope.recipientDomains, ["customer.example"]);
  assert.deepEqual(settings.scope.senderDomains, ["awareness.customer.example"]);
  assert.deepEqual(settings.scope.testRecipientEmails, ["tester@customer.example"]);
  assert.deepEqual(settings.delivery, { enabled: false, connectorType: "not_configured" });
  assert.equal(buildReadiness(settings).mailSendingEnabled, false);
});

test("test mailboxes cannot escape the approved recipient domains", () => {
  const initial = createInitialSettings("測試公司");
  assert.throws(
    () =>
      applySettingsUpdate(initial, {
        recipientDomains: ["customer.example"],
        testRecipientEmails: ["outside@example.net"],
      }),
    /必須屬於內部收件網域/,
  );
});
