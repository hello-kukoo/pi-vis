/** Helpers for user-configured environment variables applied to pi subprocesses. */

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Pi-Vis owns every PIVIS_* variable as an internal control channel (theme
 * signals, test seams, etc.). User-configured pi env must never override those
 * even if settings.json is edited by hand.
 */
export function isReservedPiVisEnvName(name: string): boolean {
  return name.startsWith("PIVIS_");
}

export function isValidEnvName(name: string): boolean {
  return ENV_NAME_RE.test(name);
}

export function sanitizeUserPiEnv(
  piEnv: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!piEnv) return out;

  for (const [name, value] of Object.entries(piEnv)) {
    if (!isValidEnvName(name)) continue;
    if (isReservedPiVisEnvName(name)) continue;
    out[name] = value;
  }
  return out;
}

export function mergeUserPiEnv(
  base: Record<string, string>,
  piEnv: Record<string, string> | undefined,
): Record<string, string> {
  return { ...base, ...sanitizeUserPiEnv(piEnv) };
}
