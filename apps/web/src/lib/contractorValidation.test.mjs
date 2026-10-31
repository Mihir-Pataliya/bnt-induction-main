import test from "node:test";
import assert from "node:assert/strict";
import { validateABN, validateACN } from "./contractorValidation.mjs";

test("ABN validation accepts checksum-valid values and rejects malformed or invalid values", () => {
  assert.equal(validateABN("51 824 753 556").isValid, true);
  assert.equal(validateABN("12345678901").isValid, false);
  assert.equal(validateABN("51 824 753 55x").isValid, false);
  assert.equal(validateABN("").isValid, false);
});

test("ACN validation accepts optional empty values and checks the 9 digit checksum", () => {
  assert.equal(validateACN("").isValid, true);
  assert.equal(validateACN("123456780").isValid, true);
  assert.equal(validateACN("123456789").isValid, false);
  assert.equal(validateACN("12A456780").isValid, false);
});
