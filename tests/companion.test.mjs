import { test } from "node:test";
import assert from "node:assert/strict";

import {
  packSteps, unpackSteps, encodePayload, decodePayload, buildCompanionUrl,
  parseCompanionHash, COMPANION_HASH_PREFIX,
} from "../js/companion.js";
import { LOOKS } from "../js/looks.js";
import { PHOTO_STEPS } from "../js/photolook.js";

test("a preset travels as its id and rebuilds in full", () => {
  const look = LOOKS[0];
  const packed = packSteps(look);
  assert.deepEqual(packed, { v: 2, look: look.id });
  const full = unpackSteps(packed);
  assert.equal(full.name, look.name);
  assert.equal(full.steps.length, look.steps.length);
  for (const [i, s] of full.steps.entries()) {
    assert.equal(s.t, look.steps[i].title);
    assert.equal(s.i, look.steps[i].instruction);
    assert.equal(s.p, look.steps[i].tip);
    assert.equal(s.c, look.layers[look.steps[i].layer].color);
  }
});

test("a photo look travels as layers and colours, and rebuilds its text", () => {
  const layers = Object.fromEntries(PHOTO_STEPS.map((s) => [s.layer, { color: "#c2213a" }]));
  const look = { id: "photo", name: "From your photo", steps: PHOTO_STEPS, layers };
  const packed = packSteps(look);
  assert.equal(packed.v, 2);
  assert.equal(packed.photo.length, PHOTO_STEPS.length);
  const full = unpackSteps(packed);
  assert.equal(full.steps.length, PHOTO_STEPS.length);
  assert.equal(full.steps[0].i, PHOTO_STEPS[0].instruction);
  assert.equal(full.steps[0].c, "#c2213a");
});

test("only the steps a photo actually produced are sent", () => {
  const look = {
    id: "photo",
    name: "From your photo",
    steps: PHOTO_STEPS.slice(0, 3),
    layers: Object.fromEntries(PHOTO_STEPS.slice(0, 3).map((s) => [s.layer, { color: "#abc123" }])),
  };
  assert.equal(unpackSteps(packSteps(look)).steps.length, 3);
});

test("links made before the payload shrank still open", () => {
  const legacy = {
    v: 1,
    name: "Old link",
    steps: [{ l: "lipstick", t: "Lips", i: "Do the lips", p: "Blot", c: "#c00" }],
  };
  assert.equal(unpackSteps(legacy), legacy);
});

test("an unknown preset id yields nothing rather than an empty tutorial", () => {
  assert.equal(unpackSteps({ v: 2, look: "no-such-look" }), null);
  assert.equal(unpackSteps({ v: 2, photo: [] }), null);
});

test("payload round-trips through encode/decode", async () => {
  const packed = packSteps(LOOKS[1]);
  const encoded = await encodePayload(packed);
  assert.match(encoded, /^[dp]\.[A-Za-z0-9_-]+$/, "URL-safe encoding with scheme prefix");
  const decoded = await decodePayload(encoded);
  assert.deepEqual(decoded, packed);
});

test("every look's QR payload stays far inside the code's capacity", async () => {
  // Byte-mode QR at EC level L tops out at 2953 bytes. Inlining the prose
  // put a photo tutorial at 2907 — one step from failing to encode.
  const LIMIT = 2953;
  for (const look of LOOKS) {
    const url = buildCompanionUrl("https://example.github.io/app/",
      await encodePayload(packSteps(look)));
    assert.ok(url.length < LIMIT / 4,
      `${look.id}: ${url.length} bytes leaves room to spare`);
  }
  const layers = Object.fromEntries(PHOTO_STEPS.map((s) => [s.layer, { color: "#c2213a" }]));
  const url = buildCompanionUrl("https://example.github.io/app/",
    await encodePayload(packSteps({
      id: "photo", name: "From your photo", steps: PHOTO_STEPS, layers,
    })));
  assert.ok(url.length < LIMIT / 4,
    `the longest tutorial is ${url.length} bytes, well inside ${LIMIT}`);
});

test("buildCompanionUrl strips any existing hash", async () => {
  const url = buildCompanionUrl("https://x.io/app/#companion=old", "d.abc");
  assert.equal(url, `https://x.io/app/${COMPANION_HASH_PREFIX}d.abc`);
});

test("parseCompanionHash round-trips and rejects junk", async () => {
  const look = LOOKS[0];
  const hash = COMPANION_HASH_PREFIX + (await encodePayload(packSteps(look)));
  const parsed = await parseCompanionHash(hash);
  assert.equal(parsed.name, look.name);
  assert.equal(parsed.steps.length, look.steps.length);
  assert.equal(await parseCompanionHash("#other"), null);
  assert.equal(await parseCompanionHash(COMPANION_HASH_PREFIX + "d.!!notbase64!!"), null);
  assert.equal(await parseCompanionHash(""), null);
  assert.equal(await parseCompanionHash(undefined), null);
});
