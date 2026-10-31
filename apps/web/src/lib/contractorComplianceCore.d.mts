export type InsuranceReviewStatus = "pending" | "approved" | "rejected" | undefined;
export type InsuranceComplianceStatus = "missing_information" | "expired" | "expiring_soon" | "valid" | "pending" | "rejected";
export interface InsuranceAssessment { status: InsuranceComplianceStatus; valid: boolean; daysRemaining: number | null; renewalStatus: string }
export function assessContractorInsurance(filePath: string | null | undefined, expiryDate: string | null | undefined, reviewStatus: InsuranceReviewStatus, now?: Date): InsuranceAssessment;
export function computeContractorStatus(contractor: any): { label: string; tone: "green" | "amber" | "red" | "grey" };
