// Canvas renderer: paints makeup layers onto a frame using face landmarks.
// Landmarks arrive normalized (0..1); all drawing happens in canvas pixels.

import {
  LIPS_OUTER, LIPS_INNER, LEFT_EYE, RIGHT_EYE,
  LEFT_BROW, RIGHT_BROW, LEFT_LASH, RIGHT_LASH,
  LEFT_LASH_BROW, RIGHT_LASH_BROW,
  LEFT_CHEEK, RIGHT_CHEEK, LEFT_CONTOUR, RIGHT_CONTOUR,
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

// Eyeshadow shape plus the axis its color fades along: real shadow is
// densest at the lash line and diffuses toward the brow, so the band
// carries gradient endpoints rather than being filled flat.
function shadowShape(lm, lashIdx, browIdx, w, h) {
  const reach = 0.55;
  const pts = shadowBand(lm, lashIdx, browIdx, w, h, reach);
  const n = lashIdx.length;
  const mid = Math.floor(n / 2);
  return {
    kind: "poly",
    pts,
    grad: { from: pts[mid], to: pts[pts.length - 1 - mid] },
  };
}

function cheekCenter(landmarks, pair, w, h) {
  const a = px(landmarks, pair[0], w, h);
  const b = px(landmarks, pair[1], w, h);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Contour stroke: a segment under the cheekbone running from near the ear
// toward the mouth corner.
function contourSegment(landmarks, pair, w, h) {
  const ear = px(landmarks, pair[0], w, h);
  const mouth = px(landmarks, pair[1], w, h);
  return [lerp(ear, mouth, 0.22), lerp(ear, mouth, 0.62)];
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
        { kind: "poly", pts: toPoints(lm, LEFT_BROW, w, h) },
        { kind: "poly", pts: toPoints(lm, RIGHT_BROW, w, h) },
      ];
    case "eyeshadow":
      return [
        shadowShape(lm, LEFT_LASH, LEFT_LASH_BROW, w, h),
        shadowShape(lm, RIGHT_LASH, RIGHT_LASH_BROW, w, h),
      ];
    case "eyeliner":
      return [
        { kind: "line", pts: toPoints(lm, LEFT_LASH, w, h), width: Math.max(1.5, fw * 0.012) },
        { kind: "line", pts: toPoints(lm, RIGHT_LASH, w, h), width: Math.max(1.5, fw * 0.012) },
      ];
    case "blush":
      return [
        { kind: "circle", center: cheekCenter(lm, LEFT_CHEEK, w, h), r: fw * 0.16 },
        { kind: "circle", center: cheekCenter(lm, RIGHT_CHEEK, w, h), r: fw * 0.16 },
      ];
    case "contour":
      return [
        { kind: "line", pts: contourSegment(lm, LEFT_CONTOUR, w, h), width: fw * 0.09 },
        { kind: "line", pts: contourSegment(lm, RIGHT_CONTOUR, w, h), width: fw * 0.09 },
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
    const pts = s.kind === "circle"
      ? [
          { x: s.center.x - s.r, y: s.center.y - s.r },
          { x: s.center.x + s.r, y: s.center.y + s.r },
        ]
      : s.pts;
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
  } else if (shape.kind === "line") {
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
  contour: { composite: "multiply", blurScale: 1.6 },
  brows: { composite: "multiply", blurScale: 0.6 },
  eyeshadow: { composite: "multiply", blurScale: 1.2, graded: true },
  eyeliner: { composite: "multiply", blurScale: 0.4 },
  blush: { composite: "multiply", blurScale: 1.0, radial: true },
  lipstick: { composite: "multiply", blurScale: 0.5, carveMouth: true },
};

// Features foundation must not wash over — tinting brows, eyes and lips
// is what makes a base layer read as an orange filter instead of skin.
const FOUNDATION_HOLES = [LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS_OUTER];

function paintLayer(ctx, lm, layer, w, h, { color, alpha, blur }) {
  const style = LAYER_STYLE[layer];
  const shapes = regionShapes(lm, layer, w, h);
  if (!style || shapes.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = style.composite;
  ctx.globalAlpha = alpha;
  ctx.filter = `blur(${blur * style.blurScale}px)`;

  if (style.skinOnly) {
    // Face oval with the features punched out (evenodd).
    ctx.fillStyle = color;
    polygon(ctx, shapes[0].pts);
    for (const hole of FOUNDATION_HOLES) {
      const pts = toPoints(lm, hole, w, h);
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }
    ctx.fill("evenodd");
  } else if (style.graded) {
    // Densest at the lash line, fading out toward the brow.
    for (const s of shapes) {
      const g = ctx.createLinearGradient(s.grad.from.x, s.grad.from.y, s.grad.to.x, s.grad.to.y);
      g.addColorStop(0, color);
      g.addColorStop(0.55, `${color}b0`);
      g.addColorStop(1, `${color}00`);
      ctx.fillStyle = g;
      traceShape(ctx, s);
      ctx.fill();
    }
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
      g.addColorStop(0, color);
      g.addColorStop(1, `${color}00`);
      ctx.fillStyle = g;
      traceShape(ctx, s);
      ctx.fill();
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
      const blur = Math.max(2, fw * 0.03);

      for (const layer of LAYER_ORDER) {
        const cfg = look.layers[layer];
        if (!cfg) continue;
        if (options.enabledLayers && !options.enabledLayers.has(layer)) continue;
        const alpha = cfg.amount * options.intensity;
        if (alpha <= 0.01) continue;
        paintLayer(ctx, landmarks, layer, w, h, { color: cfg.color, alpha, blur });
      }

      // Restore untinted eyes on top of shadow/liner.
      this.#restoreEyes(source, landmarks, w, h);

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
