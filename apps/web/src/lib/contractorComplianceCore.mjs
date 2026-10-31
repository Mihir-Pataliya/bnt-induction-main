function daysRemaining(date, now) {
  const parts = String(date).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part)) || parts[0] < 1900 || parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31) return null;
  const expiry = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const normalized = new Date(expiry);
  if (normalized.getUTCFullYear() !== parts[0] || normalized.getUTCMonth() !== parts[1] - 1 || normalized.getUTCDate() !== parts[2]) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expiry - today) / 86_400_000);
}

function renewalLabel(days) {
  if (days === 0) return "Renewal due today";
  if (days <= 30) return `Renewal due in ${days} day${days === 1 ? "" : "s"}`;
  return "Renewal not due";
}

export function assessContractorInsurance(filePath, expiryDate, reviewStatus, now = new Date()) {
  if (!filePath) return { status: "missing_information", valid: false, daysRemaining: expiryDate ? daysRemaining(expiryDate, now) : null, renewalStatus: "Insurance document missing" };
  if (!expiryDate) return { status: "missing_information", valid: false, daysRemaining: null, renewalStatus: "Expiry date missing" };
  const remaining = daysRemaining(expiryDate, now);
  if (remaining === null) return { status: "missing_information", valid: false, daysRemaining: null, renewalStatus: "Expiry date invalid" };
  if (remaining < 0) return { status: "expired", valid: false, daysRemaining: remaining, renewalStatus: `Expired ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} ago` };
  if (reviewStatus === "rejected") return { status: "rejected", valid: false, daysRemaining: remaining, renewalStatus: renewalLabel(remaining) };
  if (reviewStatus !== "approved") return { status: "pending", valid: false, daysRemaining: remaining, renewalStatus: renewalLabel(remaining) };
  if (remaining <= 30) return { status: "expiring_soon", valid: true, daysRemaining: remaining, renewalStatus: renewalLabel(remaining) };
  return { status: "valid", valid: true, daysRemaining: remaining, renewalStatus: renewalLabel(remaining) };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((parsed.getTime() - today.getTime()) / 86400000);
}

export function computeContractorStatus(contractor) {
  if (contractor.status === "Suspended") return { label: "Suspended", tone: "red" };
  if (contractor.businessDetailsComplete === false || contractor.vehicleComplianceComplete === false) return { label: "Pending Review", tone: "grey" };
  const assessments = [
    assessContractorInsurance(contractor.publicLiabilityFileUrl, contractor.publicLiabilityExpiry, contractor.publicLiabilityStatus),
    assessContractorInsurance(contractor.workersCompFileUrl, contractor.workersCompExpiry, contractor.workersCompStatus),
    assessContractorInsurance(contractor.agreementFileUrl, contractor.agreementExpiry, contractor.agreementStatus),
    ...(contractor.nhvasAccreditation !== "None" ? [assessContractorInsurance(contractor.nhvasFileUrl, contractor.nhvasExpiry, contractor.nhvasStatus)] : [])
  ];
  if (assessments.some((assessment) => assessment.status === "expired")) return { label: "Expired", tone: "red" };
  if (assessments.some((assessment) => assessment.status === "expiring_soon")) return { label: "Expiring Soon", tone: "amber" };
  if (assessments.some((assessment) => !assessment.valid)) return { label: "Pending Review", tone: "grey" };
  return contractor.status === "Compliant" ? { label: "Compliant", tone: "green" } : { label: "Pending Review", tone: "grey" };
}
