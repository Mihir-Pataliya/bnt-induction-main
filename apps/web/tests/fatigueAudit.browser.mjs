import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const supabaseUrl = "https://wbrculvtacfkjzqhhoue.supabase.co";
const driverId = "22222222-2222-4222-8222-222222222222";
const otherDriverId = "33333333-3333-4333-8333-333333333333";
const adminId = "11111111-1111-4111-8111-111111111111";
const authStorageKey = "sb-wbrculvtacfkjzqhhoue-auth-token";
const server = await createServer({
  root,
  css: { postcss: { plugins: [(await import("tailwindcss")).default({ config: resolve(root, "tailwind.config.js") }), (await import("autoprefixer")).default()] } },
  server: { host: "127.0.0.1", port: 5210 },
  plugins: [{
    name: "fatigue-audit-test-entry",
    configureServer(vite) {
      vite.middlewares.use("/__fatigue_audit_test", async (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await vite.transformIndexHtml("/__fatigue_audit_test", '<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/tests/fatigueAudit.harness.tsx"></script></body></html>'));
      });
    }
  }]
});

const rows = [];
let currentRole = "driver";
let nextId = 1;
const driverAuditQueries = [];

function authenticatedUser() {
  return currentRole === "admin"
    ? { id: adminId, email: "admin@test.local" }
    : { id: driverId, email: "driver@test.local" };
}

function authSession(user) {
  return {
    access_token: "test-only",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "test-only",
    user: {
      ...user,
      aud: "authenticated",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: new Date().toISOString()
    }
  };
}

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(`${supabaseUrl}/auth/v1/user`, async (route) => {
    return route.fulfill({ json: authenticatedUser() });
  });
  await page.route(`${supabaseUrl}/rest/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/profiles")) {
      return route.fulfill({
        json: [{ id: driverId, full_name: "Test Driver", email: "driver@test.local" }]
      });
    }
    if (url.pathname.endsWith("/cor_form_submissions")) {
      const formCode = url.searchParams.get("form_code")?.replace("eq.", "");
      const userId = url.searchParams.get("user_id")?.replace("eq.", "");
      if (request.method() === "GET") {
        if (currentRole === "driver" && formCode === "F-10") driverAuditQueries.push(userId);
        let matches = rows.filter((row) => !formCode || row.form_code === formCode);
        if (currentRole !== "admin") matches = matches.filter((row) => row.user_id === driverId);
        if (userId) matches = matches.filter((row) => row.user_id === userId);
        return route.fulfill({ json: matches });
      }
      if (request.method() === "POST") {
        const payload = request.postDataJSON();
        const storedPayload = { ...payload.payload };
        if (storedPayload.source === "admin") {
          storedPayload.driverId = String(storedPayload.driverId).toUpperCase();
          storedPayload.month = String(storedPayload.month).padStart(2, "0");
          storedPayload.year = Number(storedPayload.year);
        }
        const row = {
          ...payload,
          payload: storedPayload,
          id: `submission-${nextId++}`,
          submitted_at: new Date().toISOString()
        };
        rows.push(row);
        if (request.headers().accept?.includes("vnd.pgrst.object+json")) {
          return route.fulfill({ json: row });
        }
        return route.fulfill({ status: 201, body: "" });
      }
      if (request.method() === "PATCH") {
        const rowId = url.searchParams.get("id")?.replace("eq.", "");
        const row = rows.find((item) => item.id === rowId);
        if (row) Object.assign(row, request.postDataJSON());
        return route.fulfill({ status: 204, body: "" });
      }
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(({ key, user }) => {
    localStorage.setItem(key, JSON.stringify(user));
  }, { key: authStorageKey, user: authSession(authenticatedUser()) });

  await page.goto("http://127.0.0.1:5210/__fatigue_audit_test?role=driver");
  await page.getByRole("button", { name: "Driver Fatigue Work Record Audit" }).click();
  await page.getByText("Awaiting Admin Review.").waitFor();

  const today = new Date();
  const month = String(today.getMonth() + 1);
  const year = String(today.getFullYear());
  await page.locator("table tbody tr").first().locator("input").nth(0).fill("8");
  await page.locator("table tbody tr").first().locator("input").nth(1).fill("10");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByText("Work record submitted for admin review.").waitFor();
  assert.equal(rows.filter((row) => row.payload?.source === "driver").length, 1, "Driver work record should be submitted");
  await page.getByText("Awaiting Admin Review.").waitFor();

  currentRole = "admin";
  await page.evaluate(({ key, user }) => localStorage.setItem(key, JSON.stringify(user)), {
    key: authStorageKey,
    user: authSession(authenticatedUser())
  });
  await page.goto("http://127.0.0.1:5210/__fatigue_audit_test?role=admin");
  await page.getByText("Driver work record submissions").waitFor();
  await page.locator("form select").nth(1).selectOption(month);
  await page.getByLabel("Year").fill(year);
  await page.locator("tbody tr").nth(1).locator("select").selectOption("No Breach");
  await page.locator("input[placeholder='Audit note/evidence']").nth(2).fill("Missing rest evidence");
  await page.locator("tbody tr").nth(2).locator("select").selectOption("Breach Found");
  await page.getByPlaceholder("Audit comments").fill("Audit found a breach; follow up required.");
  await page.getByRole("button", { name: "Review Summary" }).click();
  await page.getByPlaceholder("e.g. 3, 7, 12").fill("2, 5");
  await page.getByLabel("Work/rest compliance").selectOption("Non-compliant");
  await page.getByPlaceholder("Corrective actions and follow-up requirements").fill("Submit missing diary pages.");
  await page.getByRole("button", { name: "Save review" }).click();
  await page.getByText("Audit record saved successfully.").waitFor();

  await page.getByRole("button", { name: "External Validation" }).click();
  await page.getByRole("checkbox", { name: "Mismatch found" }).check();
  await page.getByPlaceholder("Describe the mismatch identified").fill("GPS location differs from the diary.");
  await page.getByPlaceholder("Investigation notes and evidence references").fill("Please provide dispatch evidence.");
  await page.getByRole("button", { name: "Record validation" }).click();
  await page.getByRole("button", { name: "Save audit" }).click();
  await page.getByText("Audit record saved successfully.").waitFor();

  await page.getByRole("button", { name: "NCRs" }).click();
  await page.getByPlaceholder("Describe the non-conformance").fill("Unexplained GPS mismatch");
  await page.getByPlaceholder("Responsible person").fill("Test Driver");
  await page.getByPlaceholder("Corrective action required").fill("Submit dispatch evidence");
  await page.getByRole("button", { name: "Create NCR" }).click();
  await page.getByRole("button", { name: "Save audit" }).click();
  await page.getByText("Audit record saved successfully.").waitFor();
  await page.getByRole("button", { name: "Save audit" }).click();
  await page.getByText("Audit record saved successfully.").waitFor();

  const savedAudits = rows.filter((row) => row.form_code === "F-10" && row.payload?.source === "admin");
  assert.equal(savedAudits.length, 1, "Admin saves should update one audit record");
  assert.equal(savedAudits[0].user_id, driverId, "Audit should belong to the selected driver");
  assert.equal(savedAudits[0].status, "Resolved", "Saved audit should have a reviewed status");
  assert.deepEqual(savedAudits[0].payload.reviewSummary.missingDiaryPages, "2, 5");
  assert.equal(savedAudits[0].payload.externalValidations[0].mismatchFound, true);
  assert.equal(savedAudits[0].payload.ncrs[0].issue, "Unexplained GPS mismatch");
  assert.equal(String(savedAudits[0].payload.month), month.padStart(2, "0"));
  assert.equal(Number(savedAudits[0].payload.year), Number(year));

  rows.push({
    id: "other-driver-audit",
    user_id: otherDriverId,
    form_code: "F-10",
    form_title: "Driver Fatigue Work Record Audit Information",
    payload: {
      source: "admin",
      driverId: otherDriverId,
      month,
      year,
      auditDate: today.toISOString().slice(0, 10),
      comments: "Private audit for another driver",
      dayAudits: []
    },
    status: "Resolved",
    submitted_at: new Date().toISOString()
  });

  currentRole = "driver";
  await page.evaluate(({ key, user }) => localStorage.setItem(key, JSON.stringify(user)), {
    key: authStorageKey,
    user: authSession(authenticatedUser())
  });
  await page.goto("http://127.0.0.1:5210/__fatigue_audit_test?role=driver");
  await page.getByRole("button", { name: "Driver Fatigue Work Record Audit" }).click();
  await page.getByText("Reviewed", { exact: true }).waitFor();
  await page.getByText("Breach Found", { exact: true }).waitFor();
  await page.getByText("No Breach", { exact: true }).waitFor();
  assert.ok(await page.getByText("Not Audited", { exact: true }).count() > 0, "Unreviewed days should be labeled Not Audited");
  await page.getByText("My Review & Feedback").waitFor();
  await page.getByText("2, 5").waitFor();
  await page.getByText("Non-compliant", { exact: true }).waitFor();
  await page.getByText("Submit missing diary pages.").waitFor();
  await page.getByText("Evidence Requests").waitFor();
  await page.getByText("GPS request").waitFor();
  await page.getByText("GPS location differs from the diary.").waitFor();
  await page.getByText("Please provide dispatch evidence.").waitFor();
  await page.getByText("My NCRs / Corrective Actions").waitFor();
  await page.getByText("Unexplained GPS mismatch").waitFor();
  await page.getByText("Submit dispatch evidence").waitFor();
  await page.getByText("Missing rest evidence").waitFor();
  await page.getByText("Audit found a breach; follow up required.").waitFor();
  assert.equal(await page.getByText("Private audit for another driver").count(), 0, "Driver must not see another driver's audit");
  assert.equal(await page.locator("table").last().locator("select, input, textarea").count(), 0, "Audit results must be read-only");
  const reviewDateCard = page.getByText("Review date").locator("..");
  assert.doesNotMatch(await reviewDateCard.innerText(), /—\s*$/, "Review date should be shown");
  assert.ok(driverAuditQueries.length > 0 && driverAuditQueries.every((id) => id === driverId), "Driver audit queries must be scoped by own user_id");

  await page.reload();
  await page.getByRole("button", { name: "Driver Fatigue Work Record Audit" }).click();
  await page.getByText("Reviewed", { exact: true }).waitFor();
  await page.getByText("Missing rest evidence").waitFor();
  await page.getByText("2, 5").waitFor();
  await page.getByText("GPS request").waitFor();
  await page.getByText("Unexplained GPS mismatch").waitFor();

  await page.getByRole("button", { name: "Amend & Resubmit" }).click();
  await page.getByPlaceholder("Add your response to the Admin feedback...").fill("I have attached my explanation for the GPS mismatch.");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByText("Amended work record resubmitted for admin review.").waitFor();
  const driverSubmission = rows.find((row) => row.payload?.source === "driver");
  assert.equal(
    driverSubmission.payload.driverResponse,
    "I have attached my explanation for the GPS mismatch.",
    "Driver response should be saved in the driver's existing submission"
  );

  currentRole = "admin";
  await page.evaluate(({ key, user }) => localStorage.setItem(key, JSON.stringify(user)), {
    key: authStorageKey,
    user: authSession(authenticatedUser())
  });
  await page.goto("http://127.0.0.1:5210/__fatigue_audit_test?role=admin");
  await page.getByText("Driver work record submissions").waitFor();
  await page.getByRole("button", { name: "View details" }).click();
  await page.getByText("Driver response to Admin feedback").waitFor();
  await page.getByText("I have attached my explanation for the GPS mismatch.").waitFor();

  currentRole = "driver";
  await page.evaluate(({ key, user }) => localStorage.setItem(key, JSON.stringify(user)), {
    key: authStorageKey,
    user: authSession(authenticatedUser())
  });
  await page.goto("http://127.0.0.1:5210/__fatigue_audit_test?role=driver");
  await page.getByRole("button", { name: "Driver Fatigue Work Record Audit" }).click();
  await page.getByText("Reviewed", { exact: true }).waitFor();

  const noAuditMonth = String(today.getMonth() === 0 ? 12 : today.getMonth());
  const noAuditYear = String(today.getFullYear() - (today.getMonth() === 0 ? 1 : 0));
  await page.getByLabel("Month").selectOption(noAuditMonth);
  await page.getByLabel("Year").selectOption(noAuditYear);
  await page.getByText("Awaiting Admin Review.").waitFor();
  console.log("Driver submits response → Admin views saved response; feedback and no-audit flows passed.");
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
  await server.close();
}
