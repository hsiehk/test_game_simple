# 💄 MirrorMuse — Learn Makeup with AR

An AR makeup mirror that teaches you how to do makeup, in the style of
Instagram/Snapchat face filters. Pick a look, see it rendered live on your own
face, then follow a step-by-step tutorial that highlights exactly where each
product goes — on *your* face — as the look builds up product by product.

Everything runs in the browser, fully on-device. No app install, no account,
and no photos or video ever leave your machine.

## Features

- **Live AR try-on** — real-time 478-point face tracking (MediaPipe Face
  Landmarker) drives virtual foundation, brows, eyeshadow, eyeliner, blush and
  lipstick that follow your face.
- **Preset looks** — Natural/Everyday, Soft Glam, Smokey Eye, Korean Everyday
  Eye and Bold Lip, with palettes drawn from editorial conventions (sheer
  skin, taupe and bronze lids, graphite smoke, blue-red lip) rather than
  saturated filter colors.
- **Tutorial mode** — the heart of the app. Each look has written steps with
  pro tips (six for the simplest, fifteen for the Korean eye); the current step's region (lip line, crease, apples of the cheeks…)
  is outlined on your face with an animated dashed highlight, and the virtual
  makeup builds up step by step as you advance.
- **Learn from a photo** — upload any makeup photo (an Instagram look, a
  celebrity, a friend). The same face mesh is detected on the photo, each
  product's color is sampled from its region and expressed as a tint relative
  to the photo's skin tone, and a tutorial is generated from the steps that
  photo actually calls for. Each step
  zooms the reference photo into the area being taught (liner, crease,
  contour…) with the trace shape outlined there — and the matching shape is
  outlined on your own face to follow.
- **Step zoom** — the mirror frames the part of your face the current step is
  teaching (eyes for liner and shadow, cheeks for blush, mouth for lips) and
  glides between them, with the reference photo's matching region pinned
  alongside so you can work close-up, part by part. Toggleable.
- **The whole eye, taught in order** — lid wash, lower-lid colour (下眼皮铺色),
  outer-corner depth (眼尾), upper liner, tail, lower liner, inner-corner
  shimmer (眼头), aegyo-sal highlight (卧蚕) and the shading beneath it, then
  upper and lower lashes. Each is its own region with its own step, following
  the sequence Korean and Chinese tutorials actually teach.
- **Six blush placements** — apples, draping, eye-enlarging, rabbit, high
  cheekbones and sunkissed. Where blush sits changes the face more than which
  pink it is, so each look picks one and you can try the rest.
- **Reads what is not makeup** — an uploaded reference is measured for things
  makeup cannot do. A lash line far denser than bare lashes is reported
  (falsies or layered mascara — a photo cannot tell those apart, and the
  advice says so), and the iris is compared against the wearer's own for both
  colour and size, since circle lenses enlarge it. These appear as notes
  beside the tutorial rather than as steps to paint. Coloured lenses can also
  be rendered on the iris itself.
- **Contour layer** — cheekbone shading, in photo-derived looks and the
  Soft Glam / Smokey Eye presets.
- **Mirror mode** — hides every panel for a clean, full-bleed mirror. The
  on-face trace lines and color fills stay; a minimal HUD keeps the step name
  and arrows, and tapping the left/right third of the screen steps the
  tutorial.
- **Hold-to-ghost** — press and hold the mirror to overlay your reference
  photo, aligned to your face by eye position, scale and tilt. Drag left or
  right while holding to fade it up or down.
- **Send instructions to your phone** — a QR code carries the tutorial to your
  phone, which shows the written steps (with each step's sampled color) while
  the big screen stays a clean mirror. No server and no upload: the phone runs
  this same app, so the code carries only which look — or which layers and
  colors a photo produced — and the phone rebuilds the rest.
- **Intensity slider**, **hold-to-compare** (see your bare face), and
  **photo capture**.

## Performance

A live AR mirror runs the camera, a neural face tracker and a full repaint
every frame, so it will always cost more than a static page. What it should
not do is waste that budget:

- **No canvas blur.** Every layer's softness comes from its geometry — brush
  dabs, feathered outlines, gradient-faded strokes. Asking for a `ctx.filter`
  blur on top measured at **394ms per frame against 40ms without**, roughly
  ten times the cost of everything else combined, to duplicate softness that
  was already there. (It was also never reliably applied: browsers that
  ignore the property were rendering hard edges, which is what made the
  contour look like two bars on a cheek.)
- **Never render more pixels than are displayed**, capped at 720px wide.
  Cost tracks pixel count almost exactly: 960×720 → 720×540 → 640×480
  measured 387ms → 216ms → 152ms before the blur was removed.
- **One shared brush sprite.** Each dab is a `drawImage` of a single
  pre-rendered soft disc rather than its own radial gradient — that was
  hundreds of gradient allocations every frame.
- **Scratch work is bounded to the region.** A highlight the size of a
  fingertip no longer clears and composites a full-frame offscreen canvas.
- **30fps, and nothing at all while the page is hidden.** Phones offer 60 or
  120Hz; a mirror does not need them, and face tracking rides the same gate.

Two browser checks guard this: no layer may request a canvas blur, and the
render surface may not exceed its display size.

## Run locally

Any static file server works:

```bash
npm start            # serves on http://localhost:8080 (uses python3)
# or: npx serve .
```

Open the URL in Chrome or Safari and allow camera access.

## Tests

```bash
npm test             # data-integrity tests (Node, no browser needed)
npm run test:browser # full smoke test in headless Chromium with a fake camera
                     # (needs: npm i -D playwright-core, and a Chromium install)
```

## Deploy (free, via GitHub Pages)

The workflow in `.github/workflows/deploy.yml` runs the tests and publishes
the site to GitHub Pages on every push to `main`.

One-time setup: repository **Settings → Pages → Build and deployment →
Source: GitHub Actions**. The site then lives at
`https://<user>.github.io/<repo>/`.

Camera access requires HTTPS, which GitHub Pages provides out of the box.

## Architecture

```
index.html            app shell
css/style.css         styling
js/app.js             camera, MediaPipe wiring, UI state, render loop
js/makeup.js          canvas renderer: paints each makeup layer from landmarks
js/landmarks.js       face-mesh region definitions (lips, eyes, brows, cheeks…)
js/looks.js           preset looks + tutorial step content
js/photolook.js       reference-photo analysis: color sampling, generated
                      tutorial, zoomed reference crops with trace outlines
js/companion.js       phone hand-off: packs/compresses the tutorial into a
                      URL fragment for the QR code, and parses it back
vendor/               MediaPipe tasks-vision (JS + WASM) and the face model,
                      vendored so the app has zero CDN/third-party requests
tests/                Node data tests + Playwright browser smoke test
```

Face tracking: [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
(Apache-2.0). QR rendering:
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
Both vendored in `vendor/`.
