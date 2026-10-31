import { ComplianceDocumentRequirement, DocumentType, UploadedDocument } from "../types";
import { getRequiredDocumentTypes } from "./workerTargeting.js";

export const REQUIRED_DRIVER_DOCUMENTS: Array<{ type: DocumentType; name: string; category: ComplianceDocumentRequirement["category"] }> = [
  { type: "driver_license", name: "Driver Licence", category: "Licence" },
  { type: "medical_certificate", name: "Medical Certificate", category: "Certificates" },
  { type: "right_to_work", name: "Right to Work", category: "Certificates" }
];
export const REQUIRED_EXPIRY_DOCUMENT_TYPES: DocumentType[] = ["driver_license", "medical_certificate"];

export type DriverDocumentStatus = "missing" | "missing_expiry" | "pending" | "approved" | "rejected" | "expired";

export function getDriverDocumentStatus(
  document: Pick<UploadedDocument, "status" | "expiresAt"> | null | undefined,
  now = Date.now(),
  requireExpiry = false
): DriverDocumentStatus {
  if (!document) return "missing";
  if (document.status === "rejected") return "rejected";
  if (document.status !== "approved") return "pending";
  if (!document.expiresAt) return requireExpiry ? "missing_expiry" : "approved";
  const dateText = document.expiresAt.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return "expired";
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const expiry = Date.UTC(year, month - 1, day);
  const parsed = new Date(expiry);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return "expired";
  const todayDate = new Date(now);
  const today = Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate());
  if (expiry < today) {
    return "expired";
  }
  return "approved";
}

export function isApprovedCurrentDocument(
  document: Pick<UploadedDocument, "status" | "expiresAt"> | null | undefined,
  now = Date.now(),
  requireExpiry = false
): boolean {
  return getDriverDocumentStatus(document, now, requireExpiry) === "approved";
}

export function toComplianceDocumentRequirements(
  documents: UploadedDocument[],
  employmentType: "employee" | "contractor" = "employee",
  staffRole: "driver" | "warehouse" | "office" = "driver"
): ComplianceDocumentRequirement[] {
  const requiredTypes = new Set(getRequiredDocumentTypes(employmentType, staffRole) as DocumentType[]);
  const latestByType = new Map<DocumentType, UploadedDocument>();
  for (const document of documents) {
    if (!latestByType.has(document.type)) latestByType.set(document.type, document);
  }

  const applicableRequirements = REQUIRED_DRIVER_DOCUMENTS.filter(({ type }) => requiredTypes.has(type));
  const required = applicableRequirements.map(({ type, name, category }) => {
    const document = latestByType.get(type);
    return toComplianceDocument(document, type, name, category, true, REQUIRED_EXPIRY_DOCUMENT_TYPES.includes(type));
  });
  const optional = documents
    .filter((document) => !requiredTypes.has(document.type))
    .map((document) => toComplianceDocument(document, document.type, document.name, "Certificates", false, false));
  return [...required, ...optional];
}

function toComplianceDocument(
  document: UploadedDocument | undefined,
  type: DocumentType,
  name: string,
  category: ComplianceDocumentRequirement["category"],
  isMandatory: boolean,
  requireExpiry: boolean
): ComplianceDocumentRequirement {
  const status = getDriverDocumentStatus(document, Date.now(), requireExpiry);
  const displayStatus: ComplianceDocumentRequirement["status"] =
    status === "approved" ? "Approved" : status === "expired" ? "Expired" : status === "missing_expiry" ? "Action Required" : status === "rejected" ? "Rejected" : status === "pending" ? "Pending" : "Not Submitted";
  return {
    id: document?.id ?? `missing:${type}`,
    name,
    category,
    isMandatory,
    expiryDate: document?.expiresAt ? document.expiresAt.split("T")[0] : null,
    status: displayStatus,
    historyStatus: displayStatus,
    uploadedFileUrl: document?.fileUrl ?? null,
    uploadedFileDownloadUrl: document?.fileDownloadUrl ?? null,
    uploadedFileName: document?.name ?? null,
    uploadedAt: document?.uploadedAt ? document.uploadedAt.split("T")[0] : null,
    rejectionReason: document?.rejectionReason ?? null,
    documentType: type
  };
}
