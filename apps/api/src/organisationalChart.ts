import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateOrganisationalChartPdf } from "./organisationalChartPdf.js";

export const chartRoles = [
  ["operator", "Operator/Owner/Director"], ["record-keeper", "Record Keeper"],
  ["manager", "Manager"], ["administrator", "Administrator/Scheduler"],
  ["loader", "Loader/Unloader"], ["workshop", "Workshop Manager"],
  ["compliance", "Compliance"]
] as const;

export const chartInputSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required.").max(200),
  dateCompleted: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date completed is required.").refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid completion date."),
  roles: z.array(z.object({
    id: z.string().min(1).max(80), title: z.string().trim().min(1).max(100),
    employeeId: z.string().uuid().nullable(), notApplicable: z.boolean()
  })).min(8).max(107)
}).superRefine(({ roles }, context) => {
  const ids = new Set(roles.map((role) => role.id));
  if (ids.size !== roles.length) context.addIssue({ code: "custom", message: "Role identifiers must be unique." });
  for (const [id, title] of chartRoles) {
    if (!roles.some((role) => role.id === id && role.title === title)) context.addIssue({ code: "custom", message: `${title} is required.` });
  }
  if (!roles.some((role) => role.id.startsWith("driver-") && role.title === "Driver")) context.addIssue({ code: "custom", message: "At least one Driver position is required." });
  const drivers = new Set<string>();
  for (const role of roles) {
    if (!chartRoles.some(([id, title]) => id === role.id && title === role.title) && !(role.id.startsWith("driver-") && role.title === "Driver")) {
      context.addIssue({ code: "custom", message: "Unknown chart role." });
    }
    if (!role.notApplicable && !role.employeeId) context.addIssue({ code: "custom", message: `Assign an employee to ${role.title} or select N/A.` });
    if (role.notApplicable && role.employeeId) context.addIssue({ code: "custom", message: "N/A roles cannot have an employee assigned." });
    if (role.title === "Driver" && role.employeeId) {
      if (drivers.has(role.employeeId)) context.addIssue({ code: "custom", message: "The same employee cannot occupy two Driver positions." });
      drivers.add(role.employeeId);
    }
  }
});

export async function getChartEmployees(db: SupabaseClient) {
  const employees: Array<{ id: string; fullName: string }> = [];
  // Supabase caps results per request; do not silently truncate the register.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("profiles").select("id, full_name, employment_type")
      .order("id").range(offset, offset + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.employment_type !== "contractor" && row.full_name && !row.full_name.startsWith("[DELETED]")) {
        employees.push({ id: row.id, fullName: row.full_name });
      }
    }
    if ((data?.length ?? 0) < 1000) break;
  }
  return employees.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function handleOrganisationalChart(db: SupabaseClient, adminId: string, method: string, action: string, body?: unknown) {
  if (action === "employees" && method === "GET") return { employees: await getChartEmployees(db) };
  if (action === "" && method === "GET") {
    const { data, error } = await db.from("organisational_charts").select("company_name, date_completed, roles, updated_at").eq("id", "default").maybeSingle();
    if (error) throw error;
    return { chart: data ? { companyName: data.company_name, dateCompleted: data.date_completed, roles: data.roles, updatedAt: data.updated_at } : null };
  }
  const input = chartInputSchema.parse(body);
  const employees = await getChartEmployees(db);
  const employeeIds = new Set(employees.map((employee) => employee.id));
  if (input.roles.some((role) => role.employeeId && !employeeIds.has(role.employeeId))) {
    throw new z.ZodError([{ code: "custom", path: ["roles"], message: "An assigned employee is no longer available. Reload and reassign the affected role." }]);
  }
  if (action === "pdf" && method === "POST") {
    return generateOrganisationalChartPdf({ ...input, roles: input.roles.map((role) => ({ ...role, employeeName: employees.find((employee) => employee.id === role.employeeId)?.fullName ?? "N/A" })) });
  }
  const { data, error } = await db.from("organisational_charts").upsert({
    id: "default", company_name: input.companyName, date_completed: input.dateCompleted,
    roles: input.roles, updated_by: adminId, updated_at: new Date().toISOString()
  }).select("company_name, date_completed, roles, updated_at").single();
  if (error) throw error;
  return { chart: { companyName: data.company_name, dateCompleted: data.date_completed, roles: data.roles, updatedAt: data.updated_at } };
}