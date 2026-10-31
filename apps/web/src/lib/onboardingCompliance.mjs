export const REQUIRED_ONBOARDING_DOCUMENTS = ["driver_license", "medical_certificate", "right_to_work"];
export const REQUIRED_EXPIRY_DOCUMENTS = ["driver_license", "medical_certificate"];
export function getRequiredDocumentTypesForRole(staffRole = "driver") {
  return staffRole === "driver" ? REQUIRED_ONBOARDING_DOCUMENTS : ["right_to_work"];
}

export function getNextContractorCompanyStatus(currentStatus, allCurrent) {
  if (currentStatus === "Suspended" || currentStatus === "Inactive") return currentStatus;
  return allCurrent ? "Compliant" : "Pending Review";
}

export function buildDocumentReviewUpdate({ action, reason, expiresAt, existingExpiry, documentType, adminId, now = new Date().toISOString() }) {
  if (action !== "approve" && action !== "reject") throw new Error("Action must be approve or reject.");
  if (action === "reject" && !String(reason ?? "").trim()) throw new Error("A rejection reason is required.");
  const effectiveExpiry = expiresAt ?? existingExpiry;
  if (action === "approve" && REQUIRED_EXPIRY_DOCUMENTS.includes(documentType) && !isCurrentOnboardingDate(effectiveExpiry, new Date(now))) throw new Error("Set a current expiry date before approving this required document.");
  if (action === "approve" && effectiveExpiry && !isCurrentOnboardingDate(effectiveExpiry, new Date(now))) throw new Error("An expired document cannot be approved.");
  return {
    status: action === "approve" ? "approved" : "rejected",
    verified_by_admin: action === "approve",
    verified_at: now,
    verified_by_user_id: adminId,
    rejection_reason: action === "reject" ? String(reason).trim() : null,
    ...(action === "approve" && expiresAt ? { expires_at: expiresAt } : {})
  };
}

export function isCurrentOnboardingDate(value, now = new Date()) {
  if (!value) return false;
  const datePart = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
  const [year, month, day] = datePart.split("-").map(Number);
  const expiryDay = Date.UTC(year, month - 1, day);
  const parsed = new Date(expiryDay);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return expiryDay >= today;
}

export function latestDocumentsByType(rows = []) {
  const sorted = [...rows].sort((a, b) => Date.parse(b.uploaded_at ?? "") - Date.parse(a.uploaded_at ?? ""));
  const latest = new Map();
  for (const row of sorted) if (!latest.has(row.type)) latest.set(row.type, row);
  return latest;
}

const isTargeted = (item, employmentType, staffRole) => {
  const audience = item.audience ?? "all";
  const targetRole = item.target_role ?? item.targetRole ?? "all";
  return (audience === "all" || audience === employmentType) && (targetRole === "all" || targetRole === staffRole);
};

export function getFinalApprovalBlockers(input, now = new Date()) {
  const blockers = [];
  const add = (value) => { if (value && !blockers.includes(value)) blockers.push(value); };
  const profile = input.profile ?? {};
  if (profile.archived_at) add("Active worker record");
  const staffRole = input.staffRole ?? profile.staff_role ?? "driver";
  const driverRole = staffRole === "driver";
  const requiredProfileFields = [["full_name", "Full name"], ["email", "Email"], ["phone", "Phone"], ["address", "Address"], ["preferred_language", "Preferred language"], ["emergency_contact_name", "Emergency contact name"], ["emergency_contact_relationship", "Emergency contact relationship"], ["emergency_contact_phone", "Emergency contact phone"], ["depot_location", "Depot location"]];
  if (driverRole) requiredProfileFields.push(["licence_class", "Licence class"], ["issuing_state", "Issuing state"], ["licence_number", "Licence number"]);
  if (input.employmentType !== "contractor") requiredProfileFields.push(["employment_start_date", "Employment start date"], ["employment_basis", "Employment basis"]);
  for (const [key, label] of requiredProfileFields) if (!String(profile[key] ?? "").trim()) add(label);
  const phoneDigits = String(profile.phone ?? "").replace(/\D/g, "");
  if (!/^(?:\+?61|0)4\d{8}$/.test(String(profile.phone ?? "").trim()) && phoneDigits.length !== 10) add("Valid phone number");
  const emergencyPhone = String(profile.emergency_contact_phone ?? "").trim();
  const emergencyDigits = emergencyPhone.replace(/\D/g, "");
  if (!/^[+\d().\s-]+$/.test(emergencyPhone) || emergencyDigits.length < 8 || emergencyDigits.length > 15) add("Valid emergency contact phone");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email ?? "").trim())) add("Valid email");
  if (driverRole && !/^[A-Z0-9]{8}$/.test(String(profile.licence_number ?? "").trim().toUpperCase())) add("Valid licence number");
  const dob = String(profile.date_of_birth ?? "");
  const dobIsDate = /^\d{4}-\d{2}-\d{2}$/.test(dob) && isCurrentOnboardingDate(dob, new Date(`${dob}T00:00:00Z`));
  if (!dobIsDate || dob > now.toISOString().slice(0, 10)) add("Date of birth");
  if (input.employmentType !== "contractor" && input.requirePayrollSetup && input.payrollSetupComplete !== true) add("Payroll and superannuation setup");

  const documents = latestDocumentsByType(input.documents ?? []);
  const requiredDocuments = getRequiredDocumentTypesForRole(staffRole);
  for (const type of requiredDocuments) {
    const document = documents.get(type);
    if (!document || document.status !== "approved" || (document.expires_at ? !isCurrentOnboardingDate(document.expires_at, now) : REQUIRED_EXPIRY_DOCUMENTS.includes(type))) add(type);
    if (type === "right_to_work" && input.employmentType !== "contractor" && document?.work_rights_check_status !== "verified") add("Verified work rights check");
  }

  const completedSteps = new Set(input.completedStepIds ?? []);
  for (const step of [1, 2, 3, 4, 5]) if (!completedSteps.has(step)) add(`Induction step ${step}`);
  if (input.trainingComplete !== true) add("Required learning modules");
  if (input.quizPassed !== true) add("Safety quiz pass");
  if (!input.declarationAccepted || !String(input.signature ?? "").trim()) add("Signed declaration");
  for (const versionId of input.requiredPolicyVersionIds ?? []) if (!(input.signedPolicyVersionIds ?? new Set()).has(versionId)) add("Policy acknowledgement");
  if (Number(input.missingPolicyVersionCount ?? 0) > 0) add("Published version missing for required policy");

  if (input.employmentType === "contractor") {
    const company = input.company;
    if (!company) add("Linked contractor company");
    for (const [kind, label] of [["public_liability", "Public liability insurance"], ["workers_comp", "Workers compensation insurance"]]) {
      if (!company || !company[`${kind}_file_path`] || company[`${kind}_status`] !== "approved" || !isCurrentOnboardingDate(company[`${kind}_expiry`], now)) add(label);
    }
    if (!company || !company.agreement_file_path || company.agreement_status !== "approved" || !isCurrentOnboardingDate(company.agreement_expiry, now)) add("Current approved contractor agreement");
    if (input.contractorAgreementSignatureMatches !== true) add("Contractor agreement e-signature for the current company document");
    if (company?.nhvas_accreditation && company.nhvas_accreditation !== "None" && (!company.nhvas_file_path || company.nhvas_status !== "approved" || !isCurrentOnboardingDate(company.nhvas_expiry, now))) add("Current approved NHVAS evidence");
    const finance = input.financialDetails;
    if (!finance || !String(finance.bank_account_name ?? "").trim() || !/^\d{6}$/.test(String(finance.bank_bsb ?? "")) || !/^\d{5,10}$/.test(String(finance.bank_account_number ?? "")) || finance.gst_registered === null || finance.gst_registered === undefined || (finance.gst_registered && !finance.gst_effective_date)) add("Contractor bank and GST details");
    if (!finance?.business_details_confirmed_at || !finance?.tax_declaration_at || !finance?.insurance_declaration_at || !finance?.vehicle_declaration_at) add("Contractor business, tax, insurance and vehicle declarations");
    const vehicles = input.vehicles ?? [];
    if (driverRole && vehicles.length === 0) add("At least one registered contractor vehicle");
    if (driverRole) for (const vehicle of vehicles) {
      const label = vehicle.rego || "vehicle";
      if (!vehicle.rego_document_path || vehicle.rego_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.rego_expiry_date, now)) add(`Current approved registration document for ${label}`);
      if (!vehicle.insurance_document_path || vehicle.insurance_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.insurance_document_expiry, now)) add(`Current approved insurance document for ${label}`);
      if (!vehicle.inspection_document_path || vehicle.inspection_document_status !== "approved" || !isCurrentOnboardingDate(vehicle.inspection_document_expiry, now)) add(`Current approved inspection document for ${label}`);
    }
  }
  if (input.requireCompliantCompany && input.employmentType === "contractor" && input.company?.status !== "Compliant") add("Contractor company approval");
  if (input.requireCertificate && input.certificateCurrent !== true) add("Current induction certificate");
  return blockers;
}

export function getChecklistBlockers({ profile, documents = [], progress, employmentType = "employee", company, financialDetails, vehicles = [], policies = [], policyVersions = [], signatures = [], learningSections = [], learningCompletions = [], quizPassed = false, certificate, currentInductionVersionId, requireCompliantCompany = false, requireCertificate = false, payrollSetupComplete = false, requirePayrollSetup = false }, now = new Date()) {
  const staffRole = profile?.staff_role ?? "driver";
  const applicablePolicies = policies.filter((row) => isTargeted(row, employmentType, staffRole));
  const latestVersions = new Map();
  for (const version of [...policyVersions].sort((a, b) => Date.parse(b.published_at ?? "") - Date.parse(a.published_at ?? ""))) {
    if (!latestVersions.has(String(version.policy_id))) latestVersions.set(String(version.policy_id), String(version.id));
  }
  const requiredPolicyVersionIds = applicablePolicies.map((policy) => latestVersions.get(String(policy.id))).filter(Boolean);
  const signedPolicyVersionIds = new Set(signatures.map((row) => String(row.policy_version_id ?? row.policy_id ?? "")));
  const applicableLearning = learningSections.filter((row) => row.is_mandatory !== false && isTargeted(row, employmentType, staffRole));
  const trainingComplete = applicableLearning.every((section) => learningCompletions.some((row) => String(row.section_id) === String(section.id) && String(row.section_version ?? "1.0") === String(section.version ?? "1.0") && row.completed));
  const certificateCurrent = Boolean(certificate && (!certificate.expires_at || isCurrentOnboardingDate(certificate.expires_at, now)) && (currentInductionVersionId == null || String(certificate.induction_version_id ?? "") === String(currentInductionVersionId)));
  const agreementPolicy = applicablePolicies.find((policy) => String(policy.name ?? policy.title ?? "").toLowerCase().includes("contractor services agreement"));
  const agreementVersionId = agreementPolicy ? latestVersions.get(String(agreementPolicy.id)) : null;
  const contractorAgreementSignatureMatches = employmentType !== "contractor" || Boolean(company && agreementVersionId && signatures.some((row) => String(row.policy_version_id ?? "") === agreementVersionId && String(row.contractor_company_id ?? "") === String(company.id) && String(row.contractor_agreement_file_path ?? "") === String(company.agreement_file_path ?? "")));
  return getFinalApprovalBlockers({
    profile, documents, completedStepIds: progress?.completed_step_ids ?? [], trainingComplete,
    quizPassed: Boolean(quizPassed && Number(progress?.quiz_score ?? 0) >= 70),
    declarationAccepted: progress?.declaration_accepted, signature: progress?.signature,
    requiredPolicyVersionIds, signedPolicyVersionIds,
    missingPolicyVersionCount: applicablePolicies.length - requiredPolicyVersionIds.length,
    contractorAgreementSignatureMatches, employmentType, company, financialDetails, vehicles,
    requireCompliantCompany, requireCertificate, certificateCurrent,
    payrollSetupComplete, requirePayrollSetup,
    staffRole
  }, now);
}

export async function getCurrentWorkClearanceBlockers(supabase, userId, now = new Date()) {
  const [profileRes, progressRes, docsRes, membershipRes, policiesRes, sectionsRes, completionsRes, activeVersionRes, signaturesRes, quizRes, certificatesRes, payrollRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("induction_progress").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("documents").select("type, status, expires_at, uploaded_at, work_rights_check_status").eq("user_id", userId),
    supabase.from("contractor_profiles").select("company_id").eq("user_id", userId).maybeSingle(),
    supabase.from("policies").select("id, name, title, audience, target_role, is_published").eq("is_published", true),
    supabase.from("learning_sections").select("id, version, audience, target_role, is_mandatory"),
    supabase.from("learning_section_completions").select("section_id, section_version, completed").eq("user_id", userId),
    supabase.from("induction_versions").select("id").eq("is_current", true).maybeSingle(),
    supabase.from("policy_signatures").select("policy_version_id, policy_id, contractor_company_id, contractor_agreement_file_path").eq("user_id", userId),
    supabase.from("quiz_attempts").select("id").eq("user_id", userId).eq("passed", true).limit(1),
    supabase.from("certificates").select("expires_at, induction_version_id").eq("user_id", userId).order("issued_at", { ascending: false }).limit(1),
    supabase.from("employee_payroll_details").select("tfn_ciphertext, bank_account_name_ciphertext, bank_bsb_ciphertext, bank_account_number_ciphertext, super_fund_choice").eq("user_id", userId).maybeSingle()
  ]);
  const results = [profileRes, progressRes, docsRes, membershipRes, policiesRes, sectionsRes, completionsRes, activeVersionRes, quizRes, certificatesRes, payrollRes];
  for (const result of results) if (result.error) throw result.error;
  let signatures = signaturesRes.data ?? [];
  if (signaturesRes.error?.code === "42703") {
    const fallback = await supabase.from("policy_signatures").select("policy_id").eq("driver_id", userId);
    if (fallback.error) throw fallback.error;
    signatures = fallback.data ?? [];
  } else if (signaturesRes.error) throw signaturesRes.error;
  const profile = profileRes.data;
  const progress = progressRes.data;
  const membership = membershipRes.data;
  const employmentType = profile?.employment_type === "contractor" || Boolean(membership?.company_id) ? "contractor" : "employee";
  const staffRole = profile?.staff_role ?? "driver";
  const policyRows = policiesRes.data ?? [];
  const policyIds = policyRows.filter((item) => isTargeted(item, employmentType, staffRole)).map((item) => item.id);
  const policyVersionsRes = policyIds.length ? await supabase.from("policy_versions").select("id, policy_id, published_at").in("policy_id", policyIds).order("published_at", { ascending: false }) : { data: [], error: null };
  if (policyVersionsRes.error) throw policyVersionsRes.error;
  let company = null, financialDetails = null, vehicles = [];
  if (employmentType === "contractor" && membership?.company_id) {
    const [companyRes, financeRes, vehiclesRes] = await Promise.all([
      supabase.from("contractor_companies").select("*").eq("id", membership.company_id).maybeSingle(),
      supabase.from("contractor_financial_details").select("*").eq("company_id", membership.company_id).maybeSingle(),
      staffRole === "driver" ? supabase.from("driver_vehicles").select("*").eq("user_id", userId).eq("status", "Active") : Promise.resolve({ data: [], error: null })
    ]);
    for (const result of [companyRes, financeRes, vehiclesRes]) if (result.error) throw result.error;
    company = companyRes.data;
    financialDetails = financeRes.data;
    vehicles = vehiclesRes.data ?? [];
  }
  const latestVersionByPolicy = new Map();
  for (const version of policyVersionsRes.data ?? []) if (!latestVersionByPolicy.has(String(version.policy_id))) latestVersionByPolicy.set(String(version.policy_id), String(version.id));
  const latestVersions = [...latestVersionByPolicy.values()];
  const certificate = (certificatesRes.data ?? []).find((row) => !activeVersionRes.data?.id || String(row.induction_version_id ?? "") === String(activeVersionRes.data.id));
  return getChecklistBlockers({
    profile, progress, documents: docsRes.data ?? [], employmentType, company, financialDetails, vehicles,
    policies: policyRows, policyVersions: policyVersionsRes.data ?? [], signatures,
    learningSections: sectionsRes.data ?? [], learningCompletions: completionsRes.data ?? [],
    quizPassed: Boolean(quizRes.data?.length), certificate,
    currentInductionVersionId: activeVersionRes.data?.id ?? null,
    requireCompliantCompany: true, requireCertificate: true,
    requirePayrollSetup: employmentType !== "contractor",
    payrollSetupComplete: Boolean(payrollRes.data?.tfn_ciphertext && payrollRes.data?.bank_account_name_ciphertext && payrollRes.data?.bank_bsb_ciphertext && payrollRes.data?.bank_account_number_ciphertext && payrollRes.data?.super_fund_choice)
  }, now);
}
