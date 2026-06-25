/**
 * compareVersions — semver-ish comparison for pi's version-gate (host.mjs).
 *
 * Strips pre-release suffixes (-beta, -rc.1) before the numeric compare, and
 * treats a version WITH a pre-release as LOWER than the same release (semver).
 * The old `a.split(".").map(Number)` turned "0-beta" into NaN→0, so
 * "0.80.0-beta" passed the >=0.80.0 gate (P3-a). Extracted here so it's unit-
 * testable without importing host.mjs's fork entry-point.
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const [an, apre] = a.split("-");
  const [bn, bpre] = b.split("-");
  const pa = an.split(".").map(Number);
  const pb = bn.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  // Numeric parts equal: a pre-release is less than a release.
  if (apre && !bpre) return -1;
  if (!apre && bpre) return 1;
  if (apre && bpre) return apre < bpre ? -1 : apre > bpre ? 1 : 0;
  return 0;
}
