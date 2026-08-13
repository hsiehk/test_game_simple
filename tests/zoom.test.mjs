import { test } from "node:test";
import assert from "node:assert/strict";

import { shapesBounds, zoomTargetFor, regionShapes } from "../js/makeup.js";
import { LOOKS, LAYER_ORDER } from "../js/looks.js";

// A synthetic front-facing face: landmark i placed on a small grid so the
// region helpers have plausible, distinct geometry to work with.
function fakeLandmarks() {
  const lm = [];
  for (let i = 0; i <= 477; i++) {
    lm.push({ x: 0.3 + ((i * 37) % 100) / 250, y: 0.25 + ((i * 53) % 100) / 250 });
  }
  return lm;
}

test("shapesBounds covers polygons, lines and circles", () => {
  const box = shapesBounds([
    { kind: "poly", pts: [{ x: 10, y: 10 }, { x: 30, y: 20 }] },
    { kind: "circle", center: { x: 60, y: 50 }, r: 15 },
  ]);
  assert.deepEqual(box, { x: 10, y: 10, w: 65, h: 55 });
});

test("shapesBounds returns null for no shapes", () => {
  assert.equal(shapesBounds([]), null);
});

test("zoom target centers on the region and magnifies it", () => {
  const lm = fakeLandmarks();
  const W = 960, H = 720;
  const target = zoomTargetFor(lm, "lipstick", W, H);
  assert.ok(target, "produces a target");
  const box = shapesBounds(regionShapes(lm, "lipstick", W, H));
  assert.ok(Math.abs(target.cx - (box.x + box.w / 2)) < 0.001, "centers horizontally");
  assert.ok(Math.abs(target.cy - (box.y + box.h / 2)) < 0.001, "centers vertically");
  assert.ok(target.scale >= 1, "never zooms out past the full frame");
});

test("zoom scale is clamped so tiny regions stay workable", () => {
  const lm = fakeLandmarks();
  const target = zoomTargetFor(lm, "eyeliner", 960, 720, { maxScale: 2.5 });
  assert.ok(target.scale <= 2.5, `scale ${target.scale} respects maxScale`);
});

test("every layer a look can teach has a zoom target", () => {
  const lm = fakeLandmarks();
  for (const look of LOOKS) {
    for (const step of look.steps) {
      const target = zoomTargetFor(lm, step.layer, 960, 720);
      assert.ok(target, `${look.id}/${step.layer} is framable`);
      assert.ok(Number.isFinite(target.cx) && Number.isFinite(target.cy));
      assert.ok(Number.isFinite(target.scale) && target.scale > 0);
    }
  }
});

test("unknown layers produce no zoom target rather than throwing", () => {
  assert.equal(zoomTargetFor(fakeLandmarks(), "nonsense", 960, 720), null);
});

test("every look's steps follow the paint order so the look builds up", () => {
  for (const look of LOOKS) {
    const order = look.steps.map((s) => LAYER_ORDER.indexOf(s.layer));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${look.id} steps in paint order`);
  }
});
