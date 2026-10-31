import test from "node:test";
import assert from "node:assert/strict";
import { chartInputSchema, chartRoles, getChartEmployees, handleOrganisationalChart } from "./organisationalChart.js";
import { generateOrganisationalChartPdf } from "./organisationalChartPdf.js";
import type { SupabaseClient } from "@supabase/supabase-js";

const employeeId = "11111111-1111-4111-8111-111111111111";
const input = () => ({ companyName: "BNT (Logistics)", dateCompleted: "2026-10-22", roles: [
  ...chartRoles.map(([id, title]) => ({ id, title, employeeId, notApplicable: false })),
  { id: "driver-1", title: "Driver", employeeId, notApplicable: false }
] });

test("validates required fields, dates, canonical roles, unique drivers and N/A", () => {
  assert.equal(chartInputSchema.safeParse(input()).success, true);
  for (const patch of [{ companyName: " " }, { dateCompleted: "2026-02-30" }, { dateCompleted: "" }, { roles: [] }]) {
    assert.equal(chartInputSchema.safeParse({ ...input(), ...patch }).success, false);
  }
  const chart = input();
  chart.roles[0].notApplicable = true;
  assert.equal(chartInputSchema.safeParse(chart).success, false);
  const naChart = { ...chart, roles: chart.roles.map((role) => ({ ...role, employeeId: null, notApplicable: true })) };
  assert.equal(chartInputSchema.safeParse(naChart).success, true);
  chart.roles.push({ ...chart.roles[7], id: "driver-2" });
  assert.equal(chartInputSchema.safeParse(chart).success, false);
});

test("save, reload and edit use a singleton chart and never insert employees", async () => {
  let saved: any = null;
  const db = { from(table: string) {
    if (table === "profiles") return { select: () => ({ order: () => ({ range: async () => ({ data: [{ id: employeeId, full_name: "Existing Employee", employment_type: "employee" }], error: null }) }) }) };
    assert.equal(table, "organisational_charts");
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: saved, error: null }) }) }),
      upsert: (row: unknown) => { saved = row; return { select: () => ({ single: async () => ({ data: saved, error: null }) }) }; }
    };
  } } as unknown as SupabaseClient;
  assert.deepEqual(await handleOrganisationalChart(db, employeeId, "GET", ""), { chart: null });
  await handleOrganisationalChart(db, employeeId, "PUT", "", input());
  assert.equal(saved.id, "default");
  const loaded: any = await handleOrganisationalChart(db, employeeId, "GET", "");
  assert.equal(loaded.chart.companyName, input().companyName);
  await handleOrganisationalChart(db, employeeId, "PUT", "", { ...input(), companyName: "Edited company" });
  assert.equal(saved.company_name, "Edited company");
  await assert.rejects(handleOrganisationalChart(db, employeeId, "PUT", "", { ...input(), roles: input().roles.map((role) => ({ ...role, employeeId: "22222222-2222-4222-8222-222222222222" })) }), /no longer available/);
  const pdf = await handleOrganisationalChart(db, employeeId, "POST", "pdf", input());
  assert.ok(Buffer.isBuffer(pdf));
});

test("employee register is paginated and excludes contractors and deleted profiles", async () => {
  let requests = 0;
  const db = { from: () => ({ select: () => ({ order: () => ({ range: async () => {
    requests++;
    return { error: null, data: requests === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: String(i), full_name: `Employee ${i}`, employment_type: "employee" })) : [
      { id: "last", full_name: "Last Employee" }, { id: "deleted", full_name: "[DELETED]" }, { id: "contractor", full_name: "Contractor", employment_type: "contractor" }
    ] };
  } }) }) }) } as unknown as SupabaseClient;
  assert.equal((await getChartEmployees(db)).length, 1001);
  assert.equal(requests, 2);
});

test("PDF contains all positions, escaped names and valid cross-reference offsets across pages", () => {
  const chart = input();
  const roles = [...chart.roles, ...Array.from({ length: 30 }, (_, i) => ({ id: `driver-${i + 2}`, title: "Driver", employeeId, notApplicable: false }))].map((role, i) => ({ ...role, employeeName: `Person ${i} (Test)` }));
  const pdf = generateOrganisationalChartPdf({ ...chart, roles });
  const text = pdf.toString("ascii");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes("BNT \\(Logistics\\)"));
  assert.ok(text.includes(`Person ${roles.length - 1}`));
  assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 4);
  const xref = Number(text.match(/startxref\n(\d+)/)![1]);
  assert.equal(text.slice(xref, xref + 4), "xref");
  const offsets = [...text.matchAll(/(\d{10}) 00000 n/g)].map((match) => Number(match[1]));
  offsets.forEach((offset, index) => assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj`)));
});