import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const supabaseUrl = "https://wbrculvtacfkjzqhhoue.supabase.co";
const adminId = "11111111-1111-4111-8111-111111111111";
const driverId = "22222222-2222-4222-8222-222222222222";
const server = await createServer({
  root,
  css: { postcss: { plugins: [(await import("tailwindcss")).default({ config: resolve(root, "tailwind.config.js") }), (await import("autoprefixer")).default()] } },
  server: { host: "127.0.0.1", port: 5200 },
  plugins: [{
    name: "safe-driving-plan-test-entry",
    configureServer(vite) {
      vite.middlewares.use("/__safe_driving_plan_test", async (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await vite.transformIndexHtml("/__safe_driving_plan_test", '<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/tests/safeDrivingPlan.harness.tsx"></script></body></html>'));
      });
    }
  }]
});

let browser;
const rows = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(`${supabaseUrl}/rest/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/profiles")) {
      return route.fulfill({ json: [{ id: driverId, full_name: "Test Driver", email: "driver@test.local", role: "driver" }] });
    }
    assert.ok(url.pathname.endsWith("/cor_form_submissions"), `Unexpected Supabase endpoint: ${url.pathname}`);
    if (request.method() === "GET") {
      let matches = rows.filter((row) => row.form_code === url.searchParams.get("form_code")?.replace("eq.", ""));
      const userFilter = url.searchParams.get("user_id");
      if (userFilter) matches = matches.filter((row) => row.user_id === userFilter.replace("eq.", ""));
      return route.fulfill({ json: matches });
    }
    if (request.method() === "POST") {
      const inserted = {
        id: "33333333-3333-4333-8333-333333333333",
        submitted_at: new Date().toISOString(),
        ...request.postDataJSON()
      };
      rows.push(inserted);
      return route.fulfill({ status: 201, json: inserted });
    }
    if (request.method() === "PATCH") {
      const idFilter = url.searchParams.get("id")?.replace("eq.", "");
      const row = rows.find((candidate) => candidate.id === idFilter);
      assert.ok(row, "Expected assigned plan to exist before update");
      const update = request.postDataJSON();
      if (new URL(page.url()).searchParams.get("role") === "driver") {
        assert.equal(update.user_id, row.user_id, "Driver cannot change the assigned user");
        assert.equal(update.payload.version, row.payload.version, "Driver cannot change plan version");
        assert.deepEqual(update.payload.history, row.payload.history, "Driver cannot change plan history");
        assert.equal(update.payload.planName, row.payload.planName, "Driver cannot change admin-owned plan data");
        assert.equal(update.payload.declarations.scheduler.signature, row.payload.declarations.scheduler.signature, "Driver cannot change scheduler acknowledgement");
      }
      Object.assign(row, update);
      return route.fulfill({ status: 204, body: "" });
    }
    throw new Error(`Unexpected request method: ${request.method()}`);
  });

  await page.goto("http://127.0.0.1:5200/__safe_driving_plan_test");
  await page.getByRole("button", { name: "Inductions & Training", exact: true }).click();
  await page.getByRole("button", { name: "Safe Driving Plans", exact: true }).click();
  await page.getByRole("heading", { name: "Safe Driving Plans", exact: true }).waitFor();
  await page.getByRole("button", { name: "New Plan", exact: true }).click();
  await page.locator("input").first().fill("Test delivery plan");
  await page.locator("select").first().selectOption(driverId);
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await page.getByText("Safe Driving Plan saved.", { exact: true }).waitFor();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Draft");
  await page.getByRole("button", { name: "Assign / Update", exact: true }).click();
  await page.getByText("Safe Driving Plan saved.", { exact: true }).waitFor();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, driverId);
  assert.equal(rows[0].status, "Assigned");
  assert.equal((await page.locator("section.space-y-4 > div.flex.items-center.justify-between.gap-3 > span").first().innerText()).trim(), "Assigned");
  rows.push({
    ...rows[0],
    id: "44444444-4444-4444-8444-444444444444",
    user_id: "55555555-5555-4555-8555-555555555555",
    payload: { ...rows[0].payload, planName: "Another driver's plan", assignedDriverId: "55555555-5555-4555-8555-555555555555" }
  });

  await page.goto("http://127.0.0.1:5200/__safe_driving_plan_test?role=driver");
  await page.getByRole("button", { name: "My Safe Driving Plans", exact: true }).click();
  await page.getByRole("heading", { name: "My Safe Driving Plans", exact: true }).waitFor();
  assert.equal(await page.getByRole("row").count(), 2, "Driver sees only the assigned plan row");
  await page.getByText("Another driver's plan", { exact: true }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  assert.equal(await page.locator("input").first().isDisabled(), true, "Plan name is admin-owned");
  await page.getByPlaceholder("Fit for duty").fill("Fit");
  await page.getByPlaceholder("Hours available").fill("8");
  await page.getByPlaceholder("Driver signature").fill("Test Driver");
  await page.getByRole("button", { name: "Acknowledge as Driver", exact: true }).click();
  await page.getByText("Safe Driving Plan saved.", { exact: true }).waitFor();
  assert.equal(rows[0].status, "Acknowledged");
  assert.equal(rows[0].payload.status, "Acknowledged");
  assert.equal((await page.locator("section.space-y-4 > div.flex.items-center.justify-between.gap-3 > span").first().innerText()).trim(), "Acknowledged");
  assert.equal(rows[0].payload.declarations.driver.acknowledged, true);
  assert.equal(rows[0].payload.declarations.driver.signature, "Test Driver");
  assert.equal(rows[0].payload.driverChecklist.fitForDuty, "Fit");
  assert.equal(rows[0].payload.driverChecklist.hoursAvailable, "8");

  await page.goto("http://127.0.0.1:5200/__safe_driving_plan_test");
  await page.getByRole("button", { name: "Inductions & Training", exact: true }).click();
  await page.getByRole("button", { name: "Safe Driving Plans", exact: true }).click();
  await page.getByRole("row", { name: /Test delivery plan/ }).getByRole("button", { name: "Open", exact: true }).click();
  assert.equal(await page.getByPlaceholder("Driver signature").inputValue(), "Test Driver");
  assert.equal(await page.getByPlaceholder("Fit for duty").inputValue(), "Fit");
  assert.equal(await page.getByPlaceholder("Fit for duty").isDisabled(), true, "Driver checklist is read-only for Admin");
  assert.equal(await page.getByPlaceholder("Report trip or route changes to scheduler").isDisabled(), true, "Trip change report is read-only for Admin");
  assert.equal(await page.locator('input[type="checkbox"]').first().isChecked(), true);
  await page.getByPlaceholder("Scheduler signature").fill("Test Scheduler");
  await page.getByRole("button", { name: "Scheduler Acknowledge", exact: true }).click();
  await page.getByText("Safe Driving Plan saved.", { exact: true }).waitFor();
  assert.equal(rows[0].status, "Completed");
  assert.equal(rows[0].payload.status, "Completed");
  assert.equal(rows[0].payload.declarations.driver.acknowledged, true);
  assert.equal(rows[0].payload.declarations.scheduler.acknowledged, true);
  assert.equal((await page.locator("section.space-y-4 > div.flex.items-center.justify-between.gap-3 > span").first().innerText()).trim(), "Completed");

  await page.goto("http://127.0.0.1:5200/__safe_driving_plan_test?role=driver");
  await page.getByRole("button", { name: "My Safe Driving Plans", exact: true }).click();
  await page.getByRole("cell", { name: "Completed", exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log("Safe Driving Plan admin-to-driver workflow passed.");
} finally {
  await browser?.close();
  await server.close();
}
