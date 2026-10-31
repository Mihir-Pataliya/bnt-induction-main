import { test } from "node:test";
import assert from "node:assert/strict";
import { isSOPApplicableToWorker } from "./sopTargeting.js";

test("driver safety modules target employees and contractors separately", () => {
  const employeeDrivers = { audience: "employee", target_role: "driver" };
  const contractorDrivers = { audience: "contractor", target_role: "driver" };
  assert.equal(isSOPApplicableToWorker(employeeDrivers, "employee", "driver"), true);
  assert.equal(isSOPApplicableToWorker(employeeDrivers, "contractor", "driver"), false);
  assert.equal(isSOPApplicableToWorker(contractorDrivers, "contractor", "driver"), true);
  assert.equal(isSOPApplicableToWorker(contractorDrivers, "employee", "driver"), false);
});

test("module role targeting excludes non-target roles and preserves legacy all-target modules", () => {
  assert.equal(isSOPApplicableToWorker({ audience: "all", target_role: "warehouse" }, "employee", "driver"), false);
  assert.equal(isSOPApplicableToWorker({ audience: "all", target_role: "all" }, "contractor", "driver"), true);
  assert.equal(isSOPApplicableToWorker({}, "employee", "driver"), true);
});
