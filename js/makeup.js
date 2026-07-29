// Canvas renderer: paints makeup layers onto a frame using face landmarks.
// Landmarks arrive normalized (0..1); all drawing happens in canvas pixels.

import {
  LIPS_OUTER, LIPS_INNER, LEFT_EYE, RIGHT_EYE,
  LEFT_BROW, RIGHT_BROW, LEFT_LASH, RIGHT_LASH,
  LEFT_LASH_BROW, RIGHT_LASH_BROW,
  LEFT_CHEEK, RIGHT_CHEEK, FACE_WIDTH_REF, FACE_OVAL,
} from "./landmarks.js";
import { LAYER_ORDER } from "./looks.js";

function px(landmarks, index, w, h) {
  const p = landmarks[index];
  return { x: p.x * w, y: p.y * h };
}

function polygon(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function faceWidth(landmarks, w, h) {
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
  const upper = lash
    .map((p, i) => ({
      x: p.x + (brow[i].x - p.x) * reach,
      y: p.y + (brow[i].y - p.y) * reach,
    }))
    .reverse();
  return lash.concat(upper);
}

function cheekCenter(landmarks, pair, w, h) {
  const a = px(landmarks, pair[0], w, h);
  const b = px(landmarks, pair[1], w, h);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const painters = {
  foundation(ctx, lm, w, h, { color, alpha, blur }) {
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = alpha;
    ctx.filter = `blur(${blur * 1.5}px)`;
    ctx.fillStyle = color;
    polygon(ctx, toPoints(lm, FACE_OVAL, w, h));
    ctx.fill();
    ctx.restore();
  },

  brows(ctx, lm, w, h, { color, alpha, blur }) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = alpha;
    ctx.filter = `blur(${blur * 0.6}px)`;
    ctx.fillStyle = color;
    for (const brow of [LEFT_BROW, RIGHT_BROW]) {
      polygon(ctx, toPoints(lm, brow, w, h));
      ctx.fill();
    }
    ctx.restore();
  },

  eyeshadow(ctx, lm, w, h, { color, alpha, blur }) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = alpha;
    ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = color;
    polygon(ctx, shadowBand(lm, LEFT_LASH, LEFT_LASH_BROW, w, h, 0.55));
    ctx.fill();
    polygon(ctx, shadowBand(lm, RIGHT_LASH, RIGHT_LASH_BROW, w, h, 0.55));
    ctx.fill();
    // Never tint the eyeball itself: repaint eye openings from source pixels
    // is handled by caller clearing with the eye polygons.
    ctx.restore();
  },

  eyeliner(ctx, lm, w, h, { color, alpha, blur }, fw) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = alpha;
    ctx.filter = `blur(${blur * 0.4}px)`;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, fw * 0.012);
    for (const lash of [LEFT_LASH, RIGHT_LASH]) {
      const pts = toPoints(lm, lash, w, h);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.restore();
  },

  blush(ctx, lm, w, h, { color, alpha, blur }, fw) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const r = fw * 0.16;
    for (const pair of [LEFT_CHEEK, RIGHT_CHEEK]) {
      const c = cheekCenter(lm, pair, w, h);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, `${color}00`);
      ctx.globalAlpha = alpha;
      ctx.filter = `blur(${blur}px)`;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  lipstick(ctx, lm, w, h, { color, alpha, blur }) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = alpha;
    ctx.filter = `blur(${blur * 0.5}px)`;
    ctx.fillStyle = color;
    const outer = toPoints(lm, LIPS_OUTER, w, h);
    const inner = toPoints(lm, LIPS_INNER, w, h);
    polygon(ctx, outer);
    // Carve out the mouth opening with the inner lip loop (evenodd).
    ctx.moveTo(inner[0].x, inner[0].y);
    for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.restore();
  },
};

// Region outlines used by tutorial mode to show "apply it here".
const highlightRegions = {
  foundation: (lm, w, h) => [toPoints(lm, FACE_OVAL, w, h)],
  brows: (lm, w, h) => [toPoints(lm, LEFT_BROW, w, h), toPoints(lm, RIGHT_BROW, w, h)],
  eyeshadow: (lm, w, h) => [
    shadowBand(lm, LEFT_LASH, LEFT_LASH_BROW, w, h, 0.55),
    shadowBand(lm, RIGHT_LASH, RIGHT_LASH_BROW, w, h, 0.55),
  ],
  eyeliner: (lm, w, h) => [toPoints(lm, LEFT_LASH, w, h), toPoints(lm, RIGHT_LASH, w, h)],
  blush: null, // circles, handled specially
  lipstick: (lm, w, h) => [toPoints(lm, LIPS_OUTER, w, h)],
};

export class MakeupRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  /**
   * Draw one frame.
   * @param source     video element (or image) already sized to canvas
   * @param landmarks  normalized face landmarks, or null when no face
   * @param look       look object from looks.js
   * @param options    { intensity 0..1, enabledLayers: Set|null, showAll: bool,
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
        painters[layer](ctx, landmarks, w, h, { color: cfg.color, alpha, blur }, fw);
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

    if (layer === "blush") {
      const r = fw * 0.16;
      for (const pair of [LEFT_CHEEK, RIGHT_CHEEK]) {
        const c = cheekCenter(lm, pair, w, h);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (layer === "eyeliner") {
      for (const path of highlightRegions.eyeliner(lm, w, h)) {
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
    } else {
      const regions = highlightRegions[layer]?.(lm, w, h) ?? [];
      for (const pts of regions) {
        polygon(ctx, pts);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
