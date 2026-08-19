import { test } from "node:test";
import assert from "node:assert/strict";

import { lashDrama, irisRatio, lensAdvice } from "../js/photolook.js";
import { regionShapes, shapesBounds } from "../js/makeup.js";
import {
  LEFT_IRIS, RIGHT_IRIS, LEFT_LASH, RIGHT_LASH,
  LEFT_LOWER_LASH, RIGHT_LOWER_LASH,
} from "../js/landmarks.js";
import { LOOKS, LAYER_ORDER } from "../js/looks.js";

/** Schematic face with eyes on ellipses and an iris of a chosen size. */
function syntheticFace({ irisFrac = 0.35 } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const eyes = [
    { lash: LEFT_LASH, lower: LEFT_LOWER_LASH, iris: LEFT_IRIS, cx: 0.35, outward: -1 },
    { lash: RIGHT_LASH, lower: RIGHT_LOWER_LASH, iris: RIGHT_IRIS, cx: 0.65, outward: 1 },
  ];
  const cy = 0.42, rx = 0.07, ry = 0.025;
  for (const eye of eyes) {
    const n = eye.lash.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = eye.cx + eye.outward * rx * (1 - 2 * t);
      const arc = Math.sin(Math.PI * t);
      lm[eye.lash[i]] = { x, y: cy - ry * arc };
      lm[eye.lower[i]] = { x, y: cy + ry * arc };
    }
    // Iris: centre plus four rim points, radius as a fraction of eye width.
    const r = (rx * 2) * irisFrac / 2;
    lm[eye.iris[0]] = { x: eye.cx, y: cy };
    lm[eye.iris[1]] = { x: eye.cx + r, y: cy };
    lm[eye.iris[2]] = { x: eye.cx, y: cy - r };
    lm[eye.iris[3]] = { x: eye.cx - r, y: cy };
    lm[eye.iris[4]] = { x: eye.cx, y: cy + r };
  }
  return lm;
}

test("lash drama rises with how much darker the lash band is than skin", () => {
  const skin = { r: 226, g: 190, b: 170 };
  assert.equal(lashDrama(skin, skin), 0, "bare lashes score nothing");
  assert.equal(lashDrama(null, skin), 0, "missing sample scores nothing");
  // Calibrated above the natural lash line, which is already much darker
  // than skin: a bare lash line must not read as falsies. These samples sit
  // at the luminance ratios measured on a real face — 0.69 bare against
  // 0.89 with a heavy line painted on. The gap is narrow, which is why the
  // advice this feeds hedges rather than asserting falsies.
  const bare = lashDrama({ r: 72, g: 58, b: 54 }, skin);
  const heavy = lashDrama({ r: 20, g: 17, b: 18 }, skin);
  assert.ok(bare < 0.25, `bare lashes stay quiet (${bare})`);
  assert.ok(heavy > 0.8, `painted lashes read as dramatic (${heavy})`);
  assert.ok(heavy > bare);
});

test("iris ratio measures iris width against eye width", () => {
  const small = irisRatio(syntheticFace({ irisFrac: 0.3 }), LEFT_IRIS, LEFT_LASH);
  const big = irisRatio(syntheticFace({ irisFrac: 0.5 }), LEFT_IRIS, LEFT_LASH);
  assert.ok(Math.abs(small - 0.3) < 0.02, `~0.3, got ${small}`);
  assert.ok(Math.abs(big - 0.5) < 0.02, `~0.5, got ${big}`);
  assert.ok(big > small);
});

test("lens advice stays quiet when the reference eyes match the wearer's", () => {
  const mine = { color: { r: 70, g: 50, b: 40 }, ratio: 0.34 };
  const ref = { color: { r: 74, g: 54, b: 44 }, ratio: 0.35 };
  assert.equal(lensAdvice(ref, mine), null);
  assert.equal(lensAdvice(null, mine), null);
});

test("lens advice flags an enlarged iris", () => {
  const mine = { color: { r: 70, g: 50, b: 40 }, ratio: 0.32 };
  const ref = { color: { r: 72, g: 52, b: 42 }, ratio: 0.46 };
  const out = lensAdvice(ref, mine);
  assert.ok(out, "produces advice");
  assert.equal(out.enlarged, true);
  assert.equal(out.recoloured, false, "same colour is not a colour claim");
});

test("lens advice flags a recoloured iris and reports the shade", () => {
  const mine = { color: { r: 60, g: 44, b: 36 }, ratio: 0.34 };
  const ref = { color: { r: 150, g: 165, b: 175 }, ratio: 0.35 };
  const out = lensAdvice(ref, mine);
  assert.ok(out?.recoloured, "grey against dark brown is a colour change");
  assert.deepEqual(out.color, ref.color, "hands back the measured shade");
});

test("lens advice works before the camera has seen the wearer", () => {
  const pale = lensAdvice({ color: { r: 155, g: 170, b: 180 }, ratio: 0.35 }, null);
  assert.ok(pale?.recoloured, "a strikingly light iris is worth mentioning");
  const dark = lensAdvice({ color: { r: 58, g: 42, b: 34 }, ratio: 0.35 }, null);
  assert.equal(dark, null, "a dark iris alone is not evidence of lenses");
});

test("under-eye regions sit below the lower lash line, not on it", () => {
  const lm = syntheticFace();
  const W = 1000, H = 800;
  const lower = shapesBounds(regionShapes(lm, "linerLower", W, H));
  for (const layer of ["aegyoSal", "underEyeShade"]) {
    const box = shapesBounds(regionShapes(lm, layer, W, H));
    assert.ok(box, `${layer} has geometry`);
    assert.ok(
      box.y + box.h > lower.y + lower.h,
      `${layer} extends below the lower lash line`,
    );
  }
  // The shade must sit below the highlight it defines. Compare centres:
  // both curves converge on the lash line at the eye corners, so their
  // bounding-box tops coincide.
  const sal = shapesBounds(regionShapes(lm, "aegyoSal", W, H));
  const shade = shapesBounds(regionShapes(lm, "underEyeShade", W, H));
  assert.ok(
    shade.y + shade.h / 2 > sal.y + sal.h / 2,
    "shading sits under the highlight",
  );
});

test("lashes fan upward and outward from the lash line", () => {
  const lm = syntheticFace();
  const W = 1000, H = 800;
  const strokes = regionShapes(lm, "lashes", W, H);
  assert.ok(strokes.length >= 8, "several lashes per eye");
  for (const s of strokes) {
    const [base, tip] = s.pts;
    assert.ok(tip.y < base.y, "lashes point upward");
    assert.ok(Math.hypot(tip.x - base.x, tip.y - base.y) > 1, "have length");
  }
});

test("lenses cover the iris and nothing more", () => {
  const lm = syntheticFace({ irisFrac: 0.4 });
  const W = 1000, H = 800;
  const [left] = regionShapes(lm, "lenses", W, H);
  const eye = shapesBounds(regionShapes(lm, "eyeliner", W, H));
  assert.equal(left.kind, "circle");
  assert.ok(left.r > 0, "has a radius");
  assert.ok(left.r * 2 < eye.w, "narrower than the eye it sits in");
});

test("looks that light the aegyo-sal also shade beneath it", () => {
  for (const look of LOOKS) {
    if (!look.layers.aegyoSal) continue;
    assert.ok(look.layers.underEyeShade,
      `${look.id}: highlight without the shadow that shapes it`);
    const layers = look.steps.map((s) => s.layer);
    assert.ok(layers.indexOf("aegyoSal") < layers.indexOf("underEyeShade"),
      `${look.id}: shades before highlighting`);
  }
});

test("every new layer has a place in the paint order", () => {
  for (const layer of ["aegyoSal", "underEyeShade", "lashes", "lenses"]) {
    assert.ok(LAYER_ORDER.includes(layer), `${layer} is ordered`);
  }
  // Lashes and lenses paint over the restored eye, so they come last of the
  // eye layers.
  assert.ok(LAYER_ORDER.indexOf("lashes") > LAYER_ORDER.indexOf("eyeliner"));
  assert.ok(LAYER_ORDER.indexOf("lenses") > LAYER_ORDER.indexOf("eyeshadow"));
});
