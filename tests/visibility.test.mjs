import { test } from "node:test";
import assert from "node:assert/strict";

import { regionShapes, sideExposure, zoomTargetFor } from "../js/makeup.js";
import {
  LEFT_LASH, RIGHT_LASH, LEFT_LOWER_LASH, RIGHT_LOWER_LASH,
  LEFT_BROW, RIGHT_BROW, LEFT_IRIS, RIGHT_IRIS,
} from "../js/landmarks.js";
import { BLUSH_STYLES } from "../js/looks.js";

const W = 1000, H = 800;

/**
 * Schematic face with both sides placed independently, so one of them can
 * be pushed out of the frame or squeezed the way head yaw squeezes it.
 * `shift` slides the whole face; `squeeze` narrows one eye about its own
 * centre, which is what a turned head does to the far eye.
 */
function face({ shift = 0, squeeze = { left: 1, right: 1 } } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5 + shift, y: 0.5 }));
  const eyes = [
    { key: "left", lash: LEFT_LASH, lower: LEFT_LOWER_LASH, brow: LEFT_BROW,
      iris: LEFT_IRIS, cx: 0.35, cheek: [205, 50], temple: 234, out: -1 },
    { key: "right", lash: RIGHT_LASH, lower: RIGHT_LOWER_LASH, brow: RIGHT_BROW,
      iris: RIGHT_IRIS, cx: 0.65, cheek: [425, 280], temple: 454, out: 1 },
  ];
  const cy = 0.42, rx = 0.07, ry = 0.025;
  for (const e of eyes) {
    const k = squeeze[e.key];
    const cx = e.cx + shift;
    for (let i = 0; i < e.lash.length; i++) {
      const t = i / (e.lash.length - 1);
      const x = cx + e.out * rx * k * (1 - 2 * t);
      const arc = Math.sin(Math.PI * t);
      lm[e.lash[i]] = { x, y: cy - ry * arc };
      lm[e.lower[i]] = { x, y: cy + ry * arc };
    }
    for (let i = 0; i < e.brow.length; i++) {
      const t = i / (e.brow.length - 1);
      // The mesh brow loop runs outer-to-inner along the top edge and back
      // along the bottom, matching the lash line's own outer-first order.
      const half = t < 0.5 ? t * 2 : (1 - t) * 2;
      lm[e.brow[i]] = {
        x: cx + e.out * rx * k * (1 - 2 * half),
        y: cy - 0.07 - (t < 0.5 ? 0.012 : 0),
      };
    }
    const ir = rx * k * 0.45;
    lm[e.iris[0]] = { x: cx, y: cy };
    for (let i = 1; i <= 4; i++) {
      const a = ((i - 1) / 4) * Math.PI * 2;
      lm[e.iris[i]] = { x: cx + Math.cos(a) * ir, y: cy + Math.sin(a) * ir };
    }
    lm[e.cheek[0]] = { x: cx + e.out * 0.01, y: 0.6 };
    lm[e.cheek[1]] = { x: cx + e.out * 0.05, y: 0.56 };
    lm[e.temple] = { x: cx + e.out * 0.15, y: 0.5 };
  }
  lm[6] = { x: 0.5 + shift, y: 0.45 };
  lm[4] = { x: 0.5 + shift, y: 0.6 };
  lm[61] = { x: 0.43 + shift, y: 0.75 };
  lm[291] = { x: 0.57 + shift, y: 0.75 };
  return lm;
}

const PAIRED = [
  "brows", "eyeshadow", "eyeliner", "linerWing", "linerLower", "aegyoSal",
  "underEyeShade", "lashes", "lowerLid", "outerCorner", "innerCorner",
  "lowerLashes", "lenses", "contour", "blush",
];

function inside(poly, p) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Distance from a point to a polygon's boundary. */
function toEdge(poly, p) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

function span(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys));
}

function perimeter(pts) {
  let d = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    d += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return d;
}

function hull(pts) {
  const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const chain = (src) => {
    const out = [];
    for (const p of src) {
      while (out.length >= 2
        && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return chain(sorted).concat(chain(sorted.slice().reverse()));
}

// ---------- what the camera can see ----------

test("a face square to the camera exposes both sides", () => {
  const seen = sideExposure(face(), W, H);
  assert.equal(seen.left, 1);
  assert.equal(seen.right, 1);
});

test("a side carried out of the frame stops being exposed", () => {
  // Far enough left that the left eye, brow and temple leave the picture.
  const seen = sideExposure(face({ shift: -0.34 }), W, H);
  assert.ok(seen.left < 0.5, `left side is mostly gone (${seen.left})`);
  assert.equal(seen.right, 1, "the side still in shot is untouched");
});

test("a turned head stops exposing the eye it turns away", () => {
  // The far eye at a third of its partner's width: a third of the way to
  // profile, and well under the threshold the renderer draws a guide at.
  const seen = sideExposure(face({ squeeze: { left: 0.33, right: 1 } }), W, H);
  assert.ok(seen.left < 0.2, `far side is not worth tracing (${seen.left})`);
  assert.equal(seen.right, 1, "the near side reads normally");
  // Further round still, and it bottoms out rather than going negative.
  assert.equal(sideExposure(face({ squeeze: { left: 0.15, right: 1 } }), W, H).left, 0);
});

test("ordinary asymmetry between two eyes is not mistaken for yaw", () => {
  const seen = sideExposure(face({ squeeze: { left: 0.92, right: 1 } }), W, H);
  assert.equal(seen.left, 1, "a naturally smaller eye still gets its guide");
  assert.equal(seen.right, 1);
});

test("every paired region says which side it belongs to", () => {
  const lm = face();
  for (const layer of PAIRED) {
    const shapes = regionShapes(lm, layer, W, H, BLUSH_STYLES[0].id);
    const sides = new Set(shapes.map((s) => s.side));
    assert.ok(sides.has("left"), `${layer} has a left half`);
    assert.ok(sides.has("right"), `${layer} has a right half`);
  }
  // Regions that are not two-sided must not claim a side, or half a mouth
  // would disappear with a turned head.
  for (const layer of ["foundation", "lipstick"]) {
    for (const s of regionShapes(lm, layer, W, H)) {
      assert.equal(s.side, undefined, `${layer} is not one-sided`);
    }
  }
});

test("a blush that crosses the nose keeps its nose half unsided", () => {
  const shapes = regionShapes(face(), "blush", W, H, "sunkissed");
  const centre = shapes.filter((s) => !s.side);
  assert.equal(centre.length, 1, "the bridge deposit belongs to neither cheek");
});

test("the step zoom frames the eye that is in shot, not the one that is not", () => {
  const lm = face({ squeeze: { left: 0.33, right: 1 } });
  const both = zoomTargetFor(lm, "eyeliner", W, H);
  const one = zoomTargetFor(lm, "eyeliner", W, H, { sides: { left: false, right: true } });
  const right = regionShapes(lm, "eyeliner", W, H).find((s) => s.side === "right");
  const rx = right.pts.reduce((a, p) => a + p.x, 0) / right.pts.length;
  assert.ok(Math.abs(one.cx - rx) < Math.abs(both.cx - rx),
    "the framing moves onto the visible eye");
  assert.ok(one.scale > both.scale, "and closes in, having less to cover");
});

test("with neither side visible the zoom still has something to frame", () => {
  const lm = face();
  const none = zoomTargetFor(lm, "eyeliner", W, H, { sides: { left: false, right: false } });
  assert.ok(none && Number.isFinite(none.cx), "falls back rather than returning nothing");
});

// ---------- traces that outline the deposit, not the brush marks ----------

test("every closed brush traces a boundary around its own dabs", () => {
  const lm = face();
  const layers = ["outerCorner", "innerCorner", "blush", "brows", "eyeshadow",
    "lowerLid", "aegyoSal"];
  for (const layer of layers) {
    for (const s of regionShapes(lm, layer, W, H, BLUSH_STYLES[0].id)) {
      if (!s.closed) continue;
      // Several layers lay their outermost dabs along the outline itself,
      // so being on the line counts as being in the shape.
      const tol = Math.max(2, span(s.pts) * 0.02);
      for (const d of s.dabs) {
        // Only the marks that actually read. A wash like eyeshadow lays a
        // few near-transparent dabs past the edge of its own outline on
        // purpose, so the colour has nowhere it visibly stops.
        if (d.weight < 0.2) continue;
        assert.ok(inside(s.pts, d.p) || toEdge(s.pts, d.p) <= tol,
          `${layer}: a brush mark at ${Math.round(d.p.x)},${Math.round(d.p.y)} sits outside its own outline`);
      }
    }
  }
});

test("closed traces are outlines, not tours of the brush marks", () => {
  // Joining scattered dab centres draws a zigzag through the cluster: its
  // perimeter runs several times the length of the boundary around it.
  const lm = face();
  for (const layer of ["outerCorner", "innerCorner", "blush"]) {
    for (const style of BLUSH_STYLES) {
      for (const s of regionShapes(lm, layer, W, H, style.id)) {
        if (!s.closed) continue;
        const ratio = perimeter(s.pts) / perimeter(hull(s.pts));
        assert.ok(ratio < 1.5,
          `${layer}/${style.id}: outline is ${ratio.toFixed(1)}x its own hull`);
      }
    }
  }
});

test("outer-corner depth wraps the corner across both lash lines", () => {
  const lm = face();
  for (const s of regionShapes(lm, "outerCorner", W, H)) {
    const lash = regionShapes(lm, "eyeliner", W, H).find((e) => e.side === s.side);
    const corner = lash.pts[0];
    const ys = s.pts.map((p) => p.y);
    assert.ok(Math.min(...ys) < corner.y, "it reaches above the lash line");
    assert.ok(Math.max(...ys) > corner.y, "and below the lower lash line");
    // It is depth at the corner, not a wash over the whole lid.
    const eyeW = Math.hypot(lash.pts[0].x - lash.pts[lash.pts.length - 1].x,
      lash.pts[0].y - lash.pts[lash.pts.length - 1].y);
    const xs = s.pts.map((p) => p.x);
    assert.ok(Math.max(...xs) - Math.min(...xs) < eyeW * 0.75,
      "and stays out at the corner");
  }
});
