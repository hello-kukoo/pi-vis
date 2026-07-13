import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner.js";
import { IconCheck } from "./icons.js";
import "./WorktreeAttachField.css";

type Status =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "ok"; branch: string }
  | { kind: "error"; message: string };

export function WorktreeAttachField({
  workspacePath,
  currentCheckoutPath,
  path,
  onPathChange,
  disabled = false,
}: {
  workspacePath?: string;
  currentCheckoutPath?: string;
  path: string;
  onPathChange: (path: string) => void;
  disabled?: boolean;
}): React.ReactElement {
  const [browseBusy, setBrowseBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const requestId = useRef(0);

  useEffect(() => {
    // Increment before the empty-path gate too: clearing the field must fence
    // an already-dispatched validation for the previous value.
    const id = ++requestId.current;
    if (!workspacePath || !path.trim()) {
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "validating" });
    const timer = setTimeout(() => {
      window.pivis
        .invoke("worktree.validate", {
          workspacePath,
          path,
          ...(currentCheckoutPath ? { currentCheckoutPath } : {}),
        })
        .then((result: { ok: true; branch: string } | { ok: false; error: string }) => {
          if (id !== requestId.current) return;
          setStatus(
            result.ok
              ? { kind: "ok", branch: result.branch }
              : { kind: "error", message: result.error },
          );
        })
        .catch((error: unknown) => {
          if (id === requestId.current) setStatus({ kind: "error", message: String(error) });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      // The timer may already have dispatched IPC; invalidate that completion
      // on dependency change or unmount.
      if (requestId.current === id) requestId.current++;
    };
  }, [currentCheckoutPath, path, workspacePath]);

  const browse = useCallback(async () => {
    if (!workspacePath) return;
    setBrowseBusy(true);
    try {
      const picked = await window.pivis.invoke("worktree.pickDirectory", { workspacePath });
      if (typeof picked === "string" && picked) onPathChange(picked);
    } catch {
      // Typing remains available if the native picker cannot open.
    } finally {
      setBrowseBusy(false);
    }
  }, [onPathChange, workspacePath]);

  return (
    <div className="worktree-attach-field">
      <div className="worktree-attach-field__controls">
        <input
          className="worktree-attach-field__input"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder="/path/to/worktree"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          disabled={disabled}
          aria-label="Worktree directory path"
        />
        <button
          type="button"
          className="worktree-attach-field__browse"
          onClick={() => void browse()}
          disabled={disabled || browseBusy}
        >
          {browseBusy ? <Spinner aria-hidden="true" /> : "Browse…"}
        </button>
      </div>
      {status.kind === "validating" && (
        <div className="worktree-attach-field__status">
          <Spinner aria-hidden="true" />
          Checking…
        </div>
      )}
      {status.kind === "ok" && (
        <div className="worktree-attach-field__status worktree-attach-field__status--ok">
          <IconCheck />
          On branch {status.branch}
        </div>
      )}
      {status.kind === "error" && (
        <div
          className="worktree-attach-field__status worktree-attach-field__status--error"
          role="alert"
        >
          {status.message}
        </div>
      )}
    </div>
  );
}
