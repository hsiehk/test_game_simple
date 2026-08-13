// Build a makeup look from an uploaded reference photo.
//
// The same 478-landmark topology is detected on the photo as on the live
// face, so every region (lips, lids, cheeks…) corresponds 1:1 between the
// two faces. We sample the photo's colors per region, express each as a
// product tint relative to the photo's own skin tone, and reuse the live
// renderer to paint that tint onto the user's face. The tutorial zooms the
// photo into the region being taught and outlines the trace shape there.
//
// Pure color math lives at the top (unit-testable in Node); everything that
// needs a canvas/DOM is below.

import { regionShapes, traceShape, shapesBounds } from "./makeup.js";
import { LAYER_ORDER } from "./looks.js";

// ---------- pure helpers (no DOM) ----------

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Express a sampled region color as a multiplicative product tint relative
 * to the face's skin tone. If the region matches skin exactly the tint is
 * white (no-op under multiply); the more the region diverges the stronger
 * the tint. Channels are clamped to 255 so multiply can only darken.
 */
export function tintFromAverages(region, skin) {
  const t = (rc, sc) => Math.max(0, Math.min(255, (rc / Math.max(sc, 1)) * 255));
  return { r: t(region.r, skin.r), g: t(region.g, skin.g), b: t(region.b, skin.b) };
}

/**
 * How strongly to apply a tint: white → barely, far-from-white → strongly.
 * Result is clamped to [floor, cap].
 */
export function amountFromTint(tint, { floor = 0.15, cap = 0.8 } = {}) {
  const dist = Math.max(255 - tint.r, 255 - tint.g, 255 - tint.b) / 255;
  return Math.max(floor, Math.min(cap, dist * 1.6));
}

// Per-layer application strength caps (a lip color can go bolder than a
// full-face contour without looking painted on).
const LAYER_CAPS = {
  foundation: { floor: 0.2, cap: 0.4 },
  contour: { floor: 0.1, cap: 0.5 },
  brows: { floor: 0.15, cap: 0.6 },
  eyeshadow: { floor: 0.15, cap: 0.7 },
  eyeliner: { floor: 0.2, cap: 0.8 },
  blush: { floor: 0.15, cap: 0.6 },
  lipstick: { floor: 0.25, cap: 0.85 },
};

// Tutorial steps for a photo-derived look. The reference panel zooms into
// the same region on the uploaded photo, so the text leans on it.
export const PHOTO_STEPS = [
  {
    layer: "foundation",
    title: "Match the base",
    instruction: "Look at your reference photo: how even and matte is the skin? Apply foundation to match that finish, blending from the center of your face outward.",
    tip: "Aim to match the reference's finish (dewy vs matte), not its skin tone.",
  },
  {
    layer: "contour",
    title: "Copy the contour",
    instruction: "The dashed line shows where the shading sits under the cheekbones in your reference. Suck in your cheeks to find your own hollow, then blend contour along the matching line on your face.",
    tip: "Blend upward — a harsh lower edge is the most common contour mistake.",
  },
  {
    layer: "brows",
    title: "Trace the brow shape",
    instruction: "Compare the outlined brow in the reference with your own: note where its arch peaks and how sharp the tail is. Fill your brows following the outline shown on your face.",
    tip: "Adapt the shape to your bone structure — copy the vibe, not the exact arch.",
  },
  {
    layer: "eyeshadow",
    title: "Recreate the eye shadow",
    instruction: "Study the lid in your reference: note how far the color extends toward the brow and past the outer corner, then build the same shape inside the outlined band on your own lids, in thin blended layers.",
    tip: "Match where the color *stops* — placement matters more than the exact shade.",
  },
  {
    layer: "eyeliner",
    title: "Trace the liner",
    instruction: "Look closely at the liner's thickness and wing angle in your reference. Trace the dashed lash line on your face, matching that thickness, and finish the wing at the same angle.",
    tip: "Draw the wing first, then connect it back along the lash line.",
  },
  {
    layer: "blush",
    title: "Place the blush",
    instruction: "See where the flush sits in the reference — high on the cheekbone or on the apples? Apply inside the outlined circles on your face, blending toward your temples.",
    tip: "If the reference blush looks strong, still build it in two sheer passes.",
  },
  {
    layer: "lipstick",
    title: "Finish with the lips",
    instruction: "Your reference shows the lip edge and finish. Line your lips following the outline on your face, fill with the matched color, and copy the reference's finish — blotted matte or glossy.",
    tip: "Overlining more than a millimetre rarely reads natural in person.",
  },
];

// ---------- canvas-dependent analysis ----------

const SAMPLE_MAX_DIM = 1024;

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Average color of the image pixels covered by a layer's region shapes.
 * Shapes are rasterized into an alpha mask; pixels with mask alpha > 0 count.
 */
function sampleLayer(imageData, lm, layer, w, h) {
  const mask = makeCanvas(w, h);
  const mctx = mask.getContext("2d");
  mctx.fillStyle = mctx.strokeStyle = "#fff";
  for (const s of regionShapes(lm, layer, w, h)) {
    traceShape(mctx, s);
    if (s.kind === "line") {
      mctx.lineCap = "round";
      mctx.lineWidth = s.width;
      mctx.stroke();
    } else {
      mctx.fill();
    }
  }
  const m = mctx.getImageData(0, 0, w, h).data;
  const img = imageData.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 3; i < m.length; i += 4) {
    if (m[i] > 0) {
      r += img[i - 3];
      g += img[i - 2];
      b += img[i - 1];
      n++;
    }
  }
  if (n === 0) return null;
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Analyze an uploaded photo (with its detected landmarks) into a look
 * object compatible with the live renderer and tutorial UI.
 */
export function buildPhotoLook(image, landmarks) {
  const scale = Math.min(1, SAMPLE_MAX_DIM / Math.max(image.width, image.height));
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const skin = sampleLayer(imageData, landmarks, "foundation", w, h);
  const layers = {};
  for (const layer of LAYER_ORDER) {
    const avg = sampleLayer(imageData, landmarks, layer, w, h);
    if (!avg || !skin) continue;
    if (layer === "foundation") {
      // Foundation paints the photo's own skin tone as a soft-light wash.
      layers.foundation = { color: rgbToHex(skin), amount: LAYER_CAPS.foundation.cap };
    } else {
      const tint = tintFromAverages(avg, skin);
      layers[layer] = {
        color: rgbToHex(tint),
        amount: amountFromTint(tint, LAYER_CAPS[layer]),
      };
    }
  }

  return {
    id: "photo",
    name: "From your photo",
    description: "Colors and placement sampled from your uploaded reference photo. Follow the tutorial to recreate it — each step zooms the photo into the area being taught.",
    steps: PHOTO_STEPS.filter((s) => layers[s.layer]),
    layers,
  };
}

/**
 * Draw a zoomed crop of the reference photo focused on one layer's region,
 * with the trace shape outlined, into the given canvas.
 */
export function drawReferenceCrop(canvas, image, landmarks, layer) {
  const iw = image.width;
  const ih = image.height;
  const shapes = regionShapes(landmarks, layer, iw, ih);
  if (shapes.length === 0) return;

  const box = shapesBounds(shapes);
  if (!box) return;
  const padX = box.w * 0.35 + iw * 0.02;
  const padY = box.h * 0.45 + ih * 0.02;
  const cropX = Math.max(0, box.x - padX);
  const cropY = Math.max(0, box.y - padY);
  const cropW = Math.min(iw, box.x + box.w + padX) - cropX;
  const cropH = Math.min(ih, box.y + box.h + padY) - cropY;

  // Fit the crop into the canvas (contain, centered).
  const ctx = canvas.getContext("2d");
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  const s = Math.min(cw / cropW, ch / cropH);
  const dx = (cw - cropW * s) / 2;
  const dy = (ch - cropH * s) / 2;

  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  ctx.translate(dx, dy);
  ctx.scale(s, s);
  ctx.translate(-cropX, -cropY);
  ctx.drawImage(image, 0, 0, iw, ih);

  // Trace outline, matching the live-view highlight styling.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, 2.5 / s);
  ctx.setLineDash([8 / s, 6 / s]);
  ctx.shadowColor = "rgba(255,80,140,0.9)";
  ctx.shadowBlur = 6 / s;
  for (const shape of shapes) {
    traceShape(ctx, shape);
    ctx.stroke();
  }
  ctx.restore();
}
