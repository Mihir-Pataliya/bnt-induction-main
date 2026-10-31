import { test } from "node:test";
import assert from "node:assert/strict";
import { isPolicyApplicableToWorker } from "./policyTargeting.js";

test("contractor audience is visible to contractor workers only", () => {
  const policy = { audience: "contractor", target_role: "all" };
  assert.equal(isPolicyApplicableToWorker(policy, "contractor", "driver"), true);
  assert.equal(isPolicyApplicableToWorker(policy, "employee", "driver"), false);
});

test("role targeting applies alongside employment targeting", () => {
  const policy = { audience: "contractor", target_role: "warehouse" };
  assert.equal(isPolicyApplicableToWorker(policy, "contractor", "warehouse"), true);
  assert.equal(isPolicyApplicableToWorker(policy, "contractor", "driver"), false);
});

test("all audience and all roles match every worker", () => {
  const policy = { audience: "all", target_role: "all" };
  assert.equal(isPolicyApplicableToWorker(policy, "employee", "office"), true);
  assert.equal(isPolicyApplicableToWorker(policy, "contractor", "driver"), true);
});
