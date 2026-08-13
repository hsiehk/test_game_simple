import { test } from "node:test";
import assert from "node:assert/strict";

import {
  packSteps, encodePayload, decodePayload, buildCompanionUrl,
  parseCompanionHash, COMPANION_HASH_PREFIX,
} from "../js/companion.js";
import { LOOKS } from "../js/looks.js";

test("packSteps captures every step with its layer color", () => {
  const look = LOOKS[0];
  const packed = packSteps(look);
  assert.equal(packed.v, 1);
  assert.equal(packed.name, look.name);
  assert.equal(packed.steps.length, look.steps.length);
  for (const [i, s] of packed.steps.entries()) {
    assert.equal(s.t, look.steps[i].title);
    assert.equal(s.i, look.steps[i].instruction);
    assert.equal(s.c, look.layers[look.steps[i].layer].color);
  }
});

test("payload round-trips through encode/decode", async () => {
  const packed = packSteps(LOOKS[1]);
  const encoded = await encodePayload(packed);
  assert.match(encoded, /^[dp]\.[A-Za-z0-9_-]+$/, "URL-safe encoding with scheme prefix");
  const decoded = await decodePayload(encoded);
  assert.deepEqual(decoded, packed);
});

test("compression keeps the QR payload compact", async () => {
  const packed = packSteps(LOOKS[2]);
  const encoded = await encodePayload(packed);
  const rawLen = JSON.stringify(packed).length;
  assert.ok(encoded.length < rawLen, `encoded ${encoded.length} < raw ${rawLen}`);
  // Full URL must fit in a byte-mode QR code (2953 bytes at EC level L).
  const url = buildCompanionUrl("https://example.github.io/app/", encoded);
  assert.ok(url.length < 2900, `URL length ${url.length} fits in a QR code`);
});

test("buildCompanionUrl strips any existing hash", async () => {
  const url = buildCompanionUrl("https://x.io/app/#companion=old", "d.abc");
  assert.equal(url, `https://x.io/app/${COMPANION_HASH_PREFIX}d.abc`);
});

test("parseCompanionHash round-trips and rejects junk", async () => {
  const packed = packSteps(LOOKS[0]);
  const hash = COMPANION_HASH_PREFIX + (await encodePayload(packed));
  assert.deepEqual(await parseCompanionHash(hash), packed);
  assert.equal(await parseCompanionHash("#other"), null);
  assert.equal(await parseCompanionHash(COMPANION_HASH_PREFIX + "d.!!notbase64!!"), null);
  assert.equal(await parseCompanionHash(""), null);
  assert.equal(await parseCompanionHash(undefined), null);
});
