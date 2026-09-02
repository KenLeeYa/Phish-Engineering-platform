import assert from "node:assert/strict";
import test from "node:test";
import { parseRosterCsv, parseRosterRows } from "../dist/application/audience-service.js";

test("CSV roster parser enforces internal domains and reports duplicates", () => {
  const parsed = parseRosterCsv(
    [
      "姓名,E-mail,部門,部群",
      "王小明,user1@customer.example,資訊部,管理處",
      "王小明二,user1@customer.example,資訊部,管理處",
      "林小華,user2@customer.example,人資部,管理處",
      "外部人員,outside@example.net,外部,外部",
    ].join("\n"),
    ["customer.example"],
  );

  assert.equal(parsed.totalRows, 4);
  assert.equal(parsed.recipients.length, 2);
  assert.equal(parsed.duplicateRows, 1);
  assert.equal(parsed.skippedRows, 1);
  assert.equal(parsed.rowErrors[0].reason, "不在內部收件網域");
  assert.equal(parsed.recipients[0].email.endsWith("@customer.example"), true);
});

test("CSV roster parser rejects files without an email column", () => {
  assert.throws(
    () => parseRosterCsv("姓名,部門\n王小明,資訊部", ["customer.example"]),
    /缺少 Email/,
  );
});

test("headerless XLSX reference layout maps department, name, email and unit without dropping row one", () => {
  const parsed = parseRosterRows(
    [
      ["營運管理部", "測試一", "Person.One@enterprise.example", "北區營運中心", "合併參考欄;"],
      ["資訊服務部", "測試二", "person.two@enterprise.example", "中區營運中心", "合併參考欄;"],
      ["人力資源部", "測試三", "person.three@enterprise.example", "南區營運中心", "合併參考欄;"],
    ],
    ["enterprise.example"],
  );

  assert.equal(parsed.layout, "headerless_department_name_email_unit");
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.recipients.length, 3);
  assert.deepEqual(
    {
      displayName: parsed.recipients[0].displayName,
      email: parsed.recipients[0].email,
      department: parsed.recipients[0].department,
      businessUnit: parsed.recipients[0].businessUnit,
    },
    {
      displayName: "測試一",
      email: "person.one@enterprise.example",
      department: "營運管理部",
      businessUnit: "北區營運中心",
    },
  );
});
