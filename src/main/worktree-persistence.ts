import path from "node:path";
import type { AppSettings } from "@shared/settings.js";
import { getSettings, saveSettings } from "./settings-store.js";

type WorktreeAssociation = AppSettings["worktrees"][string];

interface RespawnAndPersistWorktreeOptions {
  worktreePath: string;
  association: WorktreeAssociation;
  /** Existing JSONL file whose immutable header cwd this switch overrides. */
  sessionFile?: string | undefined;
  respawn: () => Promise<void>;
}

/**
 * Commit a session's worktree association only after its replacement host is
 * ready. The settings read intentionally happens after the await: concurrent
 * worktree operations must merge into the latest persisted map rather than
 * replacing it with a snapshot captured before either respawn completed.
 */
export type WorktreePersistenceResult = { persisted: true } | { persisted: false; error: string };

export async function respawnAndPersistWorktree({
  worktreePath,
  association,
  sessionFile,
  respawn,
}: RespawnAndPersistWorktreeOptions): Promise<WorktreePersistenceResult> {
  await respawn();

  let lastError = "Could not persist the worktree association";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Each retry reads the latest settings before its synchronous write, so
      // concurrent sessions cannot replace one another with stale maps.
      const settings = getSettings();
      saveSettings({
        worktrees: {
          ...settings.worktrees,
          [worktreePath]: association,
        },
        ...(sessionFile
          ? {
              sessionWorktrees: {
                ...settings.sessionWorktrees,
                [path.resolve(sessionFile)]: worktreePath,
              },
            }
          : {}),
      });
      return { persisted: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }

  // The host has already moved; callers must return the new identity to the
  // renderer rather than pretending the switch itself failed.
  return { persisted: false, error: lastError };
}

export async function persistRecoverableWorktree({
  worktreePath,
  association,
}: Pick<
  RespawnAndPersistWorktreeOptions,
  "worktreePath" | "association"
>): Promise<WorktreePersistenceResult> {
  let lastError = "Could not persist the recoverable worktree association";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const settings = getSettings();
      saveSettings({
        worktrees: {
          ...settings.worktrees,
          [worktreePath]: association,
        },
      });
      return { persisted: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
  return { persisted: false, error: lastError };
}

export async function respawnAndPersistWorkspace({
  sessionFile,
  workspacePath,
  respawn,
}: {
  sessionFile?: string | undefined;
  workspacePath: string;
  respawn: () => Promise<void>;
}): Promise<WorktreePersistenceResult> {
  await respawn();
  if (!sessionFile) return { persisted: true };

  let lastError = "Could not persist the Workspace session override";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const settings = getSettings();
      saveSettings({
        sessionWorktrees: {
          ...settings.sessionWorktrees,
          [path.resolve(sessionFile)]: path.resolve(workspacePath),
        },
      });
      return { persisted: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
  return { persisted: false, error: lastError };
}
