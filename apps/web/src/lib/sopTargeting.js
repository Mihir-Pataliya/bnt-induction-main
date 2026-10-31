export function isSOPApplicableToWorker(module, employmentType, staffRole = "driver") {
  const audience = module.audience ?? "all";
  const targetRole = module.target_role ?? module.targetRole ?? "all";
  return (audience === "all" || audience === employmentType) &&
    (targetRole === "all" || targetRole === staffRole);
}
