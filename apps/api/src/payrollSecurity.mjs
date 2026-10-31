import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function getPayrollEncryptionKey(configured) {
  if (!configured) throw new Error("PAYROLL_ENCRYPTION_KEY must be configured before payroll details can be used.");
  const key = /^[0-9a-f]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("PAYROLL_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key.");
  return key;
}

export function encryptPayrollValue(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptPayrollValue(value, key) {
  if (!value) return "";
  const [ivText, tagText, dataText] = value.split(".");
  if (!ivText || !tagText || dataText === undefined) throw new Error("Invalid payroll ciphertext.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64")), decipher.final()]).toString("utf8");
}
