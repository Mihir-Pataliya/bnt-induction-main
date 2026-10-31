import { test } from "node:test";
import assert from "node:assert/strict";
import { getFinalApprovalBlockers, isCurrentOnboardingDate } from "./onboardingCompliance.js";

const today = new Date("2026-10-19T15:00:00Z");
const employee = {
  profile: { full_name: "Jamie Driver", email: "jamie@example.com", phone: "0412345678", address: "1 Main Street", date_of_birth: "1990-01-01", preferred_language: "English", emergency_contact_name: "Alex", emergency_contact_relationship: "Partner", emergency_contact_phone: "0412345679", licence_class: "HC", issuing_state: "VIC", licence_number: "AB123456", depot_location: "Melbourne Hub", employment_start_date: "2026-10-01", employment_basis: "full_time" },
  documents: ["driver_license", "medical_certificate", "right_to_work"].map((type) => ({ type, status: "approved", work_rights_check_status: type === "right_to_work" ? "verified" : undefined, expires_at: "2026-10-19", uploaded_at: "2026-10-18T00:00:00Z" })),
  completedStepIds: [1, 2, 3, 4, 5], trainingComplete: true, quizPassed: true, declarationAccepted: true, signature: "signature", requiredPolicyVersionIds: ["v1"], signedPolicyVersionIds: new Set(["v1"]), employmentType: "employee", requirePayrollSetup: true, payrollSetupComplete: true
};
const contractorReadiness = {
  financialDetails: { bank_account_name: "BNT Logistics", bank_bsb: "123456", bank_account_number: "12345678", gst_registered: false, business_details_confirmed_at: "2026-01-01", tax_declaration_at: "2026-01-01", insurance_declaration_at: "2026-01-01", vehicle_declaration_at: "2026-01-01" },
  vehicles: [{ rego: "ABC123", rego_document_path: "rego.pdf", rego_document_status: "approved", rego_expiry_date: "2027-01-01", insurance_document_path: "insurance.pdf", insurance_document_status: "approved", insurance_document_expiry: "2027-01-01", inspection_document_path: "inspection.pdf", inspection_document_status: "approved", inspection_document_expiry: "2027-01-01" }]
};

test("date-only expiry remains current through its calendar day and rejects invalid or past dates", () => {
  assert.equal(isCurrentOnboardingDate("2026-10-19", today), true);
  assert.equal(isCurrentOnboardingDate("2026-10-19T00:00:00.000Z", today), true);
  assert.equal(isCurrentOnboardingDate("2026-10-19T00:00:00.000Z", new Date("2026-10-20T00:00:00Z")), false);
  assert.equal(isCurrentOnboardingDate("2026-10-18", today), false);
  assert.equal(isCurrentOnboardingDate("2026-02-30", today), false);
  assert.equal(isCurrentOnboardingDate(null, today), false);
});

test("employee final approval requires current mandatory documents, policies, profile and signed declaration", () => {
  assert.deepEqual(getFinalApprovalBlockers(employee, today), []);
  const expired = { ...employee, documents: [{ ...employee.documents[0], expires_at: "2026-10-18" }, ...employee.documents.slice(1)] };
  assert.ok(getFinalApprovalBlockers(expired, today).includes("driver_license"));
  assert.ok(getFinalApprovalBlockers({ ...employee, signedPolicyVersionIds: new Set() }, today).includes("Policy acknowledgement"));
  assert.ok(getFinalApprovalBlockers({ ...employee, profile: { ...employee.profile, emergency_contact_phone: "bad" } }, today).includes("Valid emergency contact phone"));
  assert.ok(getFinalApprovalBlockers({ ...employee, completedStepIds: [1, 2, 4, 5] }, today).includes("Induction step 3"));
  assert.ok(getFinalApprovalBlockers({ ...employee, trainingComplete: false }, today).includes("Required learning modules"));
  assert.ok(getFinalApprovalBlockers({ ...employee, missingPolicyVersionCount: 1 }, today).includes("Published version missing for required policy"));
});

test("warehouse/office final approval does not require driver-only licence and medical documents", () => {
  const profile = { ...employee.profile };
  delete profile.licence_class;
  delete profile.issuing_state;
  delete profile.licence_number;
  const input = {
    ...employee,
    profile,
    staffRole: "warehouse",
    documents: [{ type: "right_to_work", status: "approved", work_rights_check_status: "verified", expires_at: null, uploaded_at: "2026-10-18T00:00:00Z" }]
  };
  assert.deepEqual(getFinalApprovalBlockers(input, today), []);
});

test("employees require saved payroll setup and verified work-rights evidence; contractors remain on their separate requirements", () => {
  assert.ok(getFinalApprovalBlockers({ ...employee, payrollSetupComplete: false }, today).includes("Payroll and superannuation setup"));
  assert.ok(getFinalApprovalBlockers({ ...employee, documents: employee.documents.map((doc) => doc.type === "right_to_work" ? { ...doc, work_rights_check_status: "not_checked" } : doc) }, today).includes("Verified work rights check"));
  assert.ok(!getFinalApprovalBlockers({ ...employee, employmentType: "contractor", company: { public_liability_file_path: "pl.pdf", public_liability_status: "approved", public_liability_expiry: "2026-10-19", workers_comp_file_path: "wc.pdf", workers_comp_status: "approved", workers_comp_expiry: "2026-10-19", agreement_file_path: "agreement.pdf", agreement_status: "approved", agreement_expiry: "2026-10-19" }, ...contractorReadiness, contractorAgreementSignatureMatches: true }, today).includes("Payroll and superannuation setup"));
});

test("contractor final approval also requires linked, insured company and current approved agreement", () => {
  const company = { public_liability_file_path: "pl.pdf", public_liability_status: "approved", public_liability_expiry: "2026-10-19", workers_comp_file_path: "wc.pdf", workers_comp_status: "approved", workers_comp_expiry: "2026-10-19", agreement_file_path: "agreement.pdf", agreement_status: "approved", agreement_expiry: "2026-10-19" };
  assert.deepEqual(getFinalApprovalBlockers({ ...employee, ...contractorReadiness, employmentType: "contractor", company, contractorAgreementSignatureMatches: true }, today), []);
  assert.ok(getFinalApprovalBlockers({ ...employee, ...contractorReadiness, employmentType: "contractor", company: { ...company, workers_comp_expiry: "2026-10-18" }, contractorAgreementSignatureMatches: true }, today).includes("Workers compensation insurance"));
  assert.ok(getFinalApprovalBlockers({ ...employee, ...contractorReadiness, employmentType: "contractor", company: { ...company, public_liability_status: "rejected" }, contractorAgreementSignatureMatches: true }, today).includes("Public liability insurance"));
  assert.ok(getFinalApprovalBlockers({ ...employee, ...contractorReadiness, employmentType: "contractor", company, contractorAgreementSignatureMatches: true, requiredPolicyVersionIds: ["v1", "agreement-v1"], signedPolicyVersionIds: new Set(["v1"]) }, today).includes("Policy acknowledgement"));
  assert.ok(getFinalApprovalBlockers({ ...employee, ...contractorReadiness, employmentType: "contractor", company, contractorAgreementSignatureMatches: false }, today).includes("Contractor agreement e-signature for the current company document"));
  for (const invalidAgreement of [
    { ...company, agreement_file_path: null },
    { ...company, agreement_status: "pending" },
    { ...company, agreement_status: "rejected" },
    { ...company, agreement_expiry: "2026-10-18" },
    { ...company, agreement_expiry: null }
  ]) {
    assert.ok(getFinalApprovalBlockers({ ...employee, ...contractorReadiness, employmentType: "contractor", company: invalidAgreement, contractorAgreementSignatureMatches: true }, today).includes("Current approved contractor agreement"));
  }
});

test("contractor warehouse and office roles require company obligations but not driver-only credentials", () => {
  const company = { public_liability_file_path: "pl.pdf", public_liability_status: "approved", public_liability_expiry: "2026-10-19", workers_comp_file_path: "wc.pdf", workers_comp_status: "approved", workers_comp_expiry: "2026-10-19", agreement_file_path: "agreement.pdf", agreement_status: "approved", agreement_expiry: "2026-10-19" };
  const profile = { ...employee.profile };
  delete profile.licence_class;
  delete profile.issuing_state;
  delete profile.licence_number;
  for (const staffRole of ["warehouse", "office"]) {
    assert.deepEqual(getFinalApprovalBlockers({
      ...employee, ...contractorReadiness, profile, staffRole, employmentType: "contractor", company,
      documents: [{ type: "right_to_work", status: "approved", expires_at: null, uploaded_at: "2026-10-18T00:00:00Z" }],
      requiredPolicyVersionIds: ["v1", "contractor-agreement"],
      signedPolicyVersionIds: new Set(["v1", "contractor-agreement"]),
      contractorAgreementSignatureMatches: true
    }, today), []);
  }
});

test("non-expiring right-to-work documents are allowed, but licence and medical dates are mandatory", () => {
  const current = { ...employee, documents: employee.documents.map((doc) => doc.type === "right_to_work" ? { ...doc, expires_at: null } : doc) };
  assert.deepEqual(getFinalApprovalBlockers(current, today), []);
  const missingMedicalExpiry = { ...employee, documents: employee.documents.map((doc) => doc.type === "medical_certificate" ? { ...doc, expires_at: null } : doc) };
  assert.ok(getFinalApprovalBlockers(missingMedicalExpiry, today).includes("medical_certificate"));
});

test("latest pending re-upload supersedes an older approved document", async () => {
  const { latestDocumentsByType } = await import("./onboardingCompliance.js");
  const latest = latestDocumentsByType([
    { type: "driver_license", status: "approved", uploaded_at: "2026-01-01T00:00:00Z" },
    { type: "driver_license", status: "pending", uploaded_at: "2026-10-19T00:00:00Z" }
  ]);
  assert.equal(latest.get("driver_license").status, "pending");
  assert.ok(getFinalApprovalBlockers({ ...employee, documents: [
    ...employee.documents.filter((document) => document.type !== "driver_license"),
    { type: "driver_license", status: "approved", expires_at: "2027-01-01", uploaded_at: "2026-01-01T00:00:00Z" },
    { type: "driver_license", status: "pending", expires_at: null, uploaded_at: "2026-10-19T00:00:00Z" }
  ] }, today).includes("driver_license"));
});

test("document review requires and persists rejection reason and current expiry", async () => {
  const { buildDocumentReviewUpdate } = await import("./onboardingCompliance.js");
  assert.throws(() => buildDocumentReviewUpdate({ action: "reject", documentType: "right_to_work", adminId: "admin" }), /rejection reason/);
  assert.throws(() => buildDocumentReviewUpdate({ action: "approve", documentType: "driver_license", adminId: "admin", now: "2026-10-19T15:00:00Z" }), /expiry date/);
  const rejected = buildDocumentReviewUpdate({ action: "reject", reason: "Unreadable scan", documentType: "right_to_work", adminId: "admin", now: "2026-10-19T15:00:00Z" });
  assert.equal(rejected.rejection_reason, "Unreadable scan");
  assert.equal(rejected.verified_by_user_id, "admin");
  const approved = buildDocumentReviewUpdate({ action: "approve", documentType: "driver_license", expiresAt: "2027-10-19", adminId: "admin", now: "2026-10-19T15:00:00Z" });
  assert.equal(approved.expires_at, "2027-10-19");
  assert.equal(approved.verified_by_admin, true);
});

test("role required documents use right-to-work rather than identity-proof for non-drivers", async () => {
  const { getRequiredDocumentTypesForRole } = await import("./onboardingCompliance.js");
  assert.deepEqual(getRequiredDocumentTypesForRole("driver"), ["driver_license", "medical_certificate", "right_to_work"]);
  assert.deepEqual(getRequiredDocumentTypesForRole("warehouse"), ["right_to_work"]);
  assert.deepEqual(getRequiredDocumentTypesForRole("office"), ["right_to_work"]);
});

test("suspended or inactive contractor company status cannot be auto-promoted", async () => {
  const { getNextContractorCompanyStatus } = await import("./onboardingCompliance.js");
  assert.equal(getNextContractorCompanyStatus("Suspended", true), "Suspended");
  assert.equal(getNextContractorCompanyStatus("Inactive", true), "Inactive");
  assert.equal(getNextContractorCompanyStatus("Pending Review", true), "Compliant");
  assert.equal(getNextContractorCompanyStatus("Compliant", false), "Pending Review");
});
