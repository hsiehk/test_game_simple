import { test } from "node:test";
import assert from "node:assert/strict";

import * as L from "../js/landmarks.js";
import { LOOKS, LAYER_ORDER, getLook } from "../js/looks.js";

const HEX = /^#[0-9a-f]{6}$/i;

test("all landmark indices are valid face-mesh indices", () => {
  const groups = {
    LIPS_OUTER: L.LIPS_OUTER,
    LIPS_INNER: L.LIPS_INNER,
    LEFT_EYE: L.LEFT_EYE,
    RIGHT_EYE: L.RIGHT_EYE,
    LEFT_BROW: L.LEFT_BROW,
    RIGHT_BROW: L.RIGHT_BROW,
    LEFT_LASH: L.LEFT_LASH,
    RIGHT_LASH: L.RIGHT_LASH,
    LEFT_LASH_BROW: L.LEFT_LASH_BROW,
    RIGHT_LASH_BROW: L.RIGHT_LASH_BROW,
    LEFT_CHEEK: L.LEFT_CHEEK,
    RIGHT_CHEEK: L.RIGHT_CHEEK,
    FACE_WIDTH_REF: L.FACE_WIDTH_REF,
    FACE_OVAL: L.FACE_OVAL,
  };
  for (const [name, indices] of Object.entries(groups)) {
    assert.ok(indices.length > 0, `${name} is non-empty`);
    for (const i of indices) {
      assert.ok(
        Number.isInteger(i) && i >= 0 && i <= L.MAX_LANDMARK_INDEX,
        `${name} contains valid index ${i}`,
      );
    }
  }
});

test("polygon regions have enough points to fill", () => {
  for (const poly of [L.LIPS_OUTER, L.LIPS_INNER, L.LEFT_EYE, L.RIGHT_EYE, L.LEFT_BROW, L.RIGHT_BROW, L.FACE_OVAL]) {
    assert.ok(poly.length >= 3);
  }
});

test("lash/brow pairs are aligned for eyeshadow bands", () => {
  assert.equal(L.LEFT_LASH.length, L.LEFT_LASH_BROW.length);
  assert.equal(L.RIGHT_LASH.length, L.RIGHT_LASH_BROW.length);
});

test("every look is complete and well-formed", () => {
  assert.ok(LOOKS.length >= 3, "has at least 3 looks");
  const ids = new Set();
  for (const look of LOOKS) {
    assert.ok(look.id && !ids.has(look.id), `unique id: ${look.id}`);
    ids.add(look.id);
    assert.ok(look.name.length > 0);
    assert.ok(look.description.length > 20, `${look.id} has a real description`);

    for (const [layer, cfg] of Object.entries(look.layers)) {
      assert.ok(LAYER_ORDER.includes(layer), `${look.id}: known layer ${layer}`);
      assert.match(cfg.color, HEX, `${look.id}.${layer} color is 6-digit hex`);
      assert.ok(cfg.amount > 0 && cfg.amount <= 1, `${look.id}.${layer} amount in (0,1]`);
    }
  }
});

test("every tutorial step references a layer the look defines", () => {
  for (const look of LOOKS) {
    assert.ok(look.steps.length >= 3, `${look.id} has at least 3 steps`);
    for (const step of look.steps) {
      assert.ok(
        look.layers[step.layer],
        `${look.id} step "${step.title}" uses defined layer ${step.layer}`,
      );
      assert.ok(step.title.length > 0);
      assert.ok(step.instruction.length > 40, `${look.id}/"${step.title}" instruction is substantive`);
      assert.ok(step.tip.length > 10, `${look.id}/"${step.title}" has a tip`);
    }
  }
});

test("getLook falls back to the first look for unknown ids", () => {
  assert.equal(getLook("nope"), LOOKS[0]);
  assert.equal(getLook("smokey").id, "smokey");
});
