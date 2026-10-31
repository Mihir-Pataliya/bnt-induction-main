import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  css: { postcss: { plugins: [(await import("tailwindcss")).default({ config: resolve(root, "tailwind.config.js") }), (await import("autoprefixer")).default()] } },
  server: { host: "127.0.0.1", port: 5193 },
  plugins: [{
    name: "eng2-entry",
    configureServer(server) {
      server.middlewares.use("/__eng2", async (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml("/__eng2", "<html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /></head><body><div id=\"root\"></div><script type=\"module\" src=\"/tests/eng2.harness.tsx\"></script></body></html>"));
      });
    }
  }]
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("http://127.0.0.1:5193/__eng2");
  await page.getByRole("button", { name: "Third Parties/Subcontractors", exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Engagement Application", exact: true }).click();
  await page.waitForTimeout(15000);
  console.log("ERRORS:", errors);
  console.log("BODY:", await page.locator("body").innerText());
} finally {
  await browser?.close();
  await server.close();
}
