import fs from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import { getSettings, saveSettings } from "./settings-store.js";

/** Cap on the number of tracked workspaces. */
const MAX_WORKSPACES = 20;

/**
 * Open the OS directory picker. On selection, the workspace is appended to the
 * END of `workspaceOrder` (never prepended) so it does not displace a
 * manually-positioned entry. A newly-picked workspace is also auto-expanded.
 */
export async function pickWorkspace(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Open Workspace",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = result.filePaths[0];
  if (!chosen) return null;

  const settings = getSettings();
  const order = settings.workspaceOrder.filter((w) => w !== chosen);
  order.push(chosen);
  const expanded = settings.expandedWorkspaces.includes(chosen)
    ? settings.expandedWorkspaces
    : [...settings.expandedWorkspaces, chosen];
  saveSettings({
    workspaceOrder: order.slice(-MAX_WORKSPACES),
    expandedWorkspaces: expanded,
    lastActiveWorkspace: chosen,
  });
  return chosen;
}

/**
 * Open the OS directory picker for attaching a session to an existing
 * worktree on disk. Mirrors `pickWorkspace` but does NOT mutate the
 * workspace list — attaching is a per-session concern, not a workspace
 * discovery action.
 *
 * `defaultPath` nicety: opens the picker at the sibling
 * `<repoName>-worktrees` directory (where Pi-Vis creates worktrees via
 * `createWorktree`) when it exists, otherwise the repo's parent — so
 * the picker lands where worktrees actually live instead of at the
 * user's home. The repo name and parent are computed the same way
 * `createWorktree` computes its worktree directory, so the two flows
 * agree on the layout.
 *
 * Returns the chosen absolute path, or `null` if the user cancelled.
 */
export async function pickWorktreeDirectory(workspacePath: string): Promise<string | null> {
  // Compute the same sibling path `createWorktree` uses. We `statSync`
  // (not `realpath`) because the directory may not exist yet — the
  // picker should still open at the parent in that case, not fail.
  let defaultPath: string | undefined;
  try {
    const repoName = path.basename(workspacePath);
    const parentDir = path.dirname(workspacePath);
    const worktreesRoot = path.join(parentDir, `${repoName}-worktrees`);
    defaultPath = fs.existsSync(worktreesRoot) ? worktreesRoot : parentDir;
  } catch {
    // workspacePath could not be parsed (defensive — `dialog` will
    // just default to the user's home). Swallow the error.
    defaultPath = undefined;
  }

  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Attach Existing Worktree",
    ...(defaultPath ? { defaultPath } : {}),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

/**
 * Remove a workspace from `workspaceOrder` and `expandedWorkspaces`. Clears
 * `lastActiveWorkspace` if it pointed at the removed path. Returns the
 * remaining ordered list.
 */
export function removeWorkspace(path: string): string[] {
  const settings = getSettings();
  const order = settings.workspaceOrder.filter((w) => w !== path);
  const expanded = settings.expandedWorkspaces.filter((w) => w !== path);
  const updates: Partial<ReturnType<typeof getSettings>> = {
    workspaceOrder: order,
    expandedWorkspaces: expanded,
  };
  if (settings.lastActiveWorkspace === path) {
    updates.lastActiveWorkspace = null;
  }
  saveSettings(updates);
  return order;
}

/**
 * Return the manually-ordered workspace list, pruning any paths that no longer
 * exist on disk. Pruning does not reorder the survivors. Persists the pruned
 * list back if it changed. `expandedWorkspaces` is pruned to the survivors in
 * the same pass so stale expand entries can't accumulate for deleted paths.
 */
export function getOrderedWorkspaces(): string[] {
  const settings = getSettings();
  const order = settings.workspaceOrder;
  const existing = order.filter((p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
  if (existing.length !== order.length) {
    const survivors = new Set(existing);
    const expanded = settings.expandedWorkspaces.filter((p) => survivors.has(p));
    const updates: Partial<ReturnType<typeof getSettings>> = { workspaceOrder: existing };
    if (expanded.length !== settings.expandedWorkspaces.length) {
      updates.expandedWorkspaces = expanded;
    }
    saveSettings(updates);
  }
  return existing;
}
