/** @param {any} profile
 * @param {any} membership
 * @param {any} company
 */
export function mapDriverEmployment(profile, membership, company) {
  return {
    employmentType: profile?.employment_type === "contractor" || Boolean(membership) ? "contractor" : "employee",
    staffRole: profile?.staff_role === "warehouse" || profile?.staff_role === "office" ? profile.staff_role : "driver",
    contractorCompanyId: membership?.company_id ?? null,
    contractorCompanyName: membership?.company_id && company
      ? String(company.company_name || company.trading_name || "")
      : null
  };
}
