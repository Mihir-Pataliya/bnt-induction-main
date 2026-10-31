import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root,
  css: { postcss: { plugins: [(await import("tailwindcss")).default({ config: resolve(root, "tailwind.config.js") }), (await import("autoprefixer")).default()] } },
  server: { host: "127.0.0.1", port: 5192 },
  plugins: [{
    name: "eng3-entry",
    configureServer(server) {
      server.middlewares.use("/__eng3", async (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml("/__eng3", "<html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" /></head><body><div id=\"root\"></div><script type=\"module\" src=\"/tests/eng3.harness.tsx\"></script></body></html>"));
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
  page.on("console", (m) => { errors.push(m.type() + ": " + m.text()); });
  await page.goto("http://127.0.0.1:5192/__eng3");
  await page.waitForTimeout(5000);
  console.log("ERRORS:", errors);
  console.log("BODY:", await page.locator("body").innerText());
} finally {
  await browser?.close();
  await server.close();
}
