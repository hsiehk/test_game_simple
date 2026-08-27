import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcilePair, browThickness } from "../js/photolook.js";

const size = (m) => m.v;

test("a side that could not be read borrows the other", () => {
  assert.deepEqual(reconcilePair([null, { v: 3 }], size, 2), [{ v: 3 }, { v: 3 }]);
  assert.deepEqual(reconcilePair([{ v: 3 }, null], size, 2), [{ v: 3 }, { v: 3 }]);
});

test("neither side readable stays unreadable rather than inventing one", () => {
  assert.deepEqual(reconcilePair([null, null], size, 2), [null, null]);
});

test("two plausible sides are both kept, asymmetry and all", () => {
  // Real faces are not perfectly symmetric, and makeup less so. Only a
  // difference beyond the ratio is treated as a fault.
  const pair = [{ v: 10 }, { v: 14 }];
  assert.deepEqual(reconcilePair(pair, size, 2), pair);
});

test("a side suspiciously larger than its partner is disbelieved", () => {
  // Contamination adds — hair touching a brow, a dark strand beside a wing —
  // so the inflated side is the wrong one, not the modest one.
  assert.deepEqual(reconcilePair([{ v: 30 }, { v: 10 }], size, 2), [{ v: 10 }, { v: 10 }]);
  assert.deepEqual(reconcilePair([{ v: 10 }, { v: 30 }], size, 2), [{ v: 10 }, { v: 10 }]);
});

test("the ratio is exclusive, so exactly at the limit both are kept", () => {
  const pair = [{ v: 20 }, { v: 10 }];
  assert.deepEqual(reconcilePair(pair, size, 2), pair);
});

test("a zero or missing size leaves the pair alone", () => {
  const pair = [{ v: 0 }, { v: 5 }];
  assert.deepEqual(reconcilePair(pair, size, 2), pair);
});

test("no pair at all passes through", () => {
  assert.equal(reconcilePair(null, size, 2), null);
});

test("brow thickness sums both edges and takes the median", () => {
  const cols = [
    { t: 0, up: 0.02, down: 0.02 },   // 0.04
    { t: 0.5, up: 0.05, down: 0.03 }, // 0.08
    { t: 1, up: 0.09, down: 0.03 },   // 0.12
  ];
  assert.equal(browThickness(cols), 0.08);
  assert.equal(browThickness([]), 0);
  assert.equal(browThickness(null), 0);
});

test("a brow contaminated by hair borrows its partner", () => {
  const clean = [
    { t: 0, up: 0.03, down: 0.03 },
    { t: 0.5, up: 0.04, down: 0.03 },
    { t: 1, up: 0.03, down: 0.02 },
  ];
  // Twice as thick: the scan has run up into the hair above the brow.
  const fouled = clean.map((c) => ({ ...c, up: c.up * 3, down: c.down * 2 }));
  const [a, b] = reconcilePair([fouled, clean], browThickness, 1.6);
  assert.equal(a, clean, "the fouled side is replaced");
  assert.equal(b, clean, "the clean side is kept");
});
