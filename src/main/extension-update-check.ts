import type { ExtensionUpdate } from "@shared/extension-updates.js";

/**
 * Check only user-scoped packages through pi's public package-manager API.
 *
 * The package is loaded with native dynamic import so the CJS Electron main
 * bundle/worker can consume pi's import-only package root.
 */
export async function checkUserExtensionUpdates(
  cwd: string,
  agentDir?: string,
): Promise<ExtensionUpdate[]> {
  const { DefaultPackageManager, SettingsManager, getAgentDir } = await import(
    "@earendil-works/pi-coding-agent"
  );
  const resolvedAgentDir = agentDir ?? getAgentDir();
  const settingsManager = SettingsManager.create(cwd, resolvedAgentDir, {
    projectTrusted: false,
  });
  const globalSettingsError = settingsManager.drainErrors().find(({ scope }) => scope === "global");
  if (globalSettingsError) throw globalSettingsError.error;

  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir: resolvedAgentDir,
    settingsManager,
  });
  const available = await packageManager.checkForAvailableUpdates();
  return available
    .filter((update) => update.scope === "user")
    .map((update) => ({
      source: update.source,
      displayName: update.displayName,
      type: update.type,
      scope: "user" as const,
    }));
}
