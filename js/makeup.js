// Canvas renderer: paints makeup layers onto a frame using face landmarks.
// Landmarks arrive normalized (0..1); all drawing happens in canvas pixels.

import {
  LIPS_OUTER, LIPS_INNER, LEFT_EYE, RIGHT_EYE,
  LEFT_BROW, RIGHT_BROW, LEFT_LASH, RIGHT_LASH,
  LEFT_LOWER_LASH, RIGHT_LOWER_LASH,
  LEFT_LASH_BROW, RIGHT_LASH_BROW,
  LEFT_CHEEK, RIGHT_CHEEK, LEFT_CONTOUR, RIGHT_CONTOUR,
  LEFT_IRIS, RIGHT_IRIS,
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
function outerWing(lm, lashIdx, w, h) {
  const pts = toPoints(lm, lashIdx, w, h);
  const outer = pts[0];
  const along = pts[3] ?? pts[1];
  const dx = outer.x - along.x;
  const dy = outer.y - along.y;
  const len = Math.hypot(dx, dy) || 1;
  const eyeW = Math.hypot(outer.x - pts[pts.length - 1].x, outer.y - pts[pts.length - 1].y);
  const reach = eyeW * 0.3;
  return [
    outer,
    {
      x: outer.x + (dx / len) * reach,
      y: outer.y + (dy / len) * reach - eyeW * 0.09,
    },
  ];
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
  const n = 26;
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
function browBrush(lm, browIdx, w, h) {
  const half = browIdx.length / 2;
  const upper = toPoints(lm, browIdx.slice(0, half), w, h);
  // The loop's second half runs back the other way; reverse to pair it up.
  const lower = toPoints(lm, browIdx.slice(half), w, h).reverse();
  const dabs = [];
  const steps = 22;
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const f = t * (upper.length - 1);
    const i = Math.min(upper.length - 2, Math.floor(f));
    const k = f - i;
    const u = lerp(upper[i], upper[i + 1], k);
    const l = lerp(lower[i], lower[i + 1], k);
    const centre = lerp(u, l, 0.5);
    const thickness = Math.hypot(u.x - l.x, u.y - l.y);
    dabs.push({
      p: centre,
      radius: Math.max(2, thickness * 0.62),
      // Index 0 is the outer tail; soften both ends, most at the head.
      weight: Math.sin(Math.PI * (0.1 + 0.9 * t)) ** 0.5,
    });
  }
  return { kind: "brush", dabs, pts: toPoints(lm, browIdx, w, h), closed: true };
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
  const heights = 6;
  for (let i = 0; i < lash.length; i++) {
    const u = i / (lash.length - 1); // 0 outer corner, 1 inner corner
    for (let j = 0; j < heights; j++) {
      const t = 0.08 + (j / (heights - 1)) * 0.62;
      dabs.push({
        p: lerp(lash[i], brow[i], t),
        radius: fw * 0.05,
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
function aegyoSalBrush(lm, lashIdx, lowerIdx, w, h) {
  const lower = toPoints(lm, lowerIdx, w, h);
  const below = underEyeOffset(lm, lashIdx, lowerIdx, w, h, 0.62);
  const fw = faceWidth(lm, w, h);
  const dabs = [];
  const rows = 3;
  for (let i = 0; i < lower.length; i++) {
    // 0 at the outer corner, 1 at the inner: keep it off the very corners.
    const u = i / (lower.length - 1);
    const edge = Math.sin(Math.PI * (0.1 + 0.8 * u));
    for (let j = 0; j < rows; j++) {
      const t = 0.25 + (j / (rows - 1)) * 0.5;
      dabs.push({
        p: lerp(lower[i], below[i], t),
        radius: fw * 0.028,
        weight: edge * (1 - Math.abs(t - 0.45) * 1.1),
      });
    }
  }
  return {
    kind: "brush",
    dabs,
    pts: lower.concat([...below].reverse()),
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
export function regionShapes(lm, layer, w, h) {
  const fw = faceWidth(lm, w, h);
  switch (layer) {
    case "foundation":
      return [{ kind: "poly", pts: toPoints(lm, FACE_OVAL, w, h) }];
    case "brows":
      return [
        browBrush(lm, LEFT_BROW, w, h),
        browBrush(lm, RIGHT_BROW, w, h),
      ];
    case "eyeshadow":
      return [
        shadowBrush(lm, LEFT_LASH, LEFT_LASH_BROW, w, h),
        shadowBrush(lm, RIGHT_LASH, RIGHT_LASH_BROW, w, h),
      ];
    case "eyeliner":
      return [
        { kind: "line", pts: toPoints(lm, LEFT_LASH, w, h), width: Math.max(1.5, fw * 0.012) },
        { kind: "line", pts: toPoints(lm, RIGHT_LASH, w, h), width: Math.max(1.5, fw * 0.012) },
      ];
    case "linerWing":
      return [
        { kind: "line", pts: outerWing(lm, LEFT_LASH, w, h), width: Math.max(1.5, fw * 0.013) },
        { kind: "line", pts: outerWing(lm, RIGHT_LASH, w, h), width: Math.max(1.5, fw * 0.013) },
      ];
    case "linerLower":
      return [
        { kind: "line", pts: lowerLinerPts(lm, LEFT_LOWER_LASH, w, h), width: Math.max(1.2, fw * 0.009) },
        { kind: "line", pts: lowerLinerPts(lm, RIGHT_LOWER_LASH, w, h), width: Math.max(1.2, fw * 0.009) },
      ];
    case "aegyoSal":
      return [
        aegyoSalBrush(lm, LEFT_LASH, LEFT_LOWER_LASH, w, h),
        aegyoSalBrush(lm, RIGHT_LASH, RIGHT_LOWER_LASH, w, h),
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
    case "lenses":
      return [irisDisc(lm, LEFT_IRIS, w, h), irisDisc(lm, RIGHT_IRIS, w, h)];
    case "blush":
      return [
        { kind: "circle", center: cheekCenter(lm, LEFT_CHEEK, w, h), r: fw * 0.16 },
        { kind: "circle", center: cheekCenter(lm, RIGHT_CHEEK, w, h), r: fw * 0.16 },
      ];
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
export function zoomTargetFor(lm, layer, w, h, { pad = 1.22, maxScale = 4 } = {}) {
  const box = shapesBounds(regionShapes(lm, layer, w, h));
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
  foundation: { composite: "soft-light", blurScale: 1.5, skinOnly: true },
  contour: { composite: "multiply", blurScale: 1.2, brush: true, dabAlpha: 0.055 },
  brows: { composite: "multiply", blurScale: 0.5, brush: true, dabAlpha: 0.12 },
  eyeshadow: { composite: "multiply", blurScale: 0.9, brush: true, dabAlpha: 0.05 },
  eyeliner: { composite: "multiply", blurScale: 0.4 },
  // The tail is drawn from the corner outward, so it tapers to nothing at
  // the tip; the lower line softens at both ends.
  linerWing: { composite: "multiply", blurScale: 0.5, fadeTip: true },
  linerLower: { composite: "multiply", blurScale: 0.7, fadeEnds: true },
  // Highlight, so it lightens rather than darkens.
  aegyoSal: { composite: "screen", blurScale: 1.0, brush: true, dabAlpha: 0.05 },
  underEyeShade: { composite: "multiply", blurScale: 1.0, brush: true, dabAlpha: 0.05 },
  // Painted after the eye opening is restored, or they would be wiped.
  lashes: { composite: "multiply", blurScale: 0.3, fadeTip: true, afterEyes: true },
  lenses: { composite: "color", blurScale: 0.2, radial: true, afterEyes: true },
  blush: { composite: "multiply", blurScale: 1.0, radial: true },
  lipstick: { composite: "multiply", blurScale: 0.5, carveMouth: true },
};

// Features foundation must not wash over — tinting brows, eyes and lips
// is what makes a base layer read as an orange filter instead of skin.
const FOUNDATION_HOLES = [LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS_OUTER];

function paintLayer(ctx, lm, layer, w, h, { color, alpha, blur, blend }, scratch) {
  const style = LAYER_STYLE[layer];
  const shapes = regionShapes(lm, layer, w, h);
  if (!style || shapes.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = blend ?? style.composite;
  ctx.globalAlpha = alpha;
  ctx.filter = `blur(${blur * style.blurScale}px)`;

  if (style.brush) {
    // Dabs are laid into a scratch layer first: painted straight onto the
    // frame, each overlap would multiply again and build a dark core.
    // Merged in a layer, they read as one soft deposit composited once.
    const sc = scratch?.ctx;
    if (sc) {
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, w, h);
      sc.globalCompositeOperation = "source-over";
      sc.filter = "none";
      for (const s of shapes) {
        for (const d of s.dabs) {
          const g = sc.createRadialGradient(d.p.x, d.p.y, 0, d.p.x, d.p.y, d.radius);
          g.addColorStop(0, color);
          g.addColorStop(0.45, `${color}96`);
          g.addColorStop(0.75, `${color}33`);
          g.addColorStop(1, `${color}00`);
          sc.globalAlpha = (style.dabAlpha ?? 0.055) * d.weight;
          sc.fillStyle = g;
          sc.beginPath();
          sc.arc(d.p.x, d.p.y, d.radius, 0, Math.PI * 2);
          sc.fill();
        }
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(scratch.canvas, 0, 0);
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
  #updateView(landmarks, zoomLayer, w, h) {
    const identity = { cx: w / 2, cy: h / 2, scale: 1 };
    let target = identity;
    if (landmarks && zoomLayer) {
      target = zoomTargetFor(landmarks, zoomLayer, w, h) ?? identity;
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

    const view = this.#updateView(landmarks, options.zoomLayer, w, h);

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
      // ctx.filter blur is measured in device pixels and ignores the current
      // transform, so without this the zoom would sharpen every edge just as
      // the user leans in.
      const blur = Math.max(2, fw * 0.03) * view.scale;

      const paint = (afterEyes) => {
        for (const layer of LAYER_ORDER) {
          const cfg = look.layers[layer];
          if (!cfg) continue;
          if (Boolean(LAYER_STYLE[layer]?.afterEyes) !== afterEyes) continue;
          if (options.enabledLayers && !options.enabledLayers.has(layer)) continue;
          const alpha = cfg.amount * options.intensity;
          if (alpha <= 0.01) continue;
          paintLayer(ctx, landmarks, layer, w, h,
            { color: cfg.color, alpha, blur, blend: cfg.blend }, this.#scratch(w, h));
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
    // inherited rather than rebuilt.
    for (const eye of [LEFT_EYE, RIGHT_EYE]) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      polygon(ctx, toPoints(lm, eye, w, h));
      ctx.clip();
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
    }
  }

  #drawHighlight(lm, layer, w, h, fw, time, zoom = 1) {
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

    for (const s of regionShapes(lm, layer, w, h)) {
      traceShape(ctx, s);
      ctx.stroke();
    }
    ctx.restore();
  }
}
