import { test } from "node:test";
import assert from "node:assert/strict";

import { regionShapes, shapesBounds } from "../js/makeup.js";
import {
  LEFT_LASH, RIGHT_LASH, LEFT_LOWER_LASH, RIGHT_LOWER_LASH,
} from "../js/landmarks.js";
import { LOOKS, LAYER_ORDER } from "../js/looks.js";

const W = 1000, H = 800;

/**
 * A schematic face with anatomically-ordered eyes: each eye's lash lines lie
 * on the upper and lower halves of an ellipse, outer corner first. Everything
 * else sits at a neutral position. Built rather than captured so the geometry
 * is exact and no real person's face measurements are stored here.
 */
function syntheticFace() {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const eyes = [
    { lash: LEFT_LASH, lower: LEFT_LOWER_LASH, cx: 0.35, outward: -1 },
    { lash: RIGHT_LASH, lower: RIGHT_LOWER_LASH, cx: 0.65, outward: 1 },
  ];
  const cy = 0.42, rx = 0.07, ry = 0.025;
  for (const eye of eyes) {
    const n = eye.lash.length;
    for (let i = 0; i < n; i++) {
      // t: 0 at the outer corner, 1 at the inner corner.
      const t = i / (n - 1);
      const x = eye.cx + eye.outward * rx * (1 - 2 * t);
      const arc = Math.sin(Math.PI * t); // 0 at corners, 1 mid-lid
      lm[eye.lash[i]] = { x, y: cy - ry * arc };
      lm[eye.lower[i]] = { x, y: cy + ry * arc };
    }
  }
  return { lm, cy, rx, eyes };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test("lower lash line sits below the upper lash line", () => {
  const { lm } = syntheticFace();
  const upper = regionShapes(lm, "eyeliner", W, H);
  const lower = regionShapes(lm, "linerLower", W, H);
  assert.equal(upper.length, 2, "one stroke per eye");
  assert.equal(lower.length, 2, "one stroke per eye");
  for (let e = 0; e < 2; e++) {
    for (let i = 0; i < lower[e].pts.length; i++) {
      assert.ok(
        lower[e].pts[i].y >= upper[e].pts[i].y,
        `eye ${e} point ${i}: lower liner is not above the lash line`,
      );
    }
  }
});

test("lower liner covers the outer part of the eye and stops short of the inner corner", () => {
  const { lm } = syntheticFace();
  const upper = regionShapes(lm, "eyeliner", W, H);
  for (const [e, shape] of regionShapes(lm, "linerLower", W, H).entries()) {
    const full = upper[e].pts;
    const outerCorner = full[0];
    const innerCorner = full[full.length - 1];
    assert.ok(shape.pts.length >= 2, "is a drawable stroke");
    // Starts at the outer corner…
    assert.ok(dist(shape.pts[0], outerCorner) < 1, "starts at the outer corner");
    // …and ends before reaching the inner corner.
    const end = shape.pts[shape.pts.length - 1];
    assert.ok(
      dist(end, innerCorner) > dist(outerCorner, innerCorner) * 0.25,
      "stops well short of the inner corner",
    );
    assert.ok(shape.pts.length < full.length, "does not run the whole lash line");
  }
});

test("wing extends outward past the outer corner, away from the eye", () => {
  const { lm } = syntheticFace();
  const upper = regionShapes(lm, "eyeliner", W, H);
  for (const [e, wing] of regionShapes(lm, "linerWing", W, H).entries()) {
    const lash = upper[e].pts;
    const outerCorner = lash[0];
    const innerCorner = lash[lash.length - 1];
    const [base, tip] = wing.pts;
    assert.ok(dist(base, outerCorner) < 1, "starts at the outer corner");
    // The tip must be further from the inner corner than the corner itself:
    // a wing pointing back into the eye is the failure this guards against.
    assert.ok(
      dist(tip, innerCorner) > dist(outerCorner, innerCorner),
      `eye ${e}: wing points inward instead of out`,
    );
    // Sane length: a tail, not a stripe across the temple.
    const eyeWidth = dist(outerCorner, innerCorner);
    const len = dist(base, tip);
    assert.ok(len > eyeWidth * 0.15, `wing too short (${len} vs eye ${eyeWidth})`);
    assert.ok(len < eyeWidth * 0.6, `wing too long (${len} vs eye ${eyeWidth})`);
    // Near level. Deliberately not asserting an upward flick: the soft
    // Korean tail this supports runs level or a touch down. What matters is
    // that it neither plunges onto the cheek nor shoots up into the brow.
    assert.ok(
      Math.abs(tip.y - base.y) < len * 0.35,
      `eye ${e}: tail is too steep (rise ${tip.y - base.y} over ${len})`,
    );
  }
});

test("wings and lower liners are symmetric between the two eyes", () => {
  const { lm } = syntheticFace();
  const [lw, rw] = regionShapes(lm, "linerWing", W, H);
  const lLen = dist(lw.pts[0], lw.pts[1]);
  const rLen = dist(rw.pts[0], rw.pts[1]);
  assert.ok(Math.abs(lLen - rLen) < 0.5, `wing lengths match (${lLen} vs ${rLen})`);
  const [ll, rl] = regionShapes(lm, "linerLower", W, H);
  assert.equal(ll.pts.length, rl.pts.length, "same number of lower-liner points");
});

test("liner regions are framable, so a tutorial can zoom to them", () => {
  const { lm } = syntheticFace();
  for (const layer of ["eyeliner", "linerWing", "linerLower"]) {
    const box = shapesBounds(regionShapes(lm, layer, W, H));
    assert.ok(box && box.w > 0 && box.h >= 0, `${layer} has a bounding box`);
  }
});

test("a look teaching the wing also teaches the line it grows out of", () => {
  for (const look of LOOKS) {
    if (!look.layers.linerWing) continue;
    assert.ok(look.layers.eyeliner, `${look.id}: wing without an upper line`);
    const layers = look.steps.map((s) => s.layer);
    assert.ok(
      layers.indexOf("eyeliner") < layers.indexOf("linerWing"),
      `${look.id}: teaches the wing before the line`,
    );
  }
});

test("the K-beauty preset teaches upper line, wing and lower line", () => {
  const look = LOOKS.find((l) => l.id === "puppy-liner");
  assert.ok(look, "puppy-liner look exists");
  const taught = look.steps.map((s) => s.layer);
  for (const layer of ["eyeliner", "linerWing", "linerLower"]) {
    assert.ok(taught.includes(layer), `teaches ${layer}`);
    assert.ok(look.layers[layer], `renders ${layer}`);
  }
  const order = taught.map((l) => LAYER_ORDER.indexOf(l));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "steps follow paint order");
});
