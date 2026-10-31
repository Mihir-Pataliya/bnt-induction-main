import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

console.log("start");
const root = fileURLToPath(new URL("../", import.meta.url));
const supabaseUrl = "https://wbrculvtacfkjzqhhoue.supabase.co";
const driverId = "22222222-2222-4222-8222-222222222222";
const server = await createServer({
  root,
  css: { postcss: { plugins: [(await import("tailwindcss")).default({ config: resolve(root, "tailwind.config.js") }), (await import("autoprefixer")).default()] } },
  server: { host: "127.0.0.1", port: 5202 },
  plugins: [{
    name: "rma-test-entry",
    configureServer(vite) {
      vite.middlewares.use("/__rma_test", async (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await vite.transformIndexHtml("/__rma_test", '<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/tests/safeDrivingPlan.harness.tsx"></script></body></html>'));
      });
    }
  }]
});
console.log("created server");

let browser;
const rows = [];
try {
  await server.listen();
  console.log("server listened");
  console.log("launching browser");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  console.log("browser launched");
  console.log("new page");
  const page = await browser.newPage();
  console.log("page created");
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
        id: "44444444-4444-4444-8444-444444444444",
        submitted_at: new Date().toISOString(),
        ...request.postDataJSON()
      };
      rows.push(inserted);
      return route.fulfill({ status: 201, json: inserted });
    }
    if (request.method() === "PATCH") {
      const idFilter = url.searchParams.get("id")?.replace("eq.", "");
      const row = rows.find((candidate) => candidate.id === idFilter);
      assert.ok(row, "Expected assessment to exist before update");
      const update = request.postDataJSON();
      Object.assign(row, update, { submitted_at: row.submitted_at });
      return route.fulfill({ json: row });
    }
    return route.fallback();
  });

  await page.goto("http://127.0.0.1:5202/__rma_test");
  await page.getByRole("button", { name: "Risk Management Assessment" }).click();
  await page.getByRole("button", { name: "New Assessment" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Risk Management Assessment saved.").waitFor();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.status, "Draft");

  await page.getByRole("button", { name: "Approval" }).click();
  const approvalInputs = page.locator("input");
  await approvalInputs.nth(0).fill("BNT Logistics");
  await approvalInputs.nth(2).fill("Test Approver");
  await approvalInputs.nth(3).fill("Director");
  await approvalInputs.nth(4).fill("Test Signature");
  await approvalInputs.nth(5).fill("2026-10-31");
  await approvalInputs.nth(6).fill("2026-10-31");
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Risk Management Assessment saved.").waitFor();
  assert.equal(rows[0].status, "Submitted");
  assert.equal(rows[0].payload.status, "Approved");

  await page.goto("http://127.0.0.1:5202/__rma_test?role=driver");
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent?.includes("Risk Management Assessment"));
    const panel = heading?.closest(".dashboard-panel");
    const button = panel?.querySelector("button");
    button?.click();
  });
  await page.getByText("Approved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Acknowledge assessment" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Save" }).count(), 0, "Driver view is read-only");
  assert.deepEqual(pageErrors, []);
  console.log("Risk Management Assessment smoke test passed.");
} finally {
  await browser?.close();
  await server.close();
}

