import assert from "node:assert/strict";
import test from "node:test";
import {
  SpreadsheetInputLimitError,
  validateXlsxContainer,
} from "../dist/infrastructure/spreadsheet-runtime.js";

function minimalXlsxContainer() {
  const files = ["[Content_Types].xml", "xl/workbook.xml"];
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const name of files) {
    const nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(1, 18);
    local.writeUInt32LE(1, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, Buffer.from("x"));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(1, 20);
    central.writeUInt32LE(1, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + 1;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

test("XLSX preflight accepts a bounded workbook container and rejects declared expansion bombs", () => {
  const valid = minimalXlsxContainer();
  assert.doesNotThrow(() => validateXlsxContainer(valid));
  const malicious = Buffer.from(valid);
  const eocd = malicious.length - 22;
  const centralOffset = malicious.readUInt32LE(eocd + 16);
  malicious.writeUInt32LE(33 * 1024 * 1024, centralOffset + 24);
  assert.throws(() => validateXlsxContainer(malicious), SpreadsheetInputLimitError);
});

test("XLSX preflight rejects encrypted or path-traversing entries before runtime import", () => {
  const encrypted = minimalXlsxContainer();
  const eocd = encrypted.length - 22;
  const centralOffset = encrypted.readUInt32LE(eocd + 16);
  encrypted.writeUInt16LE(1, centralOffset + 8);
  assert.throws(() => validateXlsxContainer(encrypted), /加密/);

  const traversing = minimalXlsxContainer();
  const traversalCentral = traversing.readUInt32LE(traversing.length - 22 + 16);
  const nameLength = traversing.readUInt16LE(traversalCentral + 28);
  const replacement = Buffer.from("../evil.xml".padEnd(nameLength, "x"));
  replacement.copy(traversing, traversalCentral + 46, 0, nameLength);
  assert.throws(() => validateXlsxContainer(traversing), /不安全/);
});
