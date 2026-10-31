export function isWorkerTargeted(item, employmentType = "employee", staffRole = "driver") {
  const audience = item?.audience ?? "all";
  const targetRole = item?.target_role ?? item?.targetRole ?? "all";
  const audienceMatches = audience === "all" || audience === employmentType;
  const roleMatches = targetRole === "all" || targetRole === staffRole;
  return audienceMatches && roleMatches;
}

export function getRequiredDocumentTypes(employmentType = "employee", staffRole = "driver") {
  const required = ["right_to_work"];
  if (staffRole === "driver") required.unshift("driver_license", "medical_certificate");
  return required;
}
