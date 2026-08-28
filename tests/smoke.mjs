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

// Watch what the live render loop is actually asked to paint for a moment.
// The app imports the same module URL, so patching the prototype catches the
// options its own frames pass — the only way to see that the preview leaves
// enabledLayers unset instead of filtering to the taught layers.
const captureRenderOpts = async () => {
  const { MakeupRenderer } = await import("./js/makeup.js");
  const real = MakeupRenderer.prototype.render;
  const seen = [];
  MakeupRenderer.prototype.render = function (...args) {
    seen.push(args[3]);
    return real.apply(this, args);
  };
  await new Promise((r) => setTimeout(r, 250));
  MakeupRenderer.prototype.render = real;
  const last = seen[seen.length - 1];
  return {
    frames: seen.length,
    filtered: last?.enabledLayers instanceof Set,
    highlight: last?.highlightLayer ?? null,
    zoom: last?.zoomLayer ?? null,
  };
};

await page.goto("http://localhost:8123/");
check("page loads with title", (await page.title()).includes("MirrorMuse"));
check("5 look buttons render", (await page.locator("#look-list .look-btn").count()) === 5);
check("app state exposed", await page.evaluate(() => window.__app?.looks?.length === 5));

// Tutorial UI works without camera.
await page.click("#mode-toggle");
check("tutorial opens", await page.locator("#tutorial-panel").isVisible());
check("tutorial opens on the preview",
  (await page.locator("#step-counter").textContent()).includes("Preview")
  && await page.evaluate(() => window.__app.state.previewing === true));
check("preview names the look and offers to begin",
  (await page.locator("#step-title").textContent()).length > 0
  && (await page.locator("#next-step").textContent()).includes("Begin"));
await page.click("#next-step");
check("Begin moves to step 1",
  (await page.locator("#step-counter").textContent()).includes("Step 1 of 6")
  && await page.evaluate(() => window.__app.state.previewing === false));
check("step 1 restores the Back button",
  (await page.locator("#prev-step").textContent()).includes("← Back")
  && await page.locator("#prev-step").isEnabled());
// Back from the first step is not a dead end any more: it is how you get
// another look at the finished face before carrying on.
await page.click("#prev-step");
check("Back from step 1 returns to the preview",
  await page.evaluate(() => window.__app.state.previewing === true));
await page.click("#next-step");
await page.click("#next-step");
check("advances to step 2", (await page.locator("#step-counter").textContent()).includes("Step 2"));
await page.click("#prev-step");
check("steps back to step 1", (await page.locator("#step-counter").textContent()).includes("Step 1 of 6"));
// At step 1 the panel's Back is disabled, so the way back to the preview is
// the HUD arrow (or a mirror-mode tap, exercised further down).
await page.locator("#hud-prev").dispatchEvent("click");
check("going back from step 1 returns to the preview",
  (await page.locator("#step-counter").textContent()).includes("Preview")
  && await page.evaluate(() => window.__app.state.previewing === true));
await page.click("#mode-toggle"); // exit
check("exiting the tutorial clears the preview",
  await page.evaluate(() => !window.__app.state.tutorialMode && !window.__app.state.previewing));

// Look switching.
await page.locator("#look-list .look-btn", { hasText: "Smokey" }).click();
check("look switches", await page.evaluate(() => window.__app.state.look.id === "smokey"));

// Blush placements: six of them, each selectable and reflected in state.
{
  const { BLUSH_STYLES } = await import("../js/looks.js");
  check("blush placements render", (await page.locator("#blush-row .blush-btn").count())
    === BLUSH_STYLES.length);
  await page.locator("#blush-row .blush-btn", { hasText: "Draping" }).click();
  check("picking a placement updates state",
    await page.evaluate(() => window.__app.state.blushStyle === "draping"));
  check("placement hint shown",
    (await page.locator("#blush-hint").textContent()).length > 20);
  // A look carries its own placement, so switching looks adopts it.
  await page.locator("#look-list .look-btn", { hasText: "Korean" }).click();
  check("switching looks adopts that look's placement",
    await page.evaluate(() => window.__app.state.blushStyle === null
      && window.__app.state.look.blushStyle === "eyeEnlarging"));
  await page.locator("#look-list .look-btn", { hasText: "Smokey" }).click();
}

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

    // A photo look opens on the preview too, and the preview must paint the
    // whole look: no layer filtered out, nothing highlighted, nothing zoomed.
    check("photo tutorial opens on the preview",
      await page.evaluate(() => window.__app.state.previewing === true)
      && (await page.locator("#step-counter").textContent()).includes("Preview"));
    const previewFrame = await page.evaluate(captureRenderOpts);
    check(`preview paints every layer, unhighlighted and unzoomed (${previewFrame.frames} frames)`,
      previewFrame.frames > 0 && previewFrame.filtered === false
      && previewFrame.highlight === null && previewFrame.zoom === null);
    const refPreview = await page.evaluate(() =>
      document.getElementById("reference-canvas").toDataURL());

    // Step through: each step should redraw the crop for its own region.
    await page.click("#next-step");
    check("Begin moves the photo tutorial to step 1",
      (await page.locator("#step-counter").textContent()).includes("Step 1 of")
      && await page.evaluate(() => window.__app.state.previewing === false));
    const stepFrame = await page.evaluate(captureRenderOpts);
    check("step 1 goes back to painting only the layers taught so far",
      stepFrame.filtered === true);
    check("the preview reference framed the whole face, not the step's region",
      refPreview !== await page.evaluate(() =>
        document.getElementById("reference-canvas").toDataURL()));
    await page.click("#next-step");
    check("photo tutorial advances", (await page.locator("#step-counter").textContent()).includes("Step 2"));

    // Liner measurement accuracy: paint a tail of known length and angle
    // onto the reference face, in the eye's own frame, and check the
    // measurement recovers it. Without this the wing is a fixed stub that
    // ignores whatever liner the reference actually wears.
    const linerFit = await page.evaluate(async () => {
      const { measureLiner } = await import("./js/photolook.js");
      const { LEFT_LASH } = await import("./js/landmarks.js");
      const img = window.__app.state.photoImage;
      const lm = window.__app.state.photoLandmarks;
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);

      const pt = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
      const outer = pt(LEFT_LASH[0]);
      const inner = pt(LEFT_LASH[LEFT_LASH.length - 1]);
      const dx = outer.x - inner.x, dy = outer.y - inner.y;
      const eyeW = Math.hypot(dx, dy);
      const ux = dx / eyeW, uy = dy / eyeW;
      const vx = uy, vy = -ux;
      const A = 0.4, B = 0.1;           // the tail we are about to draw
      const tip = {
        x: outer.x + ux * A * eyeW + vx * B * eyeW,
        y: outer.y + uy * A * eyeW + vy * B * eyeW,
      };
      x.strokeStyle = "#000";
      x.lineCap = "round";
      x.lineWidth = eyeW * 0.03;
      x.beginPath();
      x.moveTo(outer.x, outer.y);
      x.lineTo(tip.x, tip.y);
      x.stroke();

      const skin = { r: 200, g: 170, b: 155 };
      const fit = measureLiner(x.getImageData(0, 0, W, H), lm, W, H, skin);
      return { drawn: { a: A, b: B }, got: fit[0] };
    });
    check(`measured wing length matches what was drawn (${linerFit.got?.a?.toFixed(2)} vs 0.40)`,
      linerFit.got?.a != null && Math.abs(linerFit.got.a - linerFit.drawn.a) <= 0.12);
    check(`measured wing angle matches what was drawn (${linerFit.got?.b?.toFixed(2)} vs 0.10)`,
      linerFit.got?.b != null && Math.abs(linerFit.got.b - linerFit.drawn.b) <= 0.08);

    // A closed eye carries no readable liner; it must borrow the open one
    // rather than report the shape of a folded lid.
    const winking = await page.evaluate(async () => {
      const { measureLiner } = await import("./js/photolook.js");
      const { RIGHT_LASH, RIGHT_LOWER_LASH } = await import("./js/landmarks.js");
      const img = window.__app.state.photoImage;
      const lm = window.__app.state.photoLandmarks.map((p) => ({ ...p }));
      // Collapse the right eye onto its own lash line.
      for (let i = 0; i < RIGHT_LASH.length; i++) {
        lm[RIGHT_LOWER_LASH[i]] = { ...lm[RIGHT_LASH[i]] };
      }
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      const fit = measureLiner(c.getContext("2d").getImageData(0, 0, img.width, img.height),
        lm, img.width, img.height, { r: 200, g: 170, b: 155 });
      return { left: fit[0], right: fit[1] };
    });
    check("a winking eye borrows the open eye's measurement",
      winking.right !== null && winking.right?.a === winking.left?.a);

    // Brow measurement: paint a bar of known thickness along the brow axis
    // and check it is recovered. The mesh gives only a coarse ten-point
    // loop, so a drawn or reshaped brow has to be read from the image.
    const browFit = await page.evaluate(async () => {
      const { measureBrows } = await import("./js/photolook.js");
      const { LEFT_BROW } = await import("./js/landmarks.js");
      const img = window.__app.state.photoImage;
      const lm = window.__app.state.photoLandmarks;
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);

      const half = LEFT_BROW.length / 2;
      const upper = LEFT_BROW.slice(0, half).map((i) => ({ x: lm[i].x * W, y: lm[i].y * H }));
      const a = upper[0];
      const b = upper[upper.length - 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // Wipe the real brow first: painting over it would measure the union
      // of the two and report the bar as twice its thickness.
      x.fillStyle = "#cdaa96";
      x.beginPath();
      x.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, len * 0.75, len * 0.3,
        Math.atan2(b.y - a.y, b.x - a.x), 0, Math.PI * 2);
      x.fill();

      const THICK = 0.09;               // as a fraction of brow length
      x.strokeStyle = "#1a1410";
      x.lineCap = "butt";
      x.lineWidth = len * THICK;
      x.beginPath();
      x.moveTo(a.x, a.y);
      x.lineTo(b.x, b.y);
      x.stroke();

      const fit = measureBrows(x.getImageData(0, 0, W, H), lm, W, H,
        { r: 205, g: 175, b: 158 });
      const cols = fit?.[0];
      if (!cols) return { thickness: null };
      const th = cols.map((col) => col.up + col.down).sort((p, q) => p - q);
      return { drawn: THICK, thickness: th[th.length >> 1] };
    });
    check(`measured brow thickness matches what was drawn (${browFit.thickness?.toFixed(3)} vs 0.090)`,
      browFit.thickness != null && Math.abs(browFit.thickness - browFit.drawn) <= 0.035);

    // A brow with no contrast against skin cannot be traced; the mesh
    // outline must be used rather than a shape invented from noise.
    const flatBrow = await page.evaluate(async () => {
      const { measureBrows } = await import("./js/photolook.js");
      const { regionShapes } = await import("./js/makeup.js");
      const { LEFT_BROW } = await import("./js/landmarks.js");
      const lm = window.__app.state.photoLandmarks;
      const W = 900, H = 700;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.fillStyle = "#cdaa96";
      x.fillRect(0, 0, W, H);
      const fit = measureBrows(x.getImageData(0, 0, W, H), lm, W, H,
        { r: 205, g: 170, b: 150 });
      const shapes = regionShapes(lm, "brows", W, H, { brows: fit });
      return { fit: fit?.[0] ?? null, drawn: shapes.length, dabs: shapes[0].dabs.length };
    });
    check("a brow with no contrast falls back to the mesh outline",
      flatBrow.fit === null && flatBrow.drawn === 2 && flatBrow.dabs > 0);

    // Aegyo-sal: the ridge is bounded to where it can anatomically sit, so
    // a bright cheek cannot drag the band down the face.
    const ridge = await page.evaluate(async () => {
      const { measureAegyoSal } = await import("./js/photolook.js");
      const img = window.__app.state.photoImage;
      const lm = window.__app.state.photoLandmarks;
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      const fit = measureAegyoSal(
        c.getContext("2d").getImageData(0, 0, img.width, img.height),
        lm, img.width, img.height, { r: 205, g: 175, b: 158 });
      return fit;
    });
    for (const [i, band] of (ridge ?? []).entries()) {
      if (!band) continue;
      check(`aegyo-sal band ${i} stays under the eye (${band.top.toFixed(2)}–${band.bottom.toFixed(2)} eye heights)`,
        band.top >= 0.08 && band.bottom <= 0.95 && band.bottom > band.top);
    }

    // Cost guards. Canvas blur was ~90% of the whole frame (394ms against
    // 40ms over a full look) and duplicated softness the geometry already
    // provides, so no layer may ask for one again. And the mirror must not
    // render more pixels than it displays — fill rate is what heats a phone.
    const cost = await page.evaluate(async () => {
      const { MakeupRenderer } = await import("./js/makeup.js");
      const { getLook } = await import("./js/looks.js");
      const lm = window.__app.state.photoLandmarks;
      const proto = CanvasRenderingContext2D.prototype;
      const real = Object.getOwnPropertyDescriptor(proto, "filter");
      const asked = [];
      Object.defineProperty(proto, "filter", {
        get() { return real.get.call(this); },
        set(v) { asked.push(v); real.set.call(this, v); },
        configurable: true,
      });
      const W = 640, H = 480;
      const flat = document.createElement("canvas");
      flat.width = W; flat.height = H;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      new MakeupRenderer(c).render(flat, lm, getLook("puppy-liner"), {
        intensity: 1, enabledLayers: null, highlightLayer: "eyeshadow",
        zoomLayer: "eyeshadow", compare: false, blushStyle: "eyeEnlarging", time: 0,
      });
      Object.defineProperty(proto, "filter", real);
      return {
        blurs: asked.filter((v) => typeof v === "string" && v.includes("blur")).length,
        canvasWidth: document.getElementById("stage").width,
        videoWidth: document.getElementById("camera").videoWidth,
      };
    });
    check(`no layer asks for a canvas blur (${cost.blurs} requested)`, cost.blurs === 0);
    check(`render size is capped (${cost.canvasWidth}px canvas, ${cost.videoWidth}px camera)`,
      cost.canvasWidth > 0 && cost.canvasWidth <= 720
        && cost.canvasWidth <= Math.max(cost.videoWidth, 320));

    // Filter-independence guard. Every layer's softness must come from its
    // geometry, not from ctx.filter blur: browsers that ignore the filter
    // are exactly where a stroked contour shipped as two hard bars across
    // the cheeks. Rendering each layer with the filter available and with
    // it neutered must produce nearly the same image.
    // Calibrated on each regression, filled shape vs brush-built:
    // contour 44 -> 16, brows 68 -> 10, eyeshadow 73 -> 10.
    const filterDep = await page.evaluate(async () => {
      const { MakeupRenderer } = await import("./js/makeup.js");
      const lm = window.__app.state.photoLandmarks;
      const proto = CanvasRenderingContext2D.prototype;
      const real = Object.getOwnPropertyDescriptor(proto, "filter");
      const W = 900, H = 700;

      const render = (layer, color, noFilter) => {
        if (noFilter) {
          Object.defineProperty(proto, "filter", {
            get() { return "none"; }, set() {}, configurable: true,
          });
        }
        const flat = document.createElement("canvas");
        flat.width = W; flat.height = H;
        const fx = flat.getContext("2d");
        fx.fillStyle = "#808080";
        fx.fillRect(0, 0, W, H);
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        new MakeupRenderer(c).render(flat, lm, { layers: { [layer]: { color, amount: 1 } }, steps: [] }, {
          intensity: 1, enabledLayers: new Set([layer]), highlightLayer: null,
          zoomLayer: null, compare: false, time: 0,
        });
        Object.defineProperty(proto, "filter", real);
        return c.getContext("2d").getImageData(0, 0, W, H).data;
      };

      const out = {};
      for (const [layer, color] of [
        ["contour", "#8a5a3c"], ["foundation", "#c98a5e"], ["blush", "#c05a48"],
        ["brows", "#4a3729"], ["eyeshadow", "#544c52"],
      ]) {
        const a = render(layer, color, false);
        const b = render(layer, color, true);
        let max = 0;
        for (let i = 0; i < a.length; i += 4) max = Math.max(max, Math.abs(a[i] - b[i]));
        out[layer] = max;
      }
      return out;
    });
    for (const [layer, d] of Object.entries(filterDep)) {
      check(`${layer} renders the same without canvas blur (off by ${d}/255)`, d <= 25);
    }

    // Colour accuracy: build a reference photo whose lips are a known
    // colour, with bright teeth showing through the mouth, then check the
    // analyser recovers the lipstick rather than a pink averaged with teeth.
    const colour = await page.evaluate(async () => {
      const { buildPhotoLook } = await import("./js/photolook.js");
      const { regionShapes } = await import("./js/makeup.js");
      const { LIPS_INNER } = await import("./js/landmarks.js");
      const img = window.__app.state.photoImage;
      const lm = window.__app.state.photoLandmarks;
      const W = img.width, H = img.height;

      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      const TARGET = { r: 0xc2, g: 0x21, b: 0x3a };
      x.fillStyle = "#c2213a";
      for (const s of regionShapes(lm, "lipstick", W, H)) {
        x.beginPath();
        x.moveTo(s.pts[0].x, s.pts[0].y);
        for (const p of s.pts.slice(1)) x.lineTo(p.x, p.y);
        x.closePath();
        x.fill();
      }
      // Teeth: a bright block inside the mouth, the classic sampling trap.
      x.fillStyle = "#fbfbf5";
      const inner = LIPS_INNER.map((i) => ({ x: lm[i].x * W, y: lm[i].y * H }));
      x.beginPath();
      x.moveTo(inner[0].x, inner[0].y);
      for (const p of inner.slice(1)) x.lineTo(p.x, p.y);
      x.closePath();
      x.fill();

      const painted = await createImageBitmap(c);
      const look = buildPhotoLook(painted, lm);
      const hex = look.layers.lipstick.color;
      const got = {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
      };
      return {
        hex,
        blend: look.layers.lipstick.blend,
        amount: look.layers.lipstick.amount,
        err: Math.max(
          Math.abs(got.r - TARGET.r),
          Math.abs(got.g - TARGET.g),
          Math.abs(got.b - TARGET.b),
        ),
      };
    });
    check(`matched lip colour is accurate (${colour.hex}, off by ${colour.err}/255)`,
      colour.err <= 12);
    check("matched lip uses the colour blend so hue survives",
      colour.blend === "color");
    check("a saturated reference lip is applied strongly",
      colour.amount >= 0.7);

    // Wearables, end to end: paint a reference with grey irises and a heavy
    // lash line, and confirm the analyser reports both — and stays quiet on
    // the untouched original.
    const wearables = await page.evaluate(async () => {
      const { buildPhotoLook, lensAdvice } = await import("./js/photolook.js");
      const { regionShapes } = await import("./js/makeup.js");
      const img = window.__app.state.photoImage;
      const lm = window.__app.state.photoLandmarks;
      const W = img.width, H = img.height;

      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      // Heavy lash line.
      x.strokeStyle = "#141014";
      x.lineCap = "round";
      for (const s of regionShapes(lm, "eyeliner", W, H)) {
        x.lineWidth = s.width * 2.4;
        x.beginPath();
        x.moveTo(s.pts[0].x, s.pts[0].y);
        for (const p of s.pts.slice(1)) x.lineTo(p.x, p.y);
        x.stroke();
      }
      // Grey circle lenses, drawn larger than the natural iris.
      x.fillStyle = "#93a2ad";
      for (const s of regionShapes(lm, "lenses", W, H)) {
        x.beginPath();
        x.arc(s.center.x, s.center.y, s.r, 0, Math.PI * 2);
        x.fill();
      }

      const dressed = buildPhotoLook(await createImageBitmap(c), lm);
      const bare = buildPhotoLook(img, lm);
      const mine = { color: { r: 62, g: 44, b: 36 }, ratio: bare.observed.eyes.ratio };
      return {
        dressedDrama: dressed.observed.lashDrama,
        bareDrama: bare.observed.lashDrama,
        dressedLash: !!dressed.layers.lashes,
        irisColour: dressed.observed.eyes.color,
        advice: lensAdvice(dressed.observed.eyes, mine),
        bareAdvice: lensAdvice(bare.observed.eyes, mine),
      };
    });
    check(`heavy lashes detected (drama ${wearables.dressedDrama.toFixed(2)})`,
      wearables.dressedDrama > 0.45);
    check(`bare lashes stay below the advice threshold (${wearables.bareDrama.toFixed(2)})`,
      wearables.bareDrama < 0.25 && wearables.bareDrama < wearables.dressedDrama);
    check("a dramatic reference adds a lash layer", wearables.dressedLash);
    check(`grey lenses detected (iris rgb ${Math.round(wearables.irisColour.r)},${Math.round(wearables.irisColour.g)},${Math.round(wearables.irisColour.b)})`,
      !!wearables.advice?.recoloured);
    check("no lens advice for eyes matching the wearer's own",
      wearables.bareAdvice === null);

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
    // Tapping back off step 1 lands on the preview rather than doing nothing.
    await page.mouse.click(stage2.x + stage2.width * 0.1, stage2.y + stage2.height / 2);
    await page.mouse.click(stage2.x + stage2.width * 0.1, stage2.y + stage2.height / 2);
    check("tapping back from step 1 returns to the preview",
      await page.evaluate(() =>
        window.__app.state.previewing && window.__app.state.tutorialMode));
    check("HUD names the preview",
      (await page.locator("#hud-chip").textContent()).includes("Preview"));
    await page.mouse.click(stage2.x + stage2.width * 0.9, stage2.y + stage2.height / 2);
    check("tapping forward from the preview begins the tutorial",
      await page.evaluate(() =>
        !window.__app.state.previewing && window.__app.state.stepIndex === 0));
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
