import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBasicProfile } from "./profileValidation.mjs";

const valid = {
  fullName: "Alex Driver", email: "alex@example.com", phone: "0412345678", address: "1 Example Street",
  dateOfBirth: "1990-05-20", emergencyContactName: "Sam Driver", emergencyContactRelationship: "Sibling",
  emergencyContactPhone: "0412345678", licenceNumber: "AB123456"
};

test("accepts a complete driver profile and a non-driver without licence details", () => {
  assert.deepEqual(validateBasicProfile(valid, { today: "2026-10-20" }), {});
  const warehouse = { ...valid, licenceNumber: "" };
  assert.deepEqual(validateBasicProfile(warehouse, { requiresDriverLicence: false, today: "2026-10-20" }), {});
});

test("rejects missing, malformed, or future date of birth and invalid emergency phone", () => {
  assert.ok(validateBasicProfile({ ...valid, dateOfBirth: "" }, { today: "2026-10-20" }).dateOfBirth);
  assert.ok(validateBasicProfile({ ...valid, dateOfBirth: "2027-01-01" }, { today: "2026-10-20" }).dateOfBirth);
  assert.ok(validateBasicProfile({ ...valid, emergencyContactPhone: "bad" }, { today: "2026-10-20" }).emergencyContactPhone);
});

test("requires valid licence details only for drivers", () => {
  assert.ok(validateBasicProfile({ ...valid, licenceNumber: "" }, { today: "2026-10-20" }).licenceNumber);
  assert.equal(validateBasicProfile({ ...valid, licenceNumber: "" }, { requiresDriverLicence: false, today: "2026-10-20" }).licenceNumber, undefined);
});

test("validates employee and contractor profiles across driver, warehouse, and office roles", () => {
  for (const engagementType of ["employee", "contractor"]) {
    for (const staffRole of ["driver", "warehouse", "office"]) {
      const profile = { ...valid, engagementType, staffRole, licenceNumber: staffRole === "driver" ? valid.licenceNumber : "" };
      const errors = validateBasicProfile(profile, { requiresDriverLicence: staffRole === "driver", today: "2026-10-20" });
      assert.deepEqual(errors, {}, `${engagementType} ${staffRole} profile should validate`);
    }
  }
});
