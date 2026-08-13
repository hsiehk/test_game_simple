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
        { kind: "poly", pts: shadowBand(lm, LEFT_LASH, LEFT_LASH_BROW, w, h, 0.55) },
        { kind: "poly", pts: shadowBand(lm, RIGHT_LASH, RIGHT_LASH_BROW, w, h, 0.55) },
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
  foundation: { composite: "soft-light", blurScale: 1.5 },
  contour: { composite: "multiply", blurScale: 1.6 },
  brows: { composite: "multiply", blurScale: 0.6 },
  eyeshadow: { composite: "multiply", blurScale: 1.0 },
  eyeliner: { composite: "multiply", blurScale: 0.4 },
  blush: { composite: "multiply", blurScale: 1.0, radial: true },
  lipstick: { composite: "multiply", blurScale: 0.5, carveMouth: true },
};

function paintLayer(ctx, lm, layer, w, h, { color, alpha, blur }) {
  const style = LAYER_STYLE[layer];
  const shapes = regionShapes(lm, layer, w, h);
  if (!style || shapes.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = style.composite;
  ctx.globalAlpha = alpha;
  ctx.filter = `blur(${blur * style.blurScale}px)`;

  if (style.carveMouth) {
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

    ctx.save();
    // Mirror for selfie view.
    ctx.setTransform(-1, 0, 0, 1, w, 0);
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

      if (options.highlightLayer) {
        this.#drawHighlight(landmarks, options.highlightLayer, w, h, fw, options.time ?? 0);
      }
    }

    ctx.restore();
  }

  #restoreEyes(source, lm, w, h) {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    for (const eye of [LEFT_EYE, RIGHT_EYE]) {
      polygon(ctx, toPoints(lm, eye, w, h));
      ctx.clip();
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
      ctx.save();
      ctx.setTransform(-1, 0, 0, 1, w, 0);
    }
    ctx.restore();
  }

  #drawHighlight(lm, layer, w, h, fw, time) {
    const { ctx } = this;
    const pulse = 0.55 + 0.45 * Math.sin(time / 300);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.9 * pulse;
    ctx.filter = "none";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, fw * 0.008);
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -(time / 40) % 14;
    ctx.shadowColor = "rgba(255,80,140,0.9)";
    ctx.shadowBlur = 8;

    for (const s of regionShapes(lm, layer, w, h)) {
      traceShape(ctx, s);
      ctx.stroke();
    }
    ctx.restore();
  }
}
