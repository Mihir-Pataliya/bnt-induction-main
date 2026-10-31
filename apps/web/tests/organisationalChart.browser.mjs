import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Isolated HTTP fixtures test the real COR component without touching live data.
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, css: { postcss: { plugins: [(await import("tailwindcss")).default({ config: resolve(root, "tailwind.config.js") }), (await import("autoprefixer")).default()] } }, server: { host: "127.0.0.1", port: 5199 }, plugins: [{ name: "chart-test-entry", configureServer(server) {
  server.middlewares.use("/__chart_test", async (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml("/__chart_test", '<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/tests/organisationalChart.harness.tsx"></script></body></html>'));
  });
} }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  await page.addInitScript(() => {
    window.print = () => {
      const count = Number(window.sessionStorage.getItem("handout-print-count") ?? "0");
      window.sessionStorage.setItem("handout-print-count", String(count + 1));
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/admin/organisational-chart") || url.includes("/admin/profiles") || url.endsWith("/employees")) {
      const body = request.postData();
      if (body) {
        try { const parsed = JSON.parse(body); if (parsed.roles?.some((role) => role.employeeId?.startsWith("222"))) errors.push("Inserted employee id instead of referencing it"); } catch {}
      }
    }
  });
  const employee = { id: "11111111-1111-4111-8111-111111111111", fullName: "Test Employee" };
  let saved = null;
  let failSave = false;
  const registerRecords = [
    { id: "employee:cor:1", workerName: "Test Employee", workerType: "employee", role: "administrator", trainingTitle: "CoR Induction", completionDate: "2025-10-21T00:00:00.000Z", status: "completed" },
    { id: "employee:fatigue:1", workerName: "Test Employee", workerType: "employee", role: "administrator", trainingTitle: "Fatigue Awareness", completionDate: "", status: "in_progress" },
    { id: "contractor:vehicle:1", workerName: "Test Subcontractor", workerType: "subcontractor", role: "driver", trainingTitle: "Vehicle Safety", completionDate: "2025-10-18T00:00:00.000Z", status: "completed" }
  ];
  const registerMethods = [];
  await page.route("**/api/admin/organisational-chart**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/employees")) return route.fulfill({ json: { employees: [employee] } });
    if (path.endsWith("/pdf")) {
      assert.equal(route.request().method(), "POST");
      return route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.4\n%%EOF") });
    }
    if (route.request().method() === "PUT") {
      if (failSave) return route.fulfill({ status: 500, json: { message: "Test save failure" } });
      saved = { ...route.request().postDataJSON(), updatedAt: new Date().toISOString() };
    }
    return route.fulfill({ json: { chart: saved } });
  });
  await page.route("**/api/admin/training-induction-register**", async (route) => {
    const method = route.request().method();
    registerMethods.push(method);
    if (method === "GET") return route.fulfill({ json: { records: registerRecords } });
    return route.fulfill({ status: 405, json: { message: "Method not allowed." } });
  });
  const openChart = async () => {
    await page.getByRole("button", { name: "Organisational Chart", exact: true }).click();
    await page.getByRole("button", { name: "Save Changes", exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  };
  await page.goto("http://127.0.0.1:5199/__chart_test");
  await page.getByRole("button", { name: "Induction Handout", exact: true }).click();
  const roleSelect = page.getByLabel("Employee job role");
  const handoutRoles = ["Manager/Operator", "Administrator", "Scheduler", "Workshop Manager", "Loader/Unloader", "Driver"];
  assert.deepEqual(await roleSelect.locator("option").evaluateAll((options) => options.slice(1).map((option) => option.textContent)), handoutRoles);
  const roleChecks = [
    ["Manager/Operator", "Exercise due diligence"],
    ["Administrator", "No Administrator role is defined in the source manual."],
    ["Scheduler", "Check driver hours available before allocation."],
    ["Workshop Manager", "Rectify reported defects before the vehicle returns to service."],
    ["Loader/Unloader", "Load vehicles evenly and within limits."],
    ["Driver", "Vehicle Pre-Start Checklist (F-03, Gearbox app)"]
  ];
  for (const [role, expectedText] of roleChecks) {
    await roleSelect.selectOption({ label: role });
    await page.getByRole("heading", { name: role, exact: true }).waitFor();
    await page.getByText(expectedText, { exact: false }).waitFor();
  }
  await page.getByRole("button", { name: "Print", exact: true }).click();
  assert.equal(await page.evaluate(() => window.sessionStorage.getItem("handout-print-count")), "1");
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  assert.equal(await page.evaluate(() => window.sessionStorage.getItem("handout-print-count")), "2");
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".ih-noprint").first().evaluate((element) => getComputedStyle(element).display), "none");
  const handoutPdf = await page.pdf({ printBackground: true });
  assert.equal(handoutPdf.subarray(0, 5).toString(), "%PDF-");
  await page.emulateMedia({ media: "screen" });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.locator(".induction-handout-page").evaluate((element) => element.scrollWidth <= element.clientWidth), `Handout has no horizontal overflow at ${width}px`);
  }
  await page.getByRole("button", { name: "Back to Inductions and Training" }).click();
  await openChart();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Enter the company name" }).waitFor();
  await page.getByLabel("Date completed").fill("2026-10-22");
  await page.locator("select").first().selectOption(employee.id);
  const checkboxes = page.locator('input[type="checkbox"]');
  for (let i = 1; i < await checkboxes.count(); i++) await checkboxes.nth(i).check();
  await page.getByRole("button", { name: "Add Another Driver" }).click();
  await page.getByRole("button", { name: "Remove Driver 2" }).click();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "saved successfully" }).waitFor();
  await page.reload(); await openChart();
  assert.equal(await page.getByLabel("Date completed").inputValue(), "2026-10-22");
  assert.equal(await page.locator("select").first().inputValue(), employee.id);
  await page.getByLabel("Company name").fill("Edited Test Company");
  failSave = true;
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test save failure" }).waitFor();
  failSave = false;
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "saved successfully" }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /organisational-chart-2026-10-22.pdf/);
  assert.equal(await download.failure(), null);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.locator(".oc-page").evaluate((element) => element.scrollWidth <= element.clientWidth), `No horizontal overflow at ${width}px`);
  }
  // Verify existing unrelated features remain unchanged after navigation
  await page.getByRole("button", { name: "Back to Inductions and Training" }).click();
  await page.getByRole("button", { name: "Annual System Review", exact: true }).click();
  await page.getByRole("button", { name: "Back to Inductions and Training" }).click();
  await openChart();
  assert.equal(await page.getByLabel("Company name").inputValue(), "Edited Test Company");
  await page.getByRole("button", { name: "Back to Inductions and Training" }).click();
  await page.getByRole("button", { name: "Employee/Subcontractor Register – Training and Induction", exact: true }).click();
  await page.getByRole("heading", { name: "Employee/Subcontractor Register – Training and Induction" }).waitFor();
  assert.equal(await page.locator("article").count(), 3, "Existing completion rows include multiple modules per worker and subcontractors");
  assert.equal(await page.getByRole("button", { name: "Add Training Entry" }).count(), 0, "Register does not create duplicate training entries");
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 0, "Existing module records are read-only");
  await page.getByText("Test Employee", { exact: true }).first().waitFor();
  await page.getByText(/administrator/i).first().waitFor();
  await page.getByText("Subcontractor", { exact: true }).first().waitFor();
  await page.getByText("Completed", { exact: true }).first().waitFor();
  await page.getByText("In progress", { exact: true }).waitFor();
  await page.getByText(/2025/).first().waitFor();
  await page.getByText(/Not completed/).waitFor();
  const fatigueRecord = page.locator("article").filter({ hasText: "Fatigue Awareness" }).filter({ hasText: "Test Employee" });
  await fatigueRecord.getByRole("button", { name: "View", exact: true }).click();
  await fatigueRecord.getByText("Completion date", { exact: true }).waitFor();
  const searchRegister = page.getByRole("searchbox", { name: "Search register" });
  await searchRegister.fill("Fatigue");
  assert.equal(await page.locator("article").count(), 1, "Search matches training title");
  await searchRegister.fill("Test Employee");
  assert.equal(await page.locator("article").count(), 2, "Search matches employee name across multiple modules");
  await searchRegister.fill("Test Subcontractor");
  assert.equal(await page.locator("article").count(), 1, "Subcontractor records are searchable");
  await searchRegister.fill("");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.locator("article").filter({ hasText: "Fatigue Awareness" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Employee/Subcontractor Register – Training and Induction", exact: true }).click();
  assert.equal(await page.locator("article").count(), 3, "Existing module completion records load again after page refresh");
  assert.ok(registerMethods.length >= 3 && registerMethods.every((method) => method === "GET"), "Register only reads existing completion records");
  assert.deepEqual(errors, []);
  console.log("PASS: handout roles, read-only completion register/search/refresh, print/PDF, COR navigation and existing chart workflows.");
} finally { await browser?.close(); await server.close(); }