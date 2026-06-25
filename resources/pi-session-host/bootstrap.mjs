/**
 * pi-session-host: Bootstrap helpers for the SDK host subprocess.
 *
 * All functions receive `piPath` (resolved by locate-pi in main process) so
 * imports are resolved from the user's actual pi installation.
 */

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ─── Node-version compatibility shim ───────────────────────────────────────────
// undici v8 (bundled with pi) destructures `markAsUncloneable` from
// `node:worker_threads` at module-load time and assigns it onto webidl.util:
//   const { markAsUncloneable } = require('node:worker_threads')
//   webidl.util.markAsUncloneable = markAsUncloneable
// That API landed in Node v22.14.0. Electron 31 ships Node 20.x, which lacks
// it, so the destructure yields undefined and the first undici web object
// (CacheStorage, constructed at undici/index.js top level) throws
// "webidl.util.markAsUncloneable is not a function".
//
// markAsUncloneable only hardens objects against structured cloning across
// worker postMessage boundaries — irrelevant in this single-process host —
// so a no-op shim is safe and restores the pre-v22 behavior. Built-in
// modules are cached and return the same object each require(), so patching
// it here (before any pi/undici import) makes the value visible to undici's
// destructure.
//
// No-op on Node >= 22.14 (the guard leaves the real function in place).
{
  const _wt = createRequire(import.meta.url)("node:worker_threads");
  if (typeof _wt.markAsUncloneable !== "function") {
    _wt.markAsUncloneable = function markAsUncloneable() {};
  }
}

// ─── Pi import helper ─────────────────────────────────────────────────────────
// piPath is the pi binary resolved by locate-pi (e.g., /opt/homebrew/bin/pi).
// It's a symlink to .../pi-coding-agent/dist/cli.js. We resolve the real path
// and derive the dist/index.js entry and bundled deps from there.

export function resolvePiEntry(piPath) {
  // Resolve symlink to get real path: .../pi-coding-agent/dist/cli.js
  const realPi = realpathSync(piPath);
  const distDir = path.dirname(realPi); // .../pi-coding-agent/dist
  return path.join(distDir, "index.js");
}

export function resolvePiDependency(piPath, depName) {
  const realPi = realpathSync(piPath);
  const distDir = path.dirname(realPi); // .../pi-coding-agent/dist
  const pkgDir = path.dirname(distDir); // .../pi-coding-agent
  const piNodeModules = path.join(pkgDir, "node_modules");
  return path.join(piNodeModules, depName);
}

/**
 * Import pi's public SDK from the user's installation.
 * Returns the pi module object (public index.d.ts surface).
 */
export async function importPi(piPath) {
  const entry = resolvePiEntry(piPath);
  return import(pathToFileURL(entry).href);
}

/**
 * Import pi-tui from pi's bundled node_modules.
 */
export async function importPiTui(piPath) {
  const tuiEntry = resolvePiDependency(piPath, "@earendil-works/pi-tui/dist/index.js");
  return import(pathToFileURL(tuiEntry).href);
}

// ─── HTTP Dispatcher ──────────────────────────────────────────────────────────

let _dispatcherConfigured = false;

export function configureHttpDispatcher(piPath, timeoutMs = 60_000) {
  if (_dispatcherConfigured) return;
  try {
    const undiciPath = resolvePiDependency(piPath, "undici/index.js");
    const piRequire = createRequire(undiciPath);
    const undici = piRequire("undici");

    undici.setGlobalDispatcher(
      new undici.EnvHttpProxyAgent({
        allowH2: false,
        bodyTimeout: timeoutMs,
        headersTimeout: timeoutMs,
      }),
    );
    undici.install?.();
    _dispatcherConfigured = true;
  } catch (err) {
    console.error("[pi-session-host] Failed to configure HTTP dispatcher:", err.message);
    throw err;
  }
}

// ─── Trust Resolver ───────────────────────────────────────────────────────────

/**
 * Build the project-trust choice set for a cwd, mirroring pi's own
 * getProjectTrustOptions(cwd, { includeSessionOnly: true }) — but with ONLY
 * public primitives (the option builder is not on pi's public index).
 *
 * Each option carries `trusted` (the answer to resolveProjectTrust) and
 * `updates` (ProjectTrustUpdate[] to persist via ProjectTrustStore.setMany;
 * empty = this-session-only, nothing persisted). This is safe because:
 *  - setMany() normalizes every path internally, so raw cwd / dirname(cwd) keys
 *    land identically to pi's own writes; and
 *  - get() walks ANCESTORS (findNearestTrustEntry), so persisting the PARENT
 *    decision is honored for this folder and its siblings on the next session.
 * "Trust parent" also clears any existing cwd entry (decision:null) so the
 * broader parent grant takes over — exactly as pi does.
 */
export function buildProjectTrustOptions(cwd) {
  const options = [
    { label: "Trust this folder", trusted: true, updates: [{ path: cwd, decision: true }] },
  ];
  const parent = path.dirname(cwd);
  if (parent && parent !== cwd) {
    options.push({
      label: `Trust parent folder (${parent})`,
      trusted: true,
      updates: [
        { path: parent, decision: true },
        { path: cwd, decision: null },
      ],
    });
  }
  options.push({ label: "Trust for this session only", trusted: true, updates: [] });
  options.push({
    label: "Do not trust",
    trusted: false,
    updates: [{ path: cwd, decision: false }],
  });
  options.push({ label: "Do not trust (this session only)", trusted: false, updates: [] });
  return options;
}

/**
 * Create a `resolveProjectTrust` callback for the host's resource loader.
 *
 * Uses ONLY public exports: hasTrustRequiringProjectResources, ProjectTrustStore.
 *
 * This is the security-critical gate (matches pi's own core/project-trust.js
 * deny-by-default flow). Without it, DefaultResourceLoader leaves
 * SettingsManager.projectTrusted at its `true` default and loads project-local
 * `.pi/` extensions + project settings UNGATED — a malicious repo would
 * auto-execute. So `createAgentSessionServices` MUST be passed this resolver.
 *
 * Flow:
 * 1. No trust-requiring project resources → allow (nothing to gate).
 * 2. A stored decision exists (for cwd or any ancestor) → honor it.
 * 3. Otherwise → present pi's full choice set via `promptChoice()` (pi-vis's
 *    React select dialog, brokered over IPC), persist the chosen option's
 *    updates via the public ProjectTrustStore, and return its `trusted`.
 *    Cancel / error → deny-by-default for this session WITHOUT persisting, so
 *    the user is re-prompted next time rather than silently locked out.
 *
 * @param {object} pi - the imported pi SDK
 * @param {string} agentDir - the agent dir (pi.getAgentDir())
 * @param {string} cwd - the session cwd to gate
 * @param {(labels: string[]) => Promise<string | null>} promptChoice -
 *   shows the labels and resolves with the chosen label, or null if cancelled
 */
export function createTrustResolver(pi, agentDir, cwd, promptChoice) {
  const trustStore = new pi.ProjectTrustStore(agentDir);

  return {
    trustStore,
    resolveTrust: async (_input) => {
      if (!pi.hasTrustRequiringProjectResources(cwd)) return true;
      const stored = trustStore.get(cwd);
      if (stored !== null) return stored;

      const options = buildProjectTrustOptions(cwd);
      let choice = null;
      try {
        const label = await promptChoice(options.map((o) => o.label));
        choice = options.find((o) => o.label === label) ?? null;
      } catch (err) {
        console.error("[pi-session-host] Trust prompt failed:", err?.message ?? err);
        return false; // deny-by-default, ephemeral
      }
      if (!choice) return false; // cancelled → deny-by-default, ephemeral

      if (choice.updates.length > 0) trustStore.setMany(choice.updates);
      return choice.trusted;
    },
  };
}

// ─── Theme ────────────────────────────────────────────────────────────────────

// pi shares the active Theme across module loaders via a globalThis symbol
// (see theme.js: the exported `theme` Proxy just reads globalThis[THEME_KEY]).
// Reading that global ourselves — after the PUBLIC initTheme() populates it —
// gives us the EXACT object every extension uses via ctx.ui.theme.fg(...),
// with ZERO private imports (the previous version deep-imported theme.js).
// The key is the package name, stable across versions; the old key is a
// fallback for pre-rename pi builds.
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

/**
 * Initialize the theme for extension use and return the active Theme.
 *
 * initTheme() is a public export; it loads the named (or default) theme and
 * stores it on globalThis. Extensions read it via the `theme` Proxy, which is
 * just a view onto that same global — so returning the global here hands
 * ctx.ui.theme the identical instance with no private module import.
 */
export function initHostTheme(pi, themeName) {
  pi.initTheme(themeName);
  const theme = globalThis[THEME_KEY] ?? globalThis[THEME_KEY_OLD];
  if (!theme) {
    throw new Error("Theme not initialized: initTheme() did not populate the global theme.");
  }
  return theme;
}
