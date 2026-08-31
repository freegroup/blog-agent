/**
 * Cable sizing for 12/24 V on-board networks.
 *
 * Line-for-line port of src/utils/Wire.js from the target project
 * (camper-elektrik-planer.de), so articles and the calculator agree on numbers.
 * If that file changes, this one must follow — the reference cases in
 * test/wire.test.js will catch any drift.
 */

/** Permitted voltage drop, 2 %. */
export const DELTA = 0.02;

/** Copper conductivity in m/(Ohm*mm^2), standard value for commercial cables. */
export const GAMMA = 56;

/** Standard cross-sections in mm^2, as in the target project. */
export const DURCHMESSER = [1, 2.5, 4, 6, 8, 10, 16, 25, 35, 50, 60, 100, 150, 200, 500];

/** Safety margin on top of the computed requirement. */
export const SICHERHEIT = 1.12;

/** 0 V would cause division by zero; fall back to 1 V — result is intentionally huge. */
const MIN_VOLTAGE = 1;

/**
 * Raw cross-section in mm^2, without safety margin or rounding to standard values.
 * Length is one-way in cm; forward and return conductors are doubled.
 */
export function crossSection(lengthCm, current, voltage) {
  const u = voltage > 0 ? voltage : MIN_VOLTAGE;
  return ((lengthCm / 100) * 2 * current) / (DELTA * u * GAMMA);
}

/**
 * Next larger standard cross-section in mm^2, including 12 % safety margin.
 * If the series is exhausted, returns the largest value — same behaviour as the target project.
 */
export function wireCrossSection(lengthCm, current, voltage) {
  const q = crossSection(lengthCm, current, voltage) * SICHERHEIT;
  const sorted = [...DURCHMESSER, q].sort((a, b) => a - b);
  const index = sorted.indexOf(q);
  return sorted[index + 1] !== undefined ? sorted[index + 1] : DURCHMESSER[DURCHMESSER.length - 1];
}
