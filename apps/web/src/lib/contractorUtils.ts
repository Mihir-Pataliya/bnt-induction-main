import type { ContractorCompanyRecord } from "../types";
export { validateABN, validateACN } from "./contractorValidation.mjs";
import { computeContractorStatus as computeStatusCore } from "./contractorComplianceCore.mjs";

export function formatABNDisplay(rawAbn: string): string {
  const digits = rawAbn.replace(/\s+/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}

export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((parsed.getTime() - today.getTime()) / 86400000);
}

export function computeContractorStatus(contractor: ContractorCompanyRecord): {
  label: string;
  tone: "green" | "amber" | "red" | "grey";
} {
  return computeStatusCore(contractor);
}
