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

// Photo upload: an image with no face must surface the friendly error.
{
  // 200x200 solid magenta PNG rendered in-page, then fed to the file input.
  const buf = Buffer.from(
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = c.height = 200;
      const x = c.getContext("2d");
      x.fillStyle = "#c0f";
      x.fillRect(0, 0, 200, 200);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }),
  );
  await page.setInputFiles("#photo-input", {
    name: "noface.png",
    mimeType: "image/png",
    buffer: buf,
  });
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent.includes("No face found"),
    { timeout: 60000 },
  ).catch(() => {});
  const statusText = await page.locator("#status").textContent();
  check("faceless upload shows friendly error", statusText.includes("No face found"));
  check("no photo look created for faceless upload",
    await page.evaluate(() => window.__app.state.photoLook === null));
}

// Full photo-look pipeline, when a face image fixture is supplied.
if (process.env.SMOKE_FACE_IMAGE) {
  const { readFile: rf } = await import("node:fs/promises");
  await page.setInputFiles("#photo-input", {
    name: "face.jpg",
    mimeType: "image/jpeg",
    buffer: await rf(process.env.SMOKE_FACE_IMAGE),
  });
  await page.waitForFunction(() => window.__app.state.photoLook !== null, { timeout: 60000 })
    .catch(() => {});
  const look = await page.evaluate(() => window.__app.state.photoLook);
  check("photo look built from face image", !!look);
  if (look) {
    check("photo look has sampled layers with valid colors",
      Object.values(look.layers).length >= 5 &&
      Object.values(look.layers).every((l) => /^#[0-9a-f]{6}$/.test(l.color) && l.amount > 0));
    check("photo look selected and tutorial started",
      await page.evaluate(() =>
        window.__app.state.look.id === "photo" && window.__app.state.tutorialMode));
    check("reference crop visible", await page.locator("#reference-wrap").isVisible());
    const refDrawn = await page.evaluate(() => {
      const c = document.getElementById("reference-canvas");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      return d.some((v, i) => i % 4 !== 3 && v > 0);
    });
    check("reference crop has pixels", refDrawn);
    // Step through: each step should redraw the crop for its own region.
    await page.click("#next-step");
    check("photo tutorial advances", (await page.locator("#step-counter").textContent()).includes("Step 2"));

    // Reference inset (visible even in mirror mode) is drawn.
    check("reference inset visible", await page.locator("#ref-inset-wrap").isVisible());
    check("reference inset has pixels", await page.evaluate(() => {
      const c = document.getElementById("ref-inset");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      return d.some((v, i) => i % 4 !== 3 && v > 0);
    }));

    // Step zoom: drive the renderer with the photo's own landmarks (the fake
    // camera has no face) and confirm the view actually magnifies the region
    // being taught, and relaxes to the whole face when zoom is off.
    const zoom = await page.evaluate(async () => {
      const { MakeupRenderer } = await import("./js/makeup.js");
      const img = window.__app.state.photoImage;
      const lm = window.__app.state.photoLandmarks;
      const c = document.createElement("canvas");
      c.width = 960; c.height = 720;
      const r = new MakeupRenderer(c);
      const settle = (zoomLayer) => {
        for (let i = 0; i < 60; i++) {
          r.render(img, lm, window.__app.state.photoLook, {
            intensity: 0.8, enabledLayers: null, highlightLayer: zoomLayer,
            zoomLayer, compare: false, time: 0,
          });
        }
        return { scale: r.view.scale, cx: r.view.cx, cy: r.view.cy };
      };
      return { eye: settle("eyeliner"), lips: settle("lipstick"), off: settle(null) };
    });
    check("zooms in for the eyeliner step", zoom.eye.scale > 1.3);
    check("zooms in for the lipstick step", zoom.lips.scale > 1.3);
    check("frames a different area per step", Math.abs(zoom.eye.cy - zoom.lips.cy) > 20);
    check("returns to the whole face when zoom is off",
      Math.abs(zoom.off.scale - 1) < 0.05);

    // The zoom toggle flips the state the render loop reads.
    check("zoom follows the step by default",
      await page.evaluate(() => window.__app.state.zoomToStep === true));
    await page.click("#zoom-btn");
    check("zoom toggle turns it off",
      await page.evaluate(() => window.__app.state.zoomToStep === false));
    await page.click("#zoom-btn");

    // Ghost overlay: press-and-hold the mirror, drag right to raise opacity.
    // Stepping the tutorial can scroll the panel into view, pushing the
    // canvas off-screen — bring it back before aiming synthetic pointers.
    await page.locator("#stage").scrollIntoViewIfNeeded();
    const stage = await page.locator("#stage").boundingBox();
    const cx = stage.x + stage.width / 2;
    const cy = stage.y + stage.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(450);
    check("hold activates ghost overlay",
      await page.evaluate(() => window.__app.state.ghostActive));
    const before = await page.evaluate(() => window.__app.state.ghostOpacity);
    await page.mouse.move(cx + stage.width * 0.25, cy, { steps: 5 });
    const after = await page.evaluate(() => window.__app.state.ghostOpacity);
    check("dragging right raises ghost opacity", after > before);
    await page.mouse.up();
    check("release hides ghost overlay",
      await page.evaluate(() => !window.__app.state.ghostActive));

    // Mirror mode: panels hidden, HUD visible, tap zones step the tutorial.
    await page.click("#mirror-btn");
    check("mirror mode hides panels",
      await page.evaluate(() =>
        document.body.classList.contains("mirror-mode") &&
        getComputedStyle(document.querySelector(".controls")).display === "none"));
    check("HUD shows current step",
      (await page.locator("#hud-chip").textContent()).includes("2/"));
    await page.locator("#stage").scrollIntoViewIfNeeded();
    const stage2 = await page.locator("#stage").boundingBox();
    await page.mouse.click(stage2.x + stage2.width * 0.9, stage2.y + stage2.height / 2);
    check("tap right edge advances step",
      await page.evaluate(() => window.__app.state.stepIndex === 2));
    await page.mouse.click(stage2.x + stage2.width * 0.1, stage2.y + stage2.height / 2);
    check("tap left edge goes back",
      await page.evaluate(() => window.__app.state.stepIndex === 1));
    await page.click("#hud-exit");
    check("exit returns from mirror mode",
      await page.evaluate(() => !document.body.classList.contains("mirror-mode")));

    // Send-to-phone: QR renders and its URL opens the companion view.
    await page.click("#send-phone-btn");
    check("QR modal opens with a QR image",
      await page.locator("#qr-box img").count() === 1);
    const companionUrl = await page.evaluate(() =>
      document.getElementById("qr-box").dataset.url);
    check("companion URL embeds payload", companionUrl.includes("#companion="));
    const phone = await browser.newPage({ viewport: { width: 390, height: 780 } });
    await phone.goto(companionUrl);
    check("companion view renders on phone",
      await phone.locator("#companion-view").isVisible() &&
      (await phone.locator("#companion-counter").textContent()).includes("Step 1 of"));
    await phone.click("#companion-next");
    check("companion steps advance",
      (await phone.locator("#companion-counter").textContent()).includes("Step 2 of"));
    check("companion hides the mirror UI",
      await phone.evaluate(() =>
        getComputedStyle(document.querySelector("main")).display === "none"));
    await phone.close();
  }
}

if (process.env.SMOKE_SCREENSHOT) {
  await page.screenshot({ path: process.env.SMOKE_SCREENSHOT });
}
await browser.close();
server.close();

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
process.exit(failed.length ? 1 : 0);
