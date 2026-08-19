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
import {
  LIPS_INNER, LEFT_IRIS, RIGHT_IRIS, LEFT_LASH, RIGHT_LASH,
} from "./landmarks.js";
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

/**
 * How opaquely to lay a matched lip color down. A strongly colored
 * reference lip should read clearly; a barely-there nude should stay sheer.
 */
export function lipStrength({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max === 0 ? 0 : (max - min) / max;
  return Math.max(0.55, Math.min(0.95, 0.55 + chroma * 1.1));
}


// A bare lash line is already far darker than skin — lashes plus the shadow
// of the lid see to that — so drama is measured across the range above that
// baseline, not from zero. Measured on an unmade-up face: 0.69 darker than
// skin bare, 0.89 with a heavy line painted on.
const LASH_BASELINE = 0.66;
const LASH_HEAVY = 0.88;

/**
 * How dramatic the reference's lashes are, 0..1.
 *
 * This measures density, not what produced it: heavy mascara and a strip of
 * falsies both read high, and nothing here can tell them apart. It also
 * reads a face lit from below or shot in shadow as darker than it is. The
 * advice built on this says as much rather than asserting falsies.
 */
export function lashDrama(lashColor, skin) {
  if (!lashColor || !skin) return 0;
  const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const skinLum = Math.max(lum(skin), 1);
  const ratio = 1 - lum(lashColor) / skinLum;
  return Math.max(0, Math.min(1, (ratio - LASH_BASELINE) / (LASH_HEAVY - LASH_BASELINE)));
}

/**
 * Iris width as a fraction of eye width. Circle lenses enlarge the visible
 * iris, so a reference sitting well above the wearer's own ratio is the
 * signal that lenses — not makeup — are doing the work.
 */
export function irisRatio(lm, irisIdx, lashIdx) {
  const c = lm[irisIdx[0]];
  const rim = irisIdx.slice(1).map((i) => lm[i]);
  const r = rim.reduce((a, p) => a + Math.hypot(p.x - c.x, p.y - c.y), 0) / rim.length;
  const a = lm[lashIdx[0]];
  const b = lm[lashIdx[lashIdx.length - 1]];
  const eyeW = Math.hypot(a.x - b.x, a.y - b.y);
  return eyeW > 0 ? (r * 2) / eyeW : 0;
}

/**
 * Compare a reference iris against the wearer's own. Returns what to say
 * about lenses, or null when there is nothing worth suggesting.
 * `mine` may be null when the camera has not seen the user's eyes yet.
 */
export function lensAdvice(ref, mine) {
  if (!ref) return null;
  const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const dist = mine
    ? Math.hypot(ref.color.r - mine.color.r, ref.color.g - mine.color.g,
        ref.color.b - mine.color.b)
    : null;
  const bigger = mine ? ref.ratio - mine.ratio : 0;

  const enlarged = bigger > 0.05;
  const recoloured = dist !== null ? dist > 55 : lum(ref.color) > 95;
  if (!enlarged && !recoloured) return null;
  return {
    color: ref.color,
    enlarged,
    recoloured,
    ratio: ref.ratio,
  };
}

/**
 * Highlights are judged by how much brighter than skin they are, since a
 * tint relative to skin only ever describes something darker.
 */
export function highlightStrength(region, skin, { floor = 0.15, cap = 0.55 } = {}) {
  if (!region || !skin) return floor;
  const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const lift = (lum(region) - lum(skin)) / Math.max(lum(skin), 1);
  return Math.max(floor, Math.min(cap, lift * 2.2));
}

const HIGHLIGHT_LAYERS = new Set(["innerCorner", "aegyoSal"]);

// Per-layer application strength caps (a lip color can go bolder than a
// full-face contour without looking painted on).
const LAYER_CAPS = {
  foundation: { floor: 0.2, cap: 0.4 },
  contour: { floor: 0.12, cap: 0.5 },
  brows: { floor: 0.15, cap: 0.6 },
  eyeshadow: { floor: 0.15, cap: 0.7 },
  eyeliner: { floor: 0.2, cap: 0.8 },
  linerWing: { floor: 0.15, cap: 0.8 },
  linerLower: { floor: 0.12, cap: 0.7 },
  lowerLid: { floor: 0.12, cap: 0.55 },
  outerCorner: { floor: 0.15, cap: 0.6 },
  innerCorner: { floor: 0.15, cap: 0.55 },
  lowerLashes: { floor: 0.2, cap: 0.7 },
  aegyoSal: { floor: 0.15, cap: 0.5 },
  underEyeShade: { floor: 0.1, cap: 0.45 },
  lashes: { floor: 0.3, cap: 0.9 },
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
    layer: "lowerLid",
    title: "Carry colour under the lower lashes",
    instruction: "Sweep the same shade through the outlined area beneath your lower lashes, heaviest at the outer third and fading out before the inner corner. Compare how far it reaches in your reference.",
    tip: "Use the colour left on the brush — the lower lid needs a fraction of what the lid took.",
  },
  {
    layer: "outerCorner",
    title: "Deepen the outer corner",
    instruction: "Press a deeper shade into the outlined outer corner with a small brush, joining the lid and lower lid so they wrap into a soft V. Check how dark your reference takes this.",
    tip: "Small amounts, many times — this is the step that shapes the eye.",
  },
  {
    layer: "eyeliner",
    title: "Trace the liner",
    instruction: "Look closely at how thick the liner sits on the upper lash line in your reference, and where it starts. Trace the dashed line on your own lash line, keeping it thinnest at the inner corner and building thickness toward the outside. The corner and lower line come next.",
    tip: "Wiggle the pencil into the base of the lashes first so no pale gaps show through.",
  },
  {
    layer: "linerWing",
    title: "Extend the outer corner",
    instruction: "Look at where the liner leaves the eye in your reference: how far past the corner it reaches and whether it lifts up or drops down. Trace the same tail on your face, starting thick at the corner and pressing lighter as you go so it tapers to a point.",
    tip: "Look straight ahead in the mirror while you draw the tail — drawing it with your eye closed lands it in the wrong place once you open up.",
  },
  {
    layer: "linerLower",
    title: "Line the lower lash line",
    instruction: "Follow the outlined line under your lower lashes, working from the outer corner inward and stopping around the middle of the eye. Keep it finer than the upper line, and connect it into the tail so the two meet at the corner.",
    tip: "Smudge the lower line with a cotton bud — a crisp line under the eye reads harsh in daylight.",
  },
  {
    layer: "innerCorner",
    title: "Brighten the inner corner",
    instruction: "Press a pearly shimmer into the small outlined patch at each inner corner. It takes almost nothing and makes the eyes look wider apart and more awake.",
    tip: "Pat it on with a fingertip; a fluffy brush scatters it across the lid.",
  },
  {
    layer: "aegyoSal",
    title: "Light up the aegyo-sal",
    instruction: "Just under your lower lashes is a small ridge that puffs up when you smile. Press a light shimmer along the outlined band there — pat it on with a fingertip rather than sweeping, so it stays put and catches the light.",
    tip: "Smile in the mirror first: highlight only the part that actually rises, or it reads as under-eye puffiness.",
  },
  {
    layer: "underEyeShade",
    title: "Shade below it",
    instruction: "Draw the faintest line of a cool taupe along the lower outlined curve, just beneath the ridge you highlighted, then blend it until it is barely a shadow. This is what makes the ridge look rounded rather than flat.",
    tip: "Use a shade cooler and lighter than your contour — warm brown here reads as a dark circle.",
  },
  {
    layer: "lashes",
    title: "Lashes",
    instruction: "Curl your lashes hard at the root, then coat from the base upward, wiggling as you go. Concentrate the outer third to pull the eye outward, matching the fan shown on your face.",
    tip: "Let each coat dry a few seconds before the next, or they clump instead of lengthening.",
  },
  {
    layer: "lowerLashes",
    title: "Lower lashes",
    instruction: "Hold the wand vertically and touch each lower lash separately, following the short fan outlined on your face, keeping them fine and separated.",
    tip: "A smaller wand — or the tip of a used one — gives far more control down here.",
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
 * Representative color of the image pixels covered by a layer's region.
 *
 * The median is taken rather than the mean: a lip region catches teeth,
 * gloss highlights and inner-mouth shadow, and averaging those in drags the
 * result toward a washed-out pink that matches nothing. The median ignores
 * a minority of extreme pixels entirely.
 *
 * `hole` punches a region out of the mask (the mouth opening, for lips).
 */
function sampleLayer(imageData, lm, layer, w, h, { hole } = {}) {
  const mask = makeCanvas(w, h);
  const mctx = mask.getContext("2d");
  mctx.fillStyle = mctx.strokeStyle = "#fff";
  for (const s of regionShapes(lm, layer, w, h)) {
    traceShape(mctx, s);
    if (s.kind === "line") {
      mctx.lineCap = "round";
      mctx.lineWidth = s.width;
      mctx.stroke();
    } else if (s.kind === "brush") {
      for (const d of s.dabs) {
        mctx.beginPath();
        mctx.arc(d.p.x, d.p.y, d.radius * 0.7, 0, Math.PI * 2);
        mctx.fill();
      }
    } else {
      mctx.fill();
    }
  }
  if (hole) {
    mctx.save();
    mctx.globalCompositeOperation = "destination-out";
    mctx.fillStyle = "#fff";
    const pts = hole.map((i) => ({ x: lm[i].x * w, y: lm[i].y * h }));
    mctx.beginPath();
    mctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) mctx.lineTo(pts[i].x, pts[i].y);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
  }
  const m = mctx.getImageData(0, 0, w, h).data;
  const img = imageData.data;
  const rs = [], gs = [], bs = [];
  for (let i = 3; i < m.length; i += 4) {
    if (m[i] > 0) {
      rs.push(img[i - 3]);
      gs.push(img[i - 2]);
      bs.push(img[i - 1]);
    }
  }
  if (rs.length === 0) return null;
  const mid = (arr) => {
    arr.sort((a, b) => a - b);
    return arr[arr.length >> 1];
  };
  return { r: mid(rs), g: mid(gs), b: mid(bs) };
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
    const avg = sampleLayer(imageData, landmarks, layer, w, h,
      layer === "lipstick" ? { hole: LIPS_INNER } : undefined);
    if (!avg || !skin) continue;
    if (layer === "foundation") {
      // Foundation paints the photo's own skin tone as a soft-light wash.
      layers.foundation = { color: rgbToHex(skin), amount: LAYER_CAPS.foundation.cap };
    } else if (HIGHLIGHT_LAYERS.has(layer)) {
      // Painted with the sampled colour itself; a multiply tint cannot
      // describe something lighter than the skin around it.
      layers[layer] = {
        color: rgbToHex(avg),
        amount: highlightStrength(avg, skin, LAYER_CAPS[layer]),
      };
    } else if (layer === "lipstick") {
      // Lips carry the reference's actual color rather than a tint relative
      // to its skin: a multiply tint clips at white, so a vivid red comes
      // out muddy. The "color" blend transfers hue and saturation while
      // keeping the wearer's own lip shading and highlights.
      layers.lipstick = {
        color: rgbToHex(avg),
        amount: lipStrength(avg),
        blend: "color",
      };
    } else {
      const tint = tintFromAverages(avg, skin);
      layers[layer] = {
        color: rgbToHex(tint),
        amount: amountFromTint(tint, LAYER_CAPS[layer]),
      };
    }
  }

  // Lashes: how dark the band sitting on the lash line is, versus skin.
  const lashBand = sampleLayer(imageData, landmarks, "eyeliner", w, h);
  const drama = lashDrama(lashBand, skin);
  if (drama > 0.25) {
    layers.lashes = {
      color: rgbToHex(lashBand),
      amount: Math.min(LAYER_CAPS.lashes.cap, LAYER_CAPS.lashes.floor + drama * 0.6),
    };
  }

  // Eyes: iris colour and how wide the iris sits relative to the eye.
  const iris = sampleLayer(imageData, landmarks, "lenses", w, h);
  const ratio = (irisRatio(landmarks, LEFT_IRIS, LEFT_LASH)
    + irisRatio(landmarks, RIGHT_IRIS, RIGHT_LASH)) / 2;
  const eyes = iris ? { color: iris, ratio } : null;

  return {
    id: "photo",
    name: "From your photo",
    description: "Colors and placement sampled from your uploaded reference photo. Follow the tutorial to recreate it — each step zooms the photo into the area being taught.",
    steps: PHOTO_STEPS.filter((s) => layers[s.layer]),
    layers,
    // Observations the tutorial turns into advice, rather than paint.
    observed: { lashDrama: drama, eyes },
  };
}

/**
 * Read the wearer's own iris from a live frame, so lens advice compares
 * their eyes against the reference rather than against an assumption.
 */
export function readEyes(source, landmarks, w, h) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, w, h);
  const color = sampleLayer(ctx.getImageData(0, 0, w, h), landmarks, "lenses", w, h);
  if (!color) return null;
  const ratio = (irisRatio(landmarks, LEFT_IRIS, LEFT_LASH)
    + irisRatio(landmarks, RIGHT_IRIS, RIGHT_LASH)) / 2;
  return { color, ratio };
}

/**
 * Draw a zoomed crop of the reference photo focused on one layer's region,
 * with the trace shape outlined, into the given canvas.
 */
export function drawReferenceCrop(canvas, image, landmarks, layer, variant) {
  const iw = image.width;
  const ih = image.height;
  const shapes = regionShapes(landmarks, layer, iw, ih, variant);
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
