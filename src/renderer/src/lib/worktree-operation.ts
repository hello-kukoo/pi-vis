import type { SessionId } from "@shared/ids.js";
import { useDiffStore } from "../stores/diff-store.js";
import { useSessionsStore } from "../stores/sessions-store.js";

export type WorktreeOperation = {
  sessionId: SessionId;
  mode: "create" | "attach";
  base?: string | undefined;
  fromCurrentCheckout?: boolean | undefined;
  path?: string | undefined;
};

/**
 * Run a server-authoritative worktree switch. Identity is only applied after
 * main has completed the replacement host and returned success.
 */
export async function runWorktreeOperation({
  sessionId,
  mode,
  base,
  fromCurrentCheckout,
  path,
}: WorktreeOperation): Promise<{ ok: true } | { ok: false }> {
  const store = useSessionsStore.getState();
  const diff = useDiffStore.getState();
  if (
    diff.open &&
    diff.sessionId === sessionId &&
    (diff.editSession !== null || diff.commentEditorFiles.size > 0)
  ) {
    store.setWorktreeError(sessionId, "Finish or cancel the open diff draft before switching.");
    return { ok: false };
  }
  if (mode === "attach" && !path?.trim()) {
    store.setWorktreeError(sessionId, "Choose a worktree directory first.");
    return { ok: false };
  }

  store.setWorktreeCreating(sessionId, true);
  try {
    const result =
      mode === "create"
        ? await window.pivis.invoke(
            "session.createWorktree",
            fromCurrentCheckout
              ? { sessionId, fromCurrentCheckout: true }
              : { sessionId, base: base ?? "HEAD" },
          )
        : await window.pivis.invoke("session.attachWorktree", { sessionId, path: path!.trim() });
    if (!result.ok) {
      store.setWorktreeError(sessionId, result.error ?? "Worktree operation failed");
      return { ok: false };
    }
    let successMessage: string;
    if ("workspace" in result && result.workspace === true) {
      store.applyWorkspace(sessionId);
      successMessage = "Session moved to Workspace";
    } else if ("worktreePath" in result) {
      store.applyWorktree(sessionId, {
        worktreePath: result.worktreePath,
        branch: result.branch,
        name: result.name,
        base: result.base,
      });
      successMessage =
        mode === "create" ? `Worktree ${result.name} created` : `Attached worktree ${result.name}`;
    } else {
      store.setWorktreeError(sessionId, "Worktree operation returned an invalid result.");
      return { ok: false };
    }
    store.clearWorktreeIntent(sessionId);
    store.addToast(
      sessionId,
      result.warning ?? successMessage,
      result.warning ? "warning" : "success",
    );
    return { ok: true };
  } catch (error) {
    store.setWorktreeError(sessionId, error instanceof Error ? error.message : String(error));
    return { ok: false };
  } finally {
    store.setWorktreeCreating(sessionId, false);
  }
}
