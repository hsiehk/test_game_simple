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
- **Preset looks** — Natural/Everyday, Soft Glam, Smokey Eye, Bold Lip, each
  with its own product colors and strengths.
- **Tutorial mode** — the heart of the app. Each look has 6 written steps with
  pro tips; the current step's region (lip line, crease, apples of the cheeks…)
  is outlined on your face with an animated dashed highlight, and the virtual
  makeup builds up step by step as you advance.
- **Learn from a photo** — upload any makeup photo (an Instagram look, a
  celebrity, a friend). The same face mesh is detected on the photo, each
  product's color is sampled from its region and expressed as a tint relative
  to the photo's skin tone, and a 7-step tutorial is generated. Each step
  zooms the reference photo into the area being taught (liner, crease,
  contour…) with the trace shape outlined there — and the matching shape is
  outlined on your own face to follow.
- **Contour layer** — cheekbone shading, included in photo-derived looks.
- **Intensity slider**, **hold-to-compare** (see your bare face), and
  **photo capture**.

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
vendor/               MediaPipe tasks-vision (JS + WASM) and the face model,
                      vendored so the app has zero CDN/third-party requests
tests/                Node data tests + Playwright browser smoke test
```

Face tracking: [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
(Apache-2.0), vendored in `vendor/`.
