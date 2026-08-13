import { test } from "node:test";
import assert from "node:assert/strict";

import { rgbToHex, tintFromAverages, amountFromTint, PHOTO_STEPS } from "../js/photolook.js";
import { LAYER_ORDER } from "../js/looks.js";

test("rgbToHex clamps and formats", () => {
  assert.equal(rgbToHex({ r: 255, g: 0, b: 128 }), "#ff0080");
  assert.equal(rgbToHex({ r: 300, g: -5, b: 15.6 }), "#ff0010");
});

test("region matching skin tone yields a white (no-op) tint", () => {
  const skin = { r: 200, g: 160, b: 140 };
  const tint = tintFromAverages(skin, skin);
  assert.deepEqual(tint, { r: 255, g: 255, b: 255 });
});

test("darker/redder region yields a darkening tint", () => {
  const skin = { r: 200, g: 160, b: 140 };
  const lips = { r: 180, g: 80, b: 80 };
  const tint = tintFromAverages(lips, skin);
  assert.ok(tint.r < 255 && tint.g < 255 && tint.b < 255);
  // Red channel is proportionally strongest, as expected for a red lip.
  assert.ok(tint.r > tint.g && tint.r > tint.b);
});

test("tint channels are clamped to 255 even for brighter regions", () => {
  const tint = tintFromAverages({ r: 250, g: 250, b: 250 }, { r: 100, g: 100, b: 100 });
  assert.deepEqual(tint, { r: 255, g: 255, b: 255 });
});

test("amountFromTint scales with tint strength within bounds", () => {
  const weak = amountFromTint({ r: 255, g: 255, b: 255 }, { floor: 0.1, cap: 0.8 });
  const strong = amountFromTint({ r: 120, g: 40, b: 60 }, { floor: 0.1, cap: 0.8 });
  assert.equal(weak, 0.1);
  assert.equal(strong, 0.8);
  const mid = amountFromTint({ r: 255, g: 200, b: 200 }, { floor: 0.1, cap: 0.8 });
  assert.ok(mid > 0.1 && mid < 0.8, `mid amount ${mid} is between bounds`);
});

test("photo tutorial steps are complete and reference known layers", () => {
  assert.ok(PHOTO_STEPS.length >= 5);
  const seen = new Set();
  for (const step of PHOTO_STEPS) {
    assert.ok(LAYER_ORDER.includes(step.layer), `known layer ${step.layer}`);
    assert.ok(!seen.has(step.layer), `no duplicate step for ${step.layer}`);
    seen.add(step.layer);
    assert.ok(step.title.length > 0);
    assert.ok(step.instruction.length > 40, `"${step.title}" instruction is substantive`);
    assert.ok(step.tip.length > 10, `"${step.title}" has a tip`);
  }
  // Steps follow the paint order so the look builds up correctly.
  const order = PHOTO_STEPS.map((s) => LAYER_ORDER.indexOf(s.layer));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "steps follow LAYER_ORDER");
});
