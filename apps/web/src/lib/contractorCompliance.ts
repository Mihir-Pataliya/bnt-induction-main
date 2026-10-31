import { DocumentType } from "../types";
import { getDriverDocumentStatus, isApprovedCurrentDocument, REQUIRED_DRIVER_DOCUMENTS, REQUIRED_EXPIRY_DOCUMENT_TYPES } from "./documentCompliance";
export { assessContractorInsurance } from "./contractorComplianceCore.mjs";

export type InsuranceReviewStatus = "pending" | "approved" | "rejected" | undefined;
export type InsuranceComplianceStatus = "missing_information" | "expired" | "expiring_soon" | "valid" | "pending" | "rejected";

export interface InsuranceAssessment { status: InsuranceComplianceStatus; valid: boolean; daysRemaining: number | null; renewalStatus: string; }

export interface ContractorWorkerInput {
  position: string;
  startDate: string;
  policiesSigned: number;
  policiesRequired: number;
  profileComplete?: boolean;
  companyAgreementComplete?: boolean;
  businessDetailsComplete?: boolean;
  vehicleComplianceComplete?: boolean;
  driver?: {
    documents: Array<{ type: DocumentType; status: "pending" | "approved" | "rejected"; expiresAt: string | null }>;
    completionPercentage: number;
  } | null;
}

export interface ContractorWorkerProgress {
  done: number;
  total: number;
  complete: boolean;
  missingTasks: string[];
  approvedDocuments: number;
}

export function getContractorWorkerProgress(worker: ContractorWorkerInput): ContractorWorkerProgress {
  const missingTasks: string[] = [];
  if (!worker.position.trim()) missingTasks.push("Worker details");
  if (!worker.startDate.trim()) missingTasks.push("Start date");
  if (worker.profileComplete === false) missingTasks.push("Driver profile");
  if (worker.companyAgreementComplete === false) missingTasks.push("Current approved contractor agreement");
  if (worker.businessDetailsComplete === false) missingTasks.push("Contractor bank, GST and declarations");
  if (worker.vehicleComplianceComplete === false) missingTasks.push("Vehicle compliance documents");
  const approvedTypes = new Set<DocumentType>();
  for (const requirement of REQUIRED_DRIVER_DOCUMENTS) {
    const document = worker.driver?.documents.find((item) => item.type === requirement.type);
    const requireExpiry = REQUIRED_EXPIRY_DOCUMENT_TYPES.includes(requirement.type);
    if (isApprovedCurrentDocument(document, Date.now(), requireExpiry)) approvedTypes.add(requirement.type);
    else missingTasks.push(`${requirement.name}: ${getDriverDocumentStatus(document, Date.now(), requireExpiry)}`);
  }
  const policyCount = Math.max(0, worker.policiesRequired);
  const signedCount = Math.min(policyCount, Math.max(0, worker.policiesSigned));
  if (signedCount < policyCount) missingTasks.push(`Policies (${signedCount}/${policyCount})`);
  if ((worker.driver?.completionPercentage ?? 0) < 100) missingTasks.push("Induction & training");
  const profileTask = worker.profileComplete === undefined ? 0 : 1;
  const agreementTask = worker.companyAgreementComplete === undefined ? 0 : 1;
  const businessTask = worker.businessDetailsComplete === undefined ? 0 : 1;
  const vehicleTask = worker.vehicleComplianceComplete === undefined ? 0 : 1;
  const total = 6 + policyCount + profileTask + agreementTask + businessTask + vehicleTask;
  const done = Number(Boolean(worker.position.trim())) + Number(Boolean(worker.startDate.trim())) + profileTask * Number(worker.profileComplete !== false) + agreementTask * Number(worker.companyAgreementComplete !== false) + businessTask * Number(worker.businessDetailsComplete !== false) + vehicleTask * Number(worker.vehicleComplianceComplete !== false) + approvedTypes.size + signedCount + Number((worker.driver?.completionPercentage ?? 0) >= 100);
  return {
    done,
    total,
    complete: done === total,
    missingTasks,
    approvedDocuments: approvedTypes.size
  };
}
