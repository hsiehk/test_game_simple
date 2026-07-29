// Browser smoke test: serve the app, open it in Chromium with a fake camera,
// click Start, and verify the tracker loads and the render loop runs.
//
// Requires playwright-core (npm i -D playwright-core) and a Chromium binary.
// Set CHROME_PATH to the browser executable, or leave unset to use the
// Playwright-managed install. Run: node tests/smoke.mjs
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".task": "application/octet-stream",
};

const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const data = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(8123, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    "--no-sandbox",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const results = [];
const check = (name, ok) => { results.push([name, ok]); console.log(ok ? "PASS" : "FAIL", name); };

await page.goto("http://localhost:8123/");
check("page loads with title", (await page.title()).includes("MirrorMuse"));
check("4 look buttons render", (await page.locator(".look-btn").count()) === 4);
check("app state exposed", await page.evaluate(() => window.__app?.looks?.length === 4));

// Tutorial UI works without camera.
await page.click("#mode-toggle");
check("tutorial opens", await page.locator("#tutorial-panel").isVisible());
check("step 1 shown", (await page.locator("#step-counter").textContent()).includes("Step 1 of 6"));
await page.click("#next-step");
check("advances to step 2", (await page.locator("#step-counter").textContent()).includes("Step 2"));
await page.click("#mode-toggle"); // exit

// Look switching.
await page.locator(".look-btn", { hasText: "Smokey" }).click();
check("look switches", await page.evaluate(() => window.__app.state.look.id === "smokey"));

// Start camera (fake device) and let the tracker + render loop run.
await page.click("#start-btn");
try {
  await page.waitForSelector("#start-panel.hidden", { timeout: 90000, state: "attached" });
  check("tracker loads and camera starts", true);
  await page.waitForTimeout(3000);
  const running = await page.evaluate(() => window.__app.state.running);
  check("render loop running", running);
  const nonBlank = await page.evaluate(() => {
    const c = document.getElementById("stage");
    const d = c.getContext("2d").getImageData(0, 0, 50, 50).data;
    return d.some((v, i) => i % 4 !== 3 && v > 0);
  });
  check("canvas is drawing frames", nonBlank);
} catch (e) {
  check("tracker loads and camera starts", false);
  console.log("start error:", e.message);
  console.log("status text:", await page.locator("#status").textContent().catch(() => "?"));
}

if (process.env.SMOKE_SCREENSHOT) {
  await page.screenshot({ path: process.env.SMOKE_SCREENSHOT });
}
await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
process.exit(failed.length ? 1 : 0);
