export function mapDriverEmployment(
  profile: { employment_type?: string | null; staff_role?: string | null } | null | undefined,
  membership: { company_id?: string | null } | null | undefined,
  company: { company_name?: string | null; trading_name?: string | null } | null | undefined
): {
  employmentType: "employee" | "contractor";
  staffRole: "driver" | "warehouse" | "office";
  contractorCompanyId: string | null;
  contractorCompanyName: string | null;
};
