// file-size.ts — parse/format human-readable byte sizes for the settings UI.
//
// The diff viewer's max-file-size setting is stored as MiB (fractional
// allowed). The settings text box lets the user type a freeform size with an
// optional unit; these helpers convert between that text and the stored MiB
// value. Units are binary (1024-based) — the common expectation for a dev
// tool — and case-insensitive. A bare number is read as MiB, the field's
// natural unit (the box pre-fills "5 MiB").

/** Unit → MiB multiplier. All binary (1024-based). */
const UNIT_TO_MIB: Record<string, number> = {
  b: 1 / (1024 * 1024),
  k: 1 / 1024,
  kb: 1 / 1024,
  kib: 1 / 1024,
  m: 1,
  mb: 1,
  mib: 1,
  g: 1024,
  gb: 1024,
  gib: 1024,
};

/**
 * Parse a human size string into MiB. Accepts an optional unit
 * (b, kb/kib, mb/mib, gb/gib); a bare number is interpreted as MiB. Returns
 * null when the input isn't a recognizable, non-negative size.
 */
export function parseSizeToMiB(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (s === "") return null;
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)?$/.exec(s);
  if (!m || m[1] === undefined) return null;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = m[2] ?? "m"; // bare number → MiB
  const mult = UNIT_TO_MIB[unit];
  if (mult === undefined) return null;
  return value * mult;
}

/** Trim a number to at most 2 decimals with no trailing zeros. */
function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Format a MiB value into a compact human string for the input box, picking
 * the unit (KiB / MiB / GiB) that reads most naturally for the magnitude.
 */
export function formatMiB(mib: number): string {
  if (mib >= 1024) return `${trimNum(mib / 1024)} GiB`;
  if (mib < 1) return `${trimNum(mib * 1024)} KiB`;
  return `${trimNum(mib)} MiB`;
}
