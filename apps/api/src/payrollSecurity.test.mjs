import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptPayrollValue, encryptPayrollValue, getPayrollEncryptionKey } from "./payrollSecurity.mjs";

test("payroll encryption round trips and does not store the clear value", () => {
  const key = getPayrollEncryptionKey(Buffer.alloc(32, 9).toString("base64"));
  const clear = "123456789";
  const encrypted = encryptPayrollValue(clear, key);
  assert.notEqual(encrypted, clear);
  assert.equal(encrypted.includes(clear), false);
  assert.equal(decryptPayrollValue(encrypted, key), clear);
  assert.throws(() => decryptPayrollValue(encrypted, Buffer.alloc(32, 8)));
});

test("payroll encryption requires a correctly sized secret key", () => {
  assert.throws(() => getPayrollEncryptionKey(undefined), /must be configured/);
  assert.throws(() => getPayrollEncryptionKey("too-short"), /32-byte/);
});
