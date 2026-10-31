import type { OrganisationalChartRole } from "../../types";

export function createInitialOrganisationalChartRoles(): OrganisationalChartRole[] {
  return [
    ["operator", "Operator/Owner/Director"], ["record-keeper", "Record Keeper"],
    ["manager", "Manager"], ["administrator", "Administrator/Scheduler"],
    ["loader", "Loader/Unloader"], ["workshop", "Workshop Manager"],
    ["compliance", "Compliance"], ["driver-1", "Driver"]
  ].map(([id, title]) => ({ id, title, employeeId: null, notApplicable: false }));
}
