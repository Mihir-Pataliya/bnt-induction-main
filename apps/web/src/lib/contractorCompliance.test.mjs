import test from "node:test";
import assert from "node:assert/strict";
import { assessContractorInsurance, computeContractorStatus } from "./contractorComplianceCore.mjs";

const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

test("contractor insurance is not compliant while missing, pending, rejected, or expired", () => {
  assert.equal(assessContractorInsurance(null, future, "approved").valid, false);
  assert.equal(assessContractorInsurance("file.pdf", null, "approved").valid, false);
  assert.equal(assessContractorInsurance("file.pdf", future, "pending").valid, false);
  assert.equal(assessContractorInsurance("file.pdf", future, "rejected").valid, false);
  assert.equal(assessContractorInsurance("file.pdf", yesterday, "approved").status, "expired");
  assert.equal(assessContractorInsurance("file.pdf", future, "approved").status, "valid");
});

test("company status requires reviewed files and complete business/vehicle requirements", () => {
  const base = { businessDetailsComplete: true, vehicleComplianceComplete: true, publicLiabilityStatus: "approved", publicLiabilityFileUrl: "pl.pdf", publicLiabilityExpiry: future, workersCompStatus: "approved", workersCompFileUrl: "wc.pdf", workersCompExpiry: future, agreementStatus: "approved", agreementFileUrl: "agreement.pdf", agreementExpiry: future, nhvasAccreditation: "None", status: "Compliant" };
  assert.equal(computeContractorStatus(base).label, "Compliant");
  assert.equal(computeContractorStatus({ ...base, workersCompStatus: "pending" }).label, "Pending Review");
  assert.equal(computeContractorStatus({ ...base, businessDetailsComplete: false }).label, "Pending Review");
  assert.equal(computeContractorStatus({ ...base, vehicleComplianceComplete: false }).label, "Pending Review");
});
