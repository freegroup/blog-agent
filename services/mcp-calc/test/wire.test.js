import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSection, wireCrossSection, DELTA, GAMMA, SICHERHEIT } from "../wire.js";

/**
 * Reference values verified against the original implementation in the target project.
 * If the port drifts, this is where it shows up — not in a published article.
 */

test("constants match the target project", () => {
  assert.equal(DELTA, 0.02);
  assert.equal(GAMMA, 56);
  assert.equal(SICHERHEIT, 1.12);
});

test("crossSection: 5 m, 40 A, 12 V", () => {
  // (500/100 * 2 * 40) / (0.02 * 12 * 56) = 400 / 13.44
  assert.ok(Math.abs(crossSection(500, 40, 12) - 29.7619) < 0.001);
});

test("crossSection doubles for forward and return conductor", () => {
  const single = crossSection(100, 10, 12);
  const double = crossSection(200, 10, 12);
  assert.ok(Math.abs(double - single * 2) < 1e-9);
});

test("crossSection handles 0 V without dividing by zero", () => {
  const at0 = crossSection(100, 10, 0);
  assert.ok(Number.isFinite(at0));
  assert.equal(at0, crossSection(100, 10, 1));
});

test("wireCrossSection picks the next larger standard value", () => {
  // 29.76 * 1.12 = 33.33 -> next standard value is 35
  assert.equal(wireCrossSection(500, 40, 12), 35);
});

test("wireCrossSection for small load", () => {
  // (200/100 * 2 * 5) / 13.44 = 1.488 ; * 1.12 = 1.667 -> 2.5
  assert.equal(wireCrossSection(200, 5, 12), 2.5);
});

test("wireCrossSection caps at the largest standard value", () => {
  assert.equal(wireCrossSection(10000, 500, 12), 500);
});

test("24 V needs half the cross-section of 12 V", () => {
  assert.ok(Math.abs(crossSection(500, 40, 24) - crossSection(500, 40, 12) / 2) < 1e-9);
});
