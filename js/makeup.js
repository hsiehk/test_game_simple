// Canvas renderer: paints makeup layers onto a frame using face landmarks.
// Landmarks arrive normalized (0..1); all drawing happens in canvas pixels.

import {
  LIPS_OUTER, LIPS_INNER, LEFT_EYE, RIGHT_EYE,
  LEFT_BROW, RIGHT_BROW, LEFT_LASH, RIGHT_LASH,
  LEFT_LOWER_LASH, RIGHT_LOWER_LASH,
  LEFT_LASH_BROW, RIGHT_LASH_BROW,
  LEFT_CHEEK, RIGHT_CHEEK, LEFT_CONTOUR, RIGHT_CONTOUR,
  LEFT_IRIS, RIGHT_IRIS,
  LEFT_TEMPLE, RIGHT_TEMPLE, NOSE_BRIDGE, NOSE_TIP,
  FACE_WIDTH_REF, FACE_OVAL,
} from "./landmarks.js";
import { LAYER_ORDER } from "./looks.js";

function px(landmarks, index, w, h) {
  const p = landmarks[index];
  return { x: p.x * w, y: p.y * h };
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function polygon(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function polyline(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

export function faceWidth(landmarks, w, h) {
  const a = px(landmarks, FACE_WIDTH_REF[0], w, h);
  const b = px(landmarks, FACE_WIDTH_REF[1], w, h);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Eye centers and the derived similarity frame (midpoint, interocular
 * distance, eye-line angle) used to align a reference photo over the
 * live face.
 */
export function eyeFrame(landmarks, w, h) {
  const avg = (indices) => {
    let x = 0, y = 0;
    for (const i of indices) {
      const p = px(landmarks, i, w, h);
      x += p.x;
      y += p.y;
    }
    return { x: x / indices.length, y: y / indices.length };
  };
  const left = avg(LEFT_EYE);
  const right = avg(RIGHT_EYE);
  return {
    left,
    right,
    mid: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 },
    dist: Math.hypot(right.x - left.x, right.y - left.y),
    angle: Math.atan2(right.y - left.y, right.x - left.x),
  };
}

function toPoints(landmarks, indices, w, h) {
  return indices.map((i) => px(landmarks, i, w, h));
}

// Eyeshadow band: lash line forward, then points lerped from the brow back
// toward the lash line, reversed, forming a closed strip above the eye.
function shadowBand(landmarks, lashIdx, browIdx, w, h, reach) {
  const lash = toPoints(landmarks, lashIdx, w, h);
  const brow = toPoints(landmarks, browIdx, w, h);
  const upper = lash.map((p, i) => lerp(p, brow[i], reach)).reverse();
  return lash.concat(upper);
}

// The tail past the outer corner: continues the lash line's own exit
// direction so it follows each eye's natural angle. The lash line curves
// downward as it leaves the corner, so a lift is applied to bring the tail
// back to roughly level — extended and soft rather than flicked up or
// dragged down.
function outerWing(lm, lashIdx, w, h, fit) {
  const pts = toPoints(lm, lashIdx, w, h);
  const outer = pts[0];
  const inner = pts[pts.length - 1];
  const dx = outer.x - inner.x;
  const dy = outer.y - inner.y;
  const eyeW = Math.hypot(dx, dy) || 1;
  const ux = dx / eyeW, uy = dy / eyeW;   // outward along the eye
  const vx = uy, vy = -ux;                // perpendicular, upward
  // Measured off a reference photo when there is one; otherwise a short,
  // near-level tail that suits most eyes.
  const a = (fit?.a ?? 0.3) * eyeW;
  const b = (fit?.b ?? 0.09) * eyeW;
  return [outer, { x: outer.x + ux * a + vx * b, y: outer.y + uy * a + vy * b }];
}

/** Eye width, used to scale liner thickness measured off a photo. */
function eyeWidth(lm, lashIdx, w, h) {
  const pts = toPoints(lm, lashIdx, w, h);
  return Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) || 1;
}

// Lower liner is flattering along the outer half only; running it into the
// inner corner closes the eye up.
function lowerLinerPts(lm, lowerIdx, w, h) {
  const pts = toPoints(lm, lowerIdx, w, h);
  return pts.slice(0, Math.max(2, Math.round(pts.length * 0.6)));
}

function cheekCenter(landmarks, pair, w, h) {
  const a = px(landmarks, pair[0], w, h);
  const b = px(landmarks, pair[1], w, h);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function quadPoint(a, c, b, t) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/**
 * Contour as a brush would lay it: a curve following the hollow under the
 * cheekbone, wide near the ear and tapering forward, expressed as
 * overlapping soft dabs.
 *
 * Softness is built into the geometry rather than delegated to a canvas
 * blur filter. Not every browser applies ctx.filter — where it is ignored,
 * a stroked band renders as a hard-edged bar across the cheek — and per
 * frame a large blur is expensive on phones besides.
 */
function contourBrush(lm, pair, cheekPair, w, h) {
  const ear = px(lm, pair[0], w, h);
  const mouth = px(lm, pair[1], w, h);
  const cheek = cheekCenter(lm, cheekPair, w, h);
  const a = lerp(ear, mouth, 0.2);
  const b = lerp(ear, mouth, 0.66);
  const mid = lerp(a, b, 0.5);
  // Bend the path up toward the cheekbone so it hugs the bone.
  const ctrl = {
    x: mid.x + (cheek.x - mid.x) * 0.3,
    y: mid.y + (cheek.y - mid.y) * 0.5,
  };
  const fw = faceWidth(lm, w, h);
  const dabs = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    dabs.push({
      p: quadPoint(a, ctrl, b, t),
      radius: fw * (0.105 - 0.045 * t),
      weight: Math.sin(Math.PI * t) ** 0.6,
    });
  }
  return { kind: "brush", dabs, pts: dabs.map((d) => d.p) };
}

/**
 * Brows as pencil strokes rather than a filled outline: dabs walk the
 * centre line between the brow's upper and lower edges, sized to the brow's
 * own thickness at that point, thinning toward the tail and softest at the
 * head — filled-in brows that start sharply at the inner edge are the
 * giveaway of drawn-on brows.
 */
function browBrush(lm, browIdx, w, h, fit) {
  const half = browIdx.length / 2;
  const upper = toPoints(lm, browIdx.slice(0, half), w, h);
  // The loop's second half runs back the other way; reverse to pair it up.
  const lower = toPoints(lm, browIdx.slice(half), w, h).reverse();
  const a = upper[0];
  const b = upper[upper.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const vx = uy, vy = -ux;

  const along = (t) => {
    const f = t * (upper.length - 1);
    const i = Math.min(upper.length - 2, Math.floor(f));
    const k = f - i;
    return {
      u: lerp(upper[i], upper[i + 1], k),
      l: lerp(lower[i], lower[i + 1], k),
    };
  };

  // A measured brow carries its own edges; without one, fall back to the
  // mesh loop, which only approximates the shape.
  const edges = (t) => {
    if (fit?.length) {
      let lo = fit[0], hi = fit[fit.length - 1];
      for (let i = 0; i < fit.length - 1; i++) {
        if (fit[i].t <= t && fit[i + 1].t >= t) { lo = fit[i]; hi = fit[i + 1]; break; }
      }
      const span = hi.t - lo.t || 1;
      const k = Math.max(0, Math.min(1, (t - lo.t) / span));
      const up = lo.up + (hi.up - lo.up) * k;
      const down = lo.down + (hi.down - lo.down) * k;
      const base = { x: a.x + ux * t * len, y: a.y + uy * t * len };
      // Keep the measured band centred on the wearer's own brow line.
      const meshMid = lerp(along(t).u, along(t).l, 0.5);
      const drift = { x: meshMid.x - base.x, y: meshMid.y - base.y };
      const proj = drift.x * vx + drift.y * vy;
      const centreOffset = proj + (up - down) / 2 * len;
      return {
        centre: { x: base.x + vx * centreOffset, y: base.y + vy * centreOffset },
        thickness: (up + down) * len,
      };
    }
    const { u, l } = along(t);
    return { centre: lerp(u, l, 0.5), thickness: Math.hypot(u.x - l.x, u.y - l.y) };
  };

  const dabs = [];
  const steps = 16;
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const { centre, thickness } = edges(t);
    dabs.push({
      p: centre,
      radius: Math.max(2, thickness * 0.62),
      // Index 0 is the outer tail; soften both ends, most at the head.
      weight: Math.sin(Math.PI * (0.1 + 0.9 * t)) ** 0.5,
    });
  }
  // Outline follows the same edges, so the trace matches what is painted.
  const top = [], bottom = [];
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const { centre, thickness } = edges(t);
    top.push({ x: centre.x + vx * thickness / 2, y: centre.y + vy * thickness / 2 });
    bottom.push({ x: centre.x - vx * thickness / 2, y: centre.y - vy * thickness / 2 });
  }
  return { kind: "brush", dabs, pts: top.concat(bottom.reverse()), closed: true };
}

/**
 * Eyeshadow as a diffuse wash: dabs spread across the lid, densest along
 * the lash line and thinning toward the brow and the inner corner, so the
 * colour has no boundary of its own. The lower edge needs no softening —
 * the eye opening is repainted over it.
 */
function shadowBrush(lm, lashIdx, browIdx, w, h) {
  const lash = toPoints(lm, lashIdx, w, h);
  const brow = toPoints(lm, browIdx, w, h);
  const fw = faceWidth(lm, w, h);
  const dabs = [];
  const heights = 4;
  for (let i = 0; i < lash.length; i++) {
    const u = i / (lash.length - 1); // 0 outer corner, 1 inner corner
    for (let j = 0; j < heights; j++) {
      const t = 0.08 + (j / (heights - 1)) * 0.62;
      dabs.push({
        p: lerp(lash[i], brow[i], t),
        radius: fw * 0.058,
        // Fades upward toward the brow and inward toward the nose, and
        // eases off just past the outer corner.
        weight: (1 - t / 0.78) ** 1.15 * Math.max(0.12, Math.sin(Math.PI * (0.16 + 0.78 * u))),
      });
    }
  }
  return {
    kind: "brush",
    dabs,
    pts: shadowBand(lm, lashIdx, browIdx, w, h, 0.55),
    closed: true,
  };
}

/**
 * Points below the lower lash line, offset along each point's own
 * upper-to-lower direction so the curve follows the eye's shape rather
 * than sliding straight down the image.
 */
function underEyeOffset(lm, lashIdx, lowerIdx, w, h, drop) {
  const upper = toPoints(lm, lashIdx, w, h);
  const lower = toPoints(lm, lowerIdx, w, h);
  return lower.map((p, i) => {
    const dx = p.x - upper[i].x;
    const dy = p.y - upper[i].y;
    const len = Math.hypot(dx, dy) || 1;
    const eyeH = Math.max(len, 1);
    return { x: p.x + (dx / len) * eyeH * drop, y: p.y + (dy / len) * eyeH * drop };
  });
}

/**
 * Aegyo-sal: the ridge of "eye smile" fat right below the lower lashes,
 * lit rather than shaded. Highlighting it and shading beneath is what
 * gives the rounded, wide-eyed look in Korean tutorials.
 */
function aegyoSalBrush(lm, lashIdx, lowerIdx, w, h, fit) {
  const lower = toPoints(lm, lowerIdx, w, h);
  const top = fit?.top ?? 0.16;
  const bottom = fit?.bottom ?? 0.62;
  const near = underEyeOffset(lm, lashIdx, lowerIdx, w, h, top);
  const below = underEyeOffset(lm, lashIdx, lowerIdx, w, h, bottom);
  const fw = faceWidth(lm, w, h);
  const dabs = [];
  const rows = 3;
  for (let i = 0; i < lower.length; i++) {
    // 0 at the outer corner, 1 at the inner: keep it off the very corners.
    const u = i / (lower.length - 1);
    const edge = Math.sin(Math.PI * (0.1 + 0.8 * u));
    for (let j = 0; j < rows; j++) {
      const t = j / (rows - 1);
      dabs.push({
        p: lerp(near[i], below[i], t),
        radius: fw * 0.028,
        weight: edge * (1 - Math.abs(t - 0.5) * 0.9),
      });
    }
  }
  return {
    kind: "brush",
    dabs,
    pts: near.concat([...below].reverse()),
    closed: true,
  };
}

/** The soft shadow just under the aegyo-sal that gives it its roundness. */
function underEyeShadeBrush(lm, lashIdx, lowerIdx, w, h) {
  const line = underEyeOffset(lm, lashIdx, lowerIdx, w, h, 0.95);
  const fw = faceWidth(lm, w, h);
  const dabs = line.map((p, i) => {
    const u = i / (line.length - 1);
    return {
      p,
      radius: fw * 0.022,
      weight: Math.sin(Math.PI * (0.12 + 0.76 * u)) ** 0.8,
    };
  });
  return { kind: "brush", dabs, pts: line };
}

/**
 * Lashes fanned from the upper lash line: each stroke leans outward from
 * the eye's centre, longest toward the outer corner, tapering to a point.
 */
function lashStrokes(lm, lashIdx, eyeIdx, w, h) {
  const lash = toPoints(lm, lashIdx, w, h);
  const eye = toPoints(lm, eyeIdx, w, h);
  const cx = eye.reduce((a, p) => a + p.x, 0) / eye.length;
  const cy = eye.reduce((a, p) => a + p.y, 0) / eye.length;
  const eyeW = Math.hypot(lash[0].x - lash[lash.length - 1].x,
    lash[0].y - lash[lash.length - 1].y);
  const out = [];
  for (let i = 1; i < lash.length - 1; i++) {
    const u = i / (lash.length - 1);
    const base = lash[i];
    const dx = base.x - cx;
    const dy = base.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    // Longest at the outer third, shortest at the inner corner.
    const reach = eyeW * (0.30 - 0.16 * u);
    const lean = (lash[0].x - cx) / (Math.abs(lash[0].x - cx) || 1);
    out.push({
      kind: "line",
      width: Math.max(1, eyeW * 0.022),
      pts: [
        base,
        {
          x: base.x + (dx / len) * reach + lean * reach * 0.35,
          y: base.y + (dy / len) * reach,
        },
      ],
    });
  }
  return out;
}

/**
 * A soft round deposit: a cluster of dabs filling a radius, used by the
 * blush placements so each one blends like powder rather than a disc.
 */
function blob(centre, radius, weight, fw) {
  const dabs = [];
  const rings = 2;
  for (let r = 0; r < rings; r++) {
    const rr = (r / rings) * radius;
    const count = r === 0 ? 1 : 6;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      dabs.push({
        p: { x: centre.x + Math.cos(a) * rr, y: centre.y + Math.sin(a) * rr },
        radius: Math.max(fw * 0.03, radius * 0.55),
        weight: weight * (1 - (rr / radius) * 0.45),
      });
    }
  }
  return dabs;
}

function smear(from, to, radius, weight, fw, steps = 5) {
  const dabs = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    dabs.push(...blob(lerp(from, to, t), radius * (1 - t * 0.3),
      weight * Math.sin(Math.PI * (0.18 + 0.8 * t)), fw));
  }
  return dabs;
}

/**
 * Where blush sits changes the whole face, and the placements have names
 * and followings of their own, so each is a choice rather than a constant.
 */
function blushBrush(lm, style, w, h) {
  const fw = faceWidth(lm, w, h);
  const cheeks = [
    { pair: LEFT_CHEEK, temple: LEFT_TEMPLE, lash: LEFT_LASH, lower: LEFT_LOWER_LASH },
    { pair: RIGHT_CHEEK, temple: RIGHT_TEMPLE, lash: RIGHT_LASH, lower: RIGHT_LOWER_LASH },
  ];
  const bridge = px(lm, NOSE_BRIDGE, w, h);
  const tip = px(lm, NOSE_TIP, w, h);
  const dabs = [];

  for (const c of cheeks) {
    const apple = cheekCenter(lm, c.pair, w, h);
    const temple = px(lm, c.temple, w, h);
    const underEye = underEyeOffset(lm, c.lash, c.lower, w, h, 1.5);
    const midUnder = underEye[Math.floor(underEye.length / 2)];

    switch (style) {
      case "draping":
        // Swept up from the cheek to the temple, blush as contour.
        dabs.push(...smear(apple, lerp(apple, temple, 0.85), fw * 0.085, 1, fw, 6));
        break;
      case "eyeEnlarging":
        // Hugging the lower lid, which pushes the eye open.
        dabs.push(...smear(
          lerp(underEye[underEye.length - 2], apple, 0.15),
          lerp(underEye[1], apple, 0.3), fw * 0.062, 0.95, fw, 5));
        break;
      case "rabbit":
        // High and tight to the lower lid, carrying on over the bridge:
        // the flushed look. Deliberately higher than sunkissed, which is
        // the other placement that crosses the nose.
        dabs.push(...smear(midUnder, lerp(midUnder, apple, 0.22), fw * 0.06, 0.95, fw, 4));
        dabs.push(...blob(lerp(midUnder, bridge, 0.85), fw * 0.05, 0.8, fw));
        break;
      case "cheekbones":
        // Round and high, with a touch on the nose.
        dabs.push(...blob(lerp(apple, temple, 0.3), fw * 0.1, 1, fw));
        break;
      case "sunkissed":
        // One low, wide band running cheek to cheek across the nose, sitting
        // level with the apples rather than up under the eyes.
        dabs.push(...smear(lerp(apple, temple, 0.4), lerp(apple, tip, 0.55),
          fw * 0.09, 0.95, fw, 6));
        break;
      case "apples":
      default:
        dabs.push(...blob(apple, fw * 0.105, 1, fw));
        break;
    }
  }

  if (style === "cheekbones") dabs.push(...blob(tip, fw * 0.035, 0.5, fw));
  if (style === "sunkissed") dabs.push(...blob(lerp(bridge, tip, 0.8), fw * 0.055, 0.7, fw));

  return [{ kind: "brush", dabs, pts: dabs.map((d) => d.p) }];
}

/** Shimmer at the inner corner (眼头) — what opens the eye inward. */
function innerCornerBrush(lm, lashIdx, w, h) {
  const lash = toPoints(lm, lashIdx, w, h);
  const inner = lash[lash.length - 1];
  const along = lash[lash.length - 3] ?? lash[0];
  const fw = faceWidth(lm, w, h);
  const dx = inner.x - along.x;
  const dy = inner.y - along.y;
  const len = Math.hypot(dx, dy) || 1;
  const centre = { x: inner.x + (dx / len) * fw * 0.012, y: inner.y + (dy / len) * fw * 0.006 };
  return { kind: "brush", dabs: blob(centre, fw * 0.028, 1, fw), pts: [centre] };
}

/** Depth wrapped around the outer corner (眼尾), lid and lower lid together. */
function outerCornerBrush(lm, lashIdx, lowerIdx, w, h) {
  const lash = toPoints(lm, lashIdx, w, h);
  const lower = toPoints(lm, lowerIdx, w, h);
  const fw = faceWidth(lm, w, h);
  const outer = lash[0];
  const dabs = [
    ...blob(outer, fw * 0.045, 1, fw),
    ...blob(lerp(lash[0], lash[2], 0.7), fw * 0.038, 0.8, fw),
    ...blob(lerp(lower[0], lower[2], 0.7), fw * 0.036, 0.75, fw),
  ];
  return { kind: "brush", dabs, pts: dabs.map((d) => d.p) };
}

/** Colour laid on the lower lid itself (下眼皮铺色), outer weighted. */
function lowerLidBrush(lm, lashIdx, lowerIdx, w, h) {
  const lower = toPoints(lm, lowerIdx, w, h);
  const below = underEyeOffset(lm, lashIdx, lowerIdx, w, h, 0.5);
  const fw = faceWidth(lm, w, h);
  const dabs = [];
  for (let i = 0; i < lower.length; i++) {
    const u = i / (lower.length - 1); // 0 outer, 1 inner
    for (const t of [0.15, 0.5]) {
      dabs.push({
        p: lerp(lower[i], below[i], t),
        radius: fw * 0.03,
        // Heaviest at the outer third, gone before the inner corner.
        weight: Math.max(0, (1 - u) ** 0.8) * (1 - t * 0.4),
      });
    }
  }
  return { kind: "brush", dabs, pts: lower.concat([...below].reverse()), closed: true };
}

/** Lower lashes, short and fanning downward. */
function lowerLashStrokes(lm, lowerIdx, eyeIdx, w, h) {
  const lower = toPoints(lm, lowerIdx, w, h);
  const eye = toPoints(lm, eyeIdx, w, h);
  const cx = eye.reduce((a, p) => a + p.x, 0) / eye.length;
  const cy = eye.reduce((a, p) => a + p.y, 0) / eye.length;
  const eyeW = Math.hypot(lower[0].x - lower[lower.length - 1].x,
    lower[0].y - lower[lower.length - 1].y);
  const out = [];
  for (let i = 1; i < lower.length - 1; i++) {
    const u = i / (lower.length - 1);
    const base = lower[i];
    const dx = base.x - cx;
    const dy = base.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const reach = eyeW * (0.16 - 0.07 * u);
    out.push({
      kind: "line",
      width: Math.max(1, eyeW * 0.016),
      pts: [base, { x: base.x + (dx / len) * reach, y: base.y + (dy / len) * reach }],
    });
  }
  return out;
}

/** Iris disc, from the refined iris ring. */
function irisDisc(lm, irisIdx, w, h) {
  const c = px(lm, irisIdx[0], w, h);
  const rim = irisIdx.slice(1).map((i) => px(lm, i, w, h));
  const r = rim.reduce((a, p) => a + Math.hypot(p.x - c.x, p.y - c.y), 0) / rim.length;
  return { kind: "circle", center: c, r };
}

/**
 * Geometry of every paintable/traceable region, in canvas pixels.
 * Returns an array of shapes:
 *   { kind: "poly",   pts }             closed filled/outlined polygon
 *   { kind: "line",   pts, width }      open stroked path
 *   { kind: "circle", center, r }       filled/outlined disc
 * Shared by the live-view painters, the tutorial highlight, and the
 * reference-photo zoom/trace overlay, so all three always agree.
 */
export function regionShapes(lm, layer, w, h, opts) {
  const o = typeof opts === "string" ? { blushStyle: opts } : (opts ?? {});
  const variant = o.blushStyle;
  const liner = o.liner;
  const brows = o.brows;
  const aegyo = o.aegyo;
  const linerWidth = (i, lashIdx, fallback) => (liner?.[i]?.thickness
    ? Math.max(1.2, eyeWidth(lm, lashIdx, w, h) * liner[i].thickness)
    : fallback);
  const fw = faceWidth(lm, w, h);
  switch (layer) {
    case "foundation":
      return [{ kind: "poly", pts: toPoints(lm, FACE_OVAL, w, h) }];
    case "brows":
      return [
        browBrush(lm, LEFT_BROW, w, h, brows?.[0]),
        browBrush(lm, RIGHT_BROW, w, h, brows?.[1]),
      ];
    case "eyeshadow":
      return [
        shadowBrush(lm, LEFT_LASH, LEFT_LASH_BROW, w, h),
        shadowBrush(lm, RIGHT_LASH, RIGHT_LASH_BROW, w, h),
      ];
    case "eyeliner":
      return [
        { kind: "line", pts: toPoints(lm, LEFT_LASH, w, h),
          width: linerWidth(0, LEFT_LASH, Math.max(1.5, fw * 0.012)) },
        { kind: "line", pts: toPoints(lm, RIGHT_LASH, w, h),
          width: linerWidth(1, RIGHT_LASH, Math.max(1.5, fw * 0.012)) },
      ];
    case "linerWing":
      return [
        { kind: "line", pts: outerWing(lm, LEFT_LASH, w, h, liner?.[0]),
          width: linerWidth(0, LEFT_LASH, Math.max(1.5, fw * 0.013)) },
        { kind: "line", pts: outerWing(lm, RIGHT_LASH, w, h, liner?.[1]),
          width: linerWidth(1, RIGHT_LASH, Math.max(1.5, fw * 0.013)) },
      ];
    case "linerLower":
      return [
        { kind: "line", pts: lowerLinerPts(lm, LEFT_LOWER_LASH, w, h), width: Math.max(1.2, fw * 0.009) },
        { kind: "line", pts: lowerLinerPts(lm, RIGHT_LOWER_LASH, w, h), width: Math.max(1.2, fw * 0.009) },
      ];
    case "aegyoSal":
      return [
        aegyoSalBrush(lm, LEFT_LASH, LEFT_LOWER_LASH, w, h, aegyo?.[0]),
        aegyoSalBrush(lm, RIGHT_LASH, RIGHT_LOWER_LASH, w, h, aegyo?.[1]),
      ];
    case "underEyeShade":
      return [
        underEyeShadeBrush(lm, LEFT_LASH, LEFT_LOWER_LASH, w, h),
        underEyeShadeBrush(lm, RIGHT_LASH, RIGHT_LOWER_LASH, w, h),
      ];
    case "lashes":
      return [
        ...lashStrokes(lm, LEFT_LASH, LEFT_EYE, w, h),
        ...lashStrokes(lm, RIGHT_LASH, RIGHT_EYE, w, h),
      ];
    case "lowerLid":
      return [
        lowerLidBrush(lm, LEFT_LASH, LEFT_LOWER_LASH, w, h),
        lowerLidBrush(lm, RIGHT_LASH, RIGHT_LOWER_LASH, w, h),
      ];
    case "outerCorner":
      return [
        outerCornerBrush(lm, LEFT_LASH, LEFT_LOWER_LASH, w, h),
        outerCornerBrush(lm, RIGHT_LASH, RIGHT_LOWER_LASH, w, h),
      ];
    case "innerCorner":
      return [
        innerCornerBrush(lm, LEFT_LASH, w, h),
        innerCornerBrush(lm, RIGHT_LASH, w, h),
      ];
    case "lowerLashes":
      return [
        ...lowerLashStrokes(lm, LEFT_LOWER_LASH, LEFT_EYE, w, h),
        ...lowerLashStrokes(lm, RIGHT_LOWER_LASH, RIGHT_EYE, w, h),
      ];
    case "lenses":
      return [irisDisc(lm, LEFT_IRIS, w, h), irisDisc(lm, RIGHT_IRIS, w, h)];
    case "blush":
      return blushBrush(lm, variant, w, h);
    case "contour":
      return [
        contourBrush(lm, LEFT_CONTOUR, LEFT_CHEEK, w, h),
        contourBrush(lm, RIGHT_CONTOUR, RIGHT_CHEEK, w, h),
      ];
    case "lipstick":
      return [{ kind: "poly", pts: toPoints(lm, LIPS_OUTER, w, h) }];
    default:
      return [];
  }
}

// One soft round brush head, drawn once and reused for every dab of every
// layer. Its falloff is the deposit's softness; colour is applied after.
let DAB_SPRITE = null;
function dabSprite() {
  if (DAB_SPRITE) return DAB_SPRITE;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const x = c.getContext("2d");
  const r = size / 2;
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.59)");
  g.addColorStop(0.75, "rgba(255,255,255,0.2)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  DAB_SPRITE = c;
  return c;
}

/** The pixels a set of brush shapes can touch, clamped to the canvas. */
function dabBounds(shapes, w, h) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    if (!s.dabs) continue;
    for (const d of s.dabs) {
      minX = Math.min(minX, d.p.x - d.radius);
      maxX = Math.max(maxX, d.p.x + d.radius);
      minY = Math.min(minY, d.p.y - d.radius);
      maxY = Math.max(maxY, d.p.y + d.radius);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const bw = Math.min(w, Math.ceil(maxX)) - x;
  const bh = Math.min(h, Math.ceil(maxY)) - y;
  return bw > 0 && bh > 0 ? { x, y, w: bw, h: bh } : null;
}

/** Bounding box of a set of shapes: { x, y, w, h }. */
export function shapesBounds(shapes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    let pts;
    if (s.kind === "circle") {
      pts = [
        { x: s.center.x - s.r, y: s.center.y - s.r },
        { x: s.center.x + s.r, y: s.center.y + s.r },
      ];
    } else if (s.kind === "brush" && s.closed) {
      pts = s.pts;
    } else if (s.kind === "brush") {
      pts = s.dabs.flatMap((d) => [
        { x: d.p.x - d.radius, y: d.p.y - d.radius },
        { x: d.p.x + d.radius, y: d.p.y + d.radius },
      ]);
    } else {
      pts = s.pts;
    }
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Where the camera should sit to teach a layer: the region's box padded
 * out for working room, as a center + scale that fits it into w x h.
 * maxScale keeps a tiny region (a lash line) from filling the frame at an
 * unusable magnification.
 */
export function zoomTargetFor(lm, layer, w, h, { pad = 1.22, maxScale = 4, variant } = {}) {
  const box = shapesBounds(regionShapes(lm, layer, w, h, variant));
  if (!box) return null;
  const bw = Math.max(box.w * pad, 1);
  const bh = Math.max(box.h * pad, 1);
  return {
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2,
    scale: Math.min(maxScale, Math.max(1, Math.min(w / bw, h / bh))),
  };
}

/** Trace a shape into the context's current path (no fill/stroke). */
export function traceShape(ctx, shape) {
  if (shape.kind === "circle") {
    ctx.beginPath();
    ctx.arc(shape.center.x, shape.center.y, shape.r, 0, Math.PI * 2);
  } else if (shape.kind === "brush" && shape.closed) {
    polygon(ctx, shape.pts);
  } else if (shape.kind === "line" || shape.kind === "brush") {
    polyline(ctx, shape.pts);
  } else {
    polygon(ctx, shape.pts);
  }
}

function paintShapes(ctx, shapes, { fill = true } = {}) {
  for (const s of shapes) {
    traceShape(ctx, s);
    if (s.kind === "line") {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.width;
      ctx.stroke();
    } else if (fill) {
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

// Per-layer paint styling on top of the shared geometry.
const LAYER_STYLE = {
  foundation: { composite: "soft-light", skinOnly: true },
  contour: { composite: "multiply", brush: true, dabAlpha: 0.055 },
  brows: { composite: "multiply", brush: true, dabAlpha: 0.12 },
  eyeshadow: { composite: "multiply", brush: true, dabAlpha: 0.05 },
  eyeliner: { composite: "multiply" },
  // The tail is drawn from the corner outward, so it tapers to nothing at
  // the tip; the lower line softens at both ends.
  linerWing: { composite: "multiply", fadeTip: true },
  linerLower: { composite: "multiply", fadeEnds: true },
  lowerLid: { composite: "multiply", brush: true, dabAlpha: 0.05 },
  outerCorner: { composite: "multiply", brush: true, dabAlpha: 0.05 },
  // Highlights, so they lighten rather than darken.
  innerCorner: { composite: "screen", brush: true, dabAlpha: 0.07 },
  lowerLashes: { composite: "multiply", fadeTip: true, afterEyes: true },
  aegyoSal: { composite: "screen", brush: true, dabAlpha: 0.05 },
  underEyeShade: { composite: "multiply", brush: true, dabAlpha: 0.05 },
  // Painted after the eye opening is restored, or they would be wiped.
  lashes: { composite: "multiply", fadeTip: true, afterEyes: true },
  lenses: { composite: "color", radial: true, afterEyes: true },
  blush: { composite: "multiply", brush: true, dabAlpha: 0.035 },
  lipstick: { composite: "multiply", carveMouth: true },
};

// Features foundation must not wash over — tinting brows, eyes and lips
// is what makes a base layer read as an orange filter instead of skin.
const FOUNDATION_HOLES = [LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS_OUTER];

function paintLayer(ctx, lm, layer, w, h, { color, alpha, blend, variant }, scratch) {
  const style = LAYER_STYLE[layer];
  const shapes = regionShapes(lm, layer, w, h, variant);
  if (!style || shapes.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = blend ?? style.composite;
  ctx.globalAlpha = alpha;
  // No ctx.filter anywhere. Softness is carried by the geometry — brush
  // dabs, feathered outlines, gradient-faded strokes — which is what the
  // app already had to do for browsers that ignore the property. Keeping a
  // blur as well cost roughly ten times the entire rest of the frame
  // (394ms against 40ms measured over a full look) to duplicate softness
  // that is already there.
  ctx.filter = "none";

  if (style.brush) {
    // Dabs are laid into a scratch layer first: painted straight onto the
    // frame, each overlap would multiply again and build a dark core.
    // Merged in a layer, they read as one soft deposit composited once.
    //
    // Two things keep this affordable at video rate. Each dab is one
    // drawImage of a shared sprite rather than its own radial gradient —
    // building a gradient per dab meant hundreds of allocations a frame.
    // And every touch of the scratch layer is confined to the box the
    // dabs actually occupy, so a highlight the size of a fingertip no
    // longer clears and composites the whole frame.
    const sc = scratch?.ctx;
    const box = dabBounds(shapes, w, h);
    if (sc && box) {
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(box.x, box.y, box.w, box.h);
      sc.globalCompositeOperation = "source-over";
      sc.filter = "none";
      const sprite = dabSprite();
      for (const s of shapes) {
        for (const d of s.dabs) {
          const a = (style.dabAlpha ?? 0.055) * d.weight;
          if (a <= 0.002) continue;
          sc.globalAlpha = a;
          sc.drawImage(sprite, d.p.x - d.radius, d.p.y - d.radius,
            d.radius * 2, d.radius * 2);
        }
      }
      // The sprite carries shape, not colour: tint the accumulated alpha.
      sc.globalAlpha = 1;
      sc.globalCompositeOperation = "source-in";
      sc.fillStyle = color;
      sc.fillRect(box.x, box.y, box.w, box.h);
      ctx.globalAlpha = alpha;
      ctx.drawImage(scratch.canvas, box.x, box.y, box.w, box.h,
        box.x, box.y, box.w, box.h);
    }
  } else if (style.skinOnly) {
    // Feathered face oval: nested inset copies of the real outline, each at
    // low opacity, ramp coverage up from nothing at the edge. A radial
    // gradient cannot reach zero along a non-circular boundary, so the base
    // used to end on a visible face-shaped line down each side.
    const sc = scratch?.ctx;
    if (!sc) return;
    const pts = shapes[0].pts;
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, w, h);
    sc.globalCompositeOperation = "source-over";
    sc.filter = "none";
    sc.fillStyle = color;
    const rings = 12;
    for (let k = 0; k < rings; k++) {
      const shrink = 1 - (k / (rings - 1)) * 0.16;
      sc.globalAlpha = 0.16;
      polygon(sc, pts.map((p) => ({
        x: cx + (p.x - cx) * shrink,
        y: cy + (p.y - cy) * shrink,
      })));
      sc.fill();
    }
    // Keep the base off the features it would otherwise tint, easing the
    // cutout outward so the eyes and lips are not ringed by a sharp line.
    sc.globalCompositeOperation = "destination-out";
    for (const hole of FOUNDATION_HOLES) {
      const hp = toPoints(lm, hole, w, h);
      const hx = hp.reduce((a, q) => a + q.x, 0) / hp.length;
      const hy = hp.reduce((a, q) => a + q.y, 0) / hp.length;
      for (let k = 6; k >= 0; k--) {
        const grow = 1 + (k / 6) * 0.35;
        sc.globalAlpha = k === 0 ? 1 : 0.3;
        polygon(sc, hp.map((q) => ({
          x: hx + (q.x - hx) * grow,
          y: hy + (q.y - hy) * grow,
        })));
        sc.fill();
      }
    }
    sc.globalAlpha = 1;
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch.canvas, 0, 0);
    } else if (style.carveMouth) {
    // Fill the outer lip loop with the mouth opening carved out (evenodd).
    ctx.fillStyle = color;
    const outer = shapes[0].pts;
    const inner = toPoints(lm, LIPS_INNER, w, h);
    polygon(ctx, outer);
    ctx.moveTo(inner[0].x, inner[0].y);
    for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
    ctx.closePath();
    ctx.fill("evenodd");
  } else if (style.radial) {
    for (const s of shapes) {
      const g = ctx.createRadialGradient(s.center.x, s.center.y, 0, s.center.x, s.center.y, s.r);
      // Eased falloff: a straight ramp leaves a visible disc edge.
      g.addColorStop(0, color);
      g.addColorStop(0.3, `${color}d0`);
      g.addColorStop(0.6, `${color}70`);
      g.addColorStop(0.82, `${color}26`);
      g.addColorStop(1, `${color}00`);
      ctx.fillStyle = g;
      traceShape(ctx, s);
      ctx.fill();
    }
  } else if (style.fadeEnds || style.fadeTip) {
    // Product laid down by a brush or pencil has no hard start or stop.
    // fadeEnds dissolves at both ends (shading, lower liner); fadeTip keeps
    // the base solid and tapers to nothing (a wing's point).
    const stops = style.fadeTip
      ? [[0, ""], [0.5, "e6"], [0.8, "8c"], [1, "00"]]
      : [[0, "00"], [0.3, "d9"], [0.65, "b3"], [1, "00"]];
    for (const s of shapes) {
      const a = s.pts[0];
      const b = s.pts[s.pts.length - 1];
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      for (const [at, alpha] of stops) g.addColorStop(at, `${color}${alpha}`);
      ctx.strokeStyle = g;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.width;
      traceShape(ctx, s);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    paintShapes(ctx, shapes);
  }
  ctx.restore();
}

export class MakeupRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    // Current (smoothed) camera; null until the first frame sizes it.
    this.view = null;
    this.scratchLayer = null;
  }

  // Reusable offscreen layer for brush-composited products.
  #scratch(w, h) {
    if (!this.scratchLayer || this.scratchLayer.canvas.width !== w
        || this.scratchLayer.canvas.height !== h) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      this.scratchLayer = { canvas, ctx: canvas.getContext("2d") };
    }
    return this.scratchLayer;
  }

  /** Ease the live view toward the step's target region. */
  #updateView(landmarks, zoomLayer, w, h, fit) {
    const identity = { cx: w / 2, cy: h / 2, scale: 1 };
    let target = identity;
    if (landmarks && zoomLayer) {
      target = zoomTargetFor(landmarks, zoomLayer, w, h, { variant: fit }) ?? identity;
    }
    if (!this.view) {
      this.view = { ...target };
      return this.view;
    }
    const k = 0.16; // per-frame easing; a glide, not a jump
    this.view.cx += (target.cx - this.view.cx) * k;
    this.view.cy += (target.cy - this.view.cy) * k;
    this.view.scale += (target.scale - this.view.scale) * k;
    return this.view;
  }

  /**
   * Draw one frame.
   * @param source     video element (or image) already sized to canvas
   * @param landmarks  normalized face landmarks, or null when no face
   * @param look       look object from looks.js (or a photo-derived look)
   * @param options    { intensity 0..1, enabledLayers: Set|null,
   *                     highlightLayer: string|null, compare: bool, time: ms }
   */
  render(source, landmarks, look, options) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    const shapeOpts = {
      blushStyle: options.blushStyle,
      liner: look?.liner,
      brows: look?.browShape,
      aegyo: look?.aegyoShape,
    };
    const view = this.#updateView(landmarks, options.zoomLayer, w, h, shapeOpts);

    ctx.save();
    // Mirror for selfie view, then frame the region being taught.
    ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.translate(w / 2, h / 2);
    ctx.scale(view.scale, view.scale);
    ctx.translate(-view.cx, -view.cy);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(source, 0, 0, w, h);

    if (landmarks && look && !options.compare) {
      const fw = faceWidth(landmarks, w, h);

      const paint = (afterEyes) => {
        for (const layer of LAYER_ORDER) {
          const cfg = look.layers[layer];
          if (!cfg) continue;
          if (Boolean(LAYER_STYLE[layer]?.afterEyes) !== afterEyes) continue;
          if (options.enabledLayers && !options.enabledLayers.has(layer)) continue;
          const alpha = cfg.amount * options.intensity;
          if (alpha <= 0.01) continue;
          paintLayer(ctx, landmarks, layer, w, h,
            { color: cfg.color, alpha, blend: cfg.blend, variant: shapeOpts },
            this.#scratch(w, h));
        }
      };

      paint(false);
      // Restore untinted eyes on top of shadow/liner.
      this.#restoreEyes(source, landmarks, w, h);
      // Lashes and lenses belong on top of the eye, not under it.
      paint(true);

      // Ghost overlay: the reference photo aligned over the live face
      // (matched by eye midpoint, interocular scale, and eye-line angle).
      if (options.ghost) {
        this.#drawGhost(options.ghost, landmarks, w, h);
      }

      if (options.highlightLayer) {
        this.#drawHighlight(
          landmarks, options.highlightLayer, w, h, fw, options.time ?? 0, view.scale,
          shapeOpts,
        );
      }
    }

    ctx.restore();
  }

  #drawGhost(ghost, liveLm, w, h) {
    const { ctx } = this;
    const live = eyeFrame(liveLm, w, h);
    const ref = eyeFrame(ghost.landmarks, ghost.image.width, ghost.image.height);
    if (ref.dist < 1) return;
    const s = live.dist / ref.dist;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = ghost.opacity;
    ctx.filter = "none";
    ctx.translate(live.mid.x, live.mid.y);
    ctx.rotate(live.angle - ref.angle);
    ctx.scale(s, s);
    ctx.translate(-ref.mid.x, -ref.mid.y);
    ctx.drawImage(ghost.image, 0, 0);
    ctx.restore();
  }

  #restoreEyes(source, lm, w, h) {
    const { ctx } = this;
    // Save/restore per eye so the caller's transform (mirror + zoom) is
    // inherited rather than rebuilt. Only the clipped eye region is
    // redrawn, not the whole frame twice over.
    for (const eye of [LEFT_EYE, RIGHT_EYE]) {
      const pts = toPoints(lm, eye, w, h);
      const box = shapesBounds([{ kind: "poly", pts }]);
      if (!box) continue;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      polygon(ctx, pts);
      ctx.clip();
      ctx.drawImage(source, box.x, box.y, box.w, box.h,
        box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }

  #drawHighlight(lm, layer, w, h, fw, time, zoom = 1, variant) {
    const { ctx } = this;
    const pulse = 0.55 + 0.45 * Math.sin(time / 300);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.9 * pulse;
    ctx.filter = "none";
    ctx.strokeStyle = "#ffffff";
    // Divide by the zoom so the guide keeps its on-screen weight.
    ctx.lineWidth = Math.max(1.5, fw * 0.008) / zoom;
    ctx.setLineDash([8 / zoom, 6 / zoom]);
    ctx.lineDashOffset = -(time / 40) % 14;
    ctx.shadowColor = "rgba(255,80,140,0.9)";
    ctx.shadowBlur = 8 / zoom;

    for (const s of regionShapes(lm, layer, w, h, variant)) {
      traceShape(ctx, s);
      ctx.stroke();
    }
    ctx.restore();
  }
}
