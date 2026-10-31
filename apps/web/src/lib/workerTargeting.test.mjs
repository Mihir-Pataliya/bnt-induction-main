import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredDocumentTypes, isWorkerTargeted } from "./workerTargeting.js";

test("policy and learning audiences target engagement and role together", () => {
  assert.equal(isWorkerTargeted({ audience: "contractor", target_role: "warehouse" }, "contractor", "warehouse"), true);
  assert.equal(isWorkerTargeted({ audience: "contractor", target_role: "warehouse" }, "employee", "warehouse"), false);
  assert.equal(isWorkerTargeted({ audience: "all", target_role: "driver" }, "employee", "office"), false);
  assert.equal(isWorkerTargeted({ audience: "all", target_role: "all" }, "contractor", "office"), true);
});

test("employee and contractor targeting works across driver, warehouse, and office roles", () => {
  const workers = ["employee", "contractor"].flatMap((engagement) =>
    ["driver", "warehouse", "office"].map((role) => ({ engagement, role }))
  );
  for (const worker of workers) {
    assert.equal(isWorkerTargeted({ audience: worker.engagement, target_role: worker.role }, worker.engagement, worker.role), true);
    const otherRole = ["driver", "warehouse", "office"].find((role) => role !== worker.role);
    assert.equal(isWorkerTargeted({ audience: worker.engagement, target_role: otherRole }, worker.engagement, worker.role), false);
    const otherEngagement = worker.engagement === "employee" ? "contractor" : "employee";
    assert.equal(isWorkerTargeted({ audience: otherEngagement, target_role: worker.role }, worker.engagement, worker.role), false);
  }
});

test("role-based required documents keep driver credentials out of warehouse and office checklists", () => {
  assert.deepEqual(getRequiredDocumentTypes("employee", "driver"), ["driver_license", "medical_certificate", "right_to_work"]);
  assert.deepEqual(getRequiredDocumentTypes("contractor", "warehouse"), ["right_to_work"]);
  assert.deepEqual(getRequiredDocumentTypes("employee", "office"), ["right_to_work"]);
});
