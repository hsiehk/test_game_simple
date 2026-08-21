import { test } from "node:test";
import assert from "node:assert/strict";

import { regionShapes, shapesBounds } from "../js/makeup.js";
import {
  LEFT_LASH, RIGHT_LASH, LEFT_LOWER_LASH, RIGHT_LOWER_LASH,
  LEFT_IRIS, RIGHT_IRIS,
} from "../js/landmarks.js";
import { BLUSH_STYLES, LOOKS, LAYER_ORDER } from "../js/looks.js";
import {
  lashDrama, irisRatio, lensAdvice, highlightStrength,
} from "../js/photolook.js";

const W = 1000, H = 800;

/** Schematic face: eyes on ellipses, irises centred, cheeks and nose placed. */
function syntheticFace() {
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
    // Iris: centre plus a rim at a quarter of the eye's width.
    const ir = rx * 0.45;
    lm[eye.iris[0]] = { x: eye.cx, y: cy };
    lm[eye.iris[1]] = { x: eye.cx + ir, y: cy };
    lm[eye.iris[2]] = { x: eye.cx, y: cy - ir };
    lm[eye.iris[3]] = { x: eye.cx - ir, y: cy };
    lm[eye.iris[4]] = { x: eye.cx, y: cy + ir };
  }
  // Cheeks, temples, nose, face-width reference.
  lm[205] = { x: 0.36, y: 0.6 }; lm[50] = { x: 0.3, y: 0.56 };
  lm[425] = { x: 0.64, y: 0.6 }; lm[280] = { x: 0.7, y: 0.56 };
  lm[234] = { x: 0.2, y: 0.5 }; lm[454] = { x: 0.8, y: 0.5 };
  lm[6] = { x: 0.5, y: 0.45 }; lm[4] = { x: 0.5, y: 0.6 };
  lm[61] = { x: 0.43, y: 0.75 }; lm[291] = { x: 0.57, y: 0.75 };
  return lm;
}

function centroid(shapes) {
  const pts = shapes.flatMap((s) => (s.dabs ? s.dabs.map((d) => d.p) : s.pts));
  return {
    x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
    y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
  };
}

test("every blush placement is drawable and soft", () => {
  const lm = syntheticFace();
  for (const style of BLUSH_STYLES) {
    const shapes = regionShapes(lm, "blush", W, H, style.id);
    assert.ok(shapes.length > 0, `${style.id} produces shapes`);
    for (const s of shapes) {
      assert.equal(s.kind, "brush", `${style.id} is brush-built, not a hard disc`);
      assert.ok(s.dabs.length > 3, `${style.id} has enough dabs to blend`);
      for (const d of s.dabs) {
        assert.ok(d.radius > 0 && Number.isFinite(d.radius), `${style.id} dab radius`);
        assert.ok(d.weight >= 0 && Number.isFinite(d.weight), `${style.id} dab weight`);
      }
    }
  }
});

test("blush placements actually sit in different places", () => {
  const lm = syntheticFace();
  const centres = new Map();
  for (const style of BLUSH_STYLES) {
    centres.set(style.id, centroid(regionShapes(lm, "blush", W, H, style.id)));
  }
  // Eye-enlarging must sit higher than apples; draping wider than apples.
  assert.ok(centres.get("eyeEnlarging").y < centres.get("apples").y,
    "eye-enlarging sits above the apples");
  assert.ok(centres.get("cheekbones").y < centres.get("apples").y,
    "high cheekbones sit above the apples");
  const spread = (id) => shapesBounds(regionShapes(lm, "blush", W, H, id)).w;
  assert.ok(spread("sunkissed") > spread("apples"),
    "sunkissed spans wider than apples");

  // No two placements cover the same ground. Compared as coarse occupancy
  // rather than by centroid: every placement here is symmetric, so their
  // centroids all sit near the middle of the face however differently they
  // are laid out.
  const cells = (id) => {
    const grid = new Set();
    for (const s of regionShapes(lm, "blush", W, H, id)) {
      for (const d of s.dabs) {
        grid.add(`${Math.round(d.p.x / 25)},${Math.round(d.p.y / 25)}`);
      }
    }
    return grid;
  };
  // Shared ground over combined ground, not over the smaller of the two:
  // a compact placement legitimately sits inside a sweeping one (high
  // cheekbones within the sunkissed band), and measuring against the
  // smaller one calls that a duplicate when it is nothing of the kind.
  const ids = BLUSH_STYLES.map((b) => b.id);
  const grids = new Map(ids.map((id) => [id, cells(id)]));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = grids.get(ids[i]);
      const b = grids.get(ids[j]);
      const shared = [...a].filter((k) => b.has(k)).length;
      const combined = new Set([...a, ...b]).size;
      const overlap = shared / combined;
      assert.ok(overlap < 0.5,
        `${ids[i]} and ${ids[j]} are not near-duplicates (${Math.round(overlap * 100)}% shared)`);
    }
  }
});

test("an unknown blush placement falls back rather than vanishing", () => {
  const lm = syntheticFace();
  assert.ok(regionShapes(lm, "blush", W, H, "nonsense")[0].dabs.length > 0);
  assert.ok(regionShapes(lm, "blush", W, H)[0].dabs.length > 0);
});

test("inner corner sits at the inner corner, outer at the outer", () => {
  const lm = syntheticFace();
  const lash = regionShapes(lm, "eyeliner", W, H);
  const inner = regionShapes(lm, "innerCorner", W, H);
  const outer = regionShapes(lm, "outerCorner", W, H);
  for (let e = 0; e < 2; e++) {
    const pts = lash[e].pts;
    const outerCorner = pts[0];
    const innerCorner = pts[pts.length - 1];
    const ic = centroid([inner[e]]);
    const oc = centroid([outer[e]]);
    assert.ok(
      Math.hypot(ic.x - innerCorner.x, ic.y - innerCorner.y)
        < Math.hypot(ic.x - outerCorner.x, ic.y - outerCorner.y),
      `eye ${e}: inner-corner highlight is nearer the inner corner`,
    );
    assert.ok(
      Math.hypot(oc.x - outerCorner.x, oc.y - outerCorner.y)
        < Math.hypot(oc.x - innerCorner.x, oc.y - innerCorner.y),
      `eye ${e}: outer-corner depth is nearer the outer corner`,
    );
  }
});

test("lower-lid colour and lower lashes stay below the lash line", () => {
  const lm = syntheticFace();
  const lower = regionShapes(lm, "eyeliner", W, H).map((s) => s.pts);
  for (const [e, shape] of regionShapes(lm, "lowerLid", W, H).entries()) {
    const lashY = lower[e].reduce((a, p) => a + p.y, 0) / lower[e].length;
    assert.ok(centroid([shape]).y > lashY, `eye ${e}: lower-lid colour is below the lash line`);
  }
  const lashes = regionShapes(lm, "lowerLashes", W, H);
  assert.ok(lashes.length >= 6, "a fan of lower lashes, not one stroke");
  for (const stroke of lashes) {
    assert.ok(stroke.pts[1].y > stroke.pts[0].y, "lower lashes point downward");
  }
});

test("iris ratio measures iris width against eye width", () => {
  const lm = syntheticFace();
  // Rim placed at 0.45 of the eye's half-width, so diameter/eyeWidth = 0.45.
  const ratio = irisRatio(lm, LEFT_IRIS, LEFT_LASH);
  assert.ok(Math.abs(ratio - 0.45) < 0.02, `ratio ${ratio} matches the built geometry`);
});

test("lens advice fires on enlargement or recolouring, and stays quiet otherwise", () => {
  const mine = { color: { r: 70, g: 45, b: 30 }, ratio: 0.42 };
  assert.equal(lensAdvice(null, mine), null, "no reference, no advice");
  assert.equal(lensAdvice({ color: { r: 72, g: 47, b: 32 }, ratio: 0.43 }, mine), null,
    "same eyes, same size: nothing to say");

  const bigger = lensAdvice({ color: { r: 72, g: 47, b: 32 }, ratio: 0.52 }, mine);
  assert.ok(bigger?.enlarged && !bigger.recoloured, "flags enlargement alone");

  const other = lensAdvice({ color: { r: 150, g: 160, b: 150 }, ratio: 0.43 }, mine);
  assert.ok(other?.recoloured && !other.enlarged, "flags colour alone");

  // With no reading of the wearer's eyes, only a strikingly light iris counts.
  assert.equal(lensAdvice({ color: { r: 60, g: 40, b: 30 }, ratio: 0.5 }, null), null);
  assert.ok(lensAdvice({ color: { r: 170, g: 175, b: 165 }, ratio: 0.5 }, null));
});

test("lash drama rises with darkness and is bounded", () => {
  const skin = { r: 220, g: 190, b: 175 };
  const bare = lashDrama({ r: 95, g: 80, b: 72 }, skin);
  const heavy = lashDrama({ r: 25, g: 22, b: 20 }, skin);
  assert.ok(heavy > bare, "denser lashes score higher");
  assert.ok(bare >= 0 && heavy <= 1, "stays within range");
  assert.equal(lashDrama(null, skin), 0, "no sample, no claim");
});

test("highlight strength grows with lift above skin", () => {
  const skin = { r: 200, g: 170, b: 155 };
  const flat = highlightStrength(skin, skin, { floor: 0.1, cap: 0.6 });
  const bright = highlightStrength({ r: 255, g: 250, b: 245 }, skin, { floor: 0.1, cap: 0.6 });
  assert.equal(flat, 0.1, "no lift means the floor");
  assert.ok(bright > flat, "a brighter region is applied harder");
  assert.ok(bright <= 0.6, "respects the cap");
});

test("every layer a look paints has geometry to paint into", () => {
  const lm = syntheticFace();
  for (const look of LOOKS) {
    for (const layer of Object.keys(look.layers)) {
      assert.ok(LAYER_ORDER.includes(layer), `${look.id}: ${layer} is in the paint order`);
      const shapes = regionShapes(lm, layer, W, H, look.blushStyle);
      assert.ok(shapes.length > 0, `${look.id}: ${layer} produces geometry`);
    }
  }
});

test("looks declaring a blush placement name a real one", () => {
  const ids = new Set(BLUSH_STYLES.map((b) => b.id));
  for (const look of LOOKS) {
    if (look.blushStyle) {
      assert.ok(ids.has(look.blushStyle), `${look.id}: ${look.blushStyle} is a known placement`);
    }
  }
});
