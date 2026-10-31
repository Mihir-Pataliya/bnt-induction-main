/** @param {{ audience?: string | null, target_role?: string | null }} policy
 * @param {string | null | undefined} employmentType
 * @param {string | null | undefined} staffRole
 */
export function isPolicyApplicableToWorker(policy, employmentType, staffRole) {
  const audienceMatches = !policy.audience || policy.audience === "all" || policy.audience === employmentType;
  const roleMatches = !policy.target_role || policy.target_role === "all" || policy.target_role === (staffRole || "driver");
  return audienceMatches && roleMatches;
}
