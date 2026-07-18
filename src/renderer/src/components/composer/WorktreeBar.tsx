import type { GitBranch } from "@shared/git.js";
import type { SessionId } from "@shared/ids.js";
import { useEffect, useMemo, useState } from "react";
import {
  gitRootForSession,
  isNewSessionPending,
  useSessionsStore,
} from "../../stores/sessions-store.js";
import { BranchDropdown } from "../common/BranchDropdown.js";
import { Spinner } from "../common/Spinner.js";
import { WorktreeAttachField } from "../common/WorktreeAttachField.js";
import "./WorktreeBar.css";

interface WorktreeBarProps {
  sessionId: SessionId;
}

type WorktreeMode = "none" | "create" | "attach";

export function WorktreeBar({ sessionId }: WorktreeBarProps): React.ReactElement | null {
  const session = useSessionsStore((s) => s.sessions.get(sessionId));
  const setWorktreeMode = useSessionsStore((s) => s.setWorktreeMode);
  const setWorktreeAttachPath = useSessionsStore((s) => s.setWorktreeAttachPath);
  const setWorktreeBase = useSessionsStore((s) => s.setWorktreeBase);
  const setWorktreeCopyUncommitted = useSessionsStore((s) => s.setWorktreeCopyUncommitted);
  const gitRoot = gitRootForSession(session);

  // Load branches via IPC (used by the "New" mode's BranchDropdown).
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [includeRemote, setIncludeRemote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!gitRoot) {
      setLoading(false);
      setLoadError("No workspace path");
      return;
    }
    setLoading(true);
    setLoadError(null);
    window.pivis
      .invoke("git.branches", { root: gitRoot })
      .then(
        (res: {
          kind: string;
          current?: string | null;
          branches?: GitBranch[];
          message?: string;
        }) => {
          if (cancelled) return;
          if (res.kind === "ok" && res.branches) {
            setBranches(res.branches);
            setCurrentBranch(res.current ?? null);
          } else {
            setLoadError((res as { message?: string }).message ?? "Could not load branches");
          }
          setLoading(false);
        },
      )
      .catch((err: Error) => {
        if (!cancelled) {
          setLoadError(String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gitRoot]);

  // Load the diffIncludeRemoteBranches setting once.
  useEffect(() => {
    window.pivis
      .invoke("settings.get", undefined)
      .then((s: { diffIncludeRemoteBranches?: boolean }) => {
        if (s?.diffIncludeRemoteBranches != null) {
          setIncludeRemote(s.diffIncludeRemoteBranches);
        }
      })
      .catch(() => {});
  }, []);

  // Stable remote-toggle handler — keeps BranchDropdown's memoization intact
  // across re-renders (e.g. while the validation status line is updating).
  const handleToggleRemote = useMemo(
    () => () => {
      setIncludeRemote((prev) => {
        void window.pivis.invoke("settings.set", {
          diffIncludeRemoteBranches: !prev,
        });
        return !prev;
      });
    },
    [],
  );

  // Self-gate: only a still-empty, brand-new session gets this pre-send bar.
  // Pi can create and report the JSONL file during startup, before the first
  // user message is sent, so sessionFile is not evidence that the session is
  // established. The canonical pending predicate also keeps resumed,
  // header-only sessions out of the bar.
  if (!session) return null;
  if (session.worktreePath) return null;
  if (!isNewSessionPending(session)) return null;
  if (loading) return null;
  if (loadError || branches.length === 0) return null;

  const mode = (session.worktreeMode ?? "none") as WorktreeMode;
  const creating = session.worktreeCreating ?? false;
  const worktreeError = session.worktreeError ?? null;
  const copyUncommitted = session.worktreeCopyUncommitted ?? false;
  const base = copyUncommitted ? currentBranch : (session.worktreeBase ?? currentBranch);
  const baseLabel = copyUncommitted ? (currentBranch ?? "HEAD") : (base ?? "branch");

  return (
    <div className="worktree-bar">
      <div className="worktree-bar__row">
        <SegmentedControl
          mode={mode}
          disabled={creating}
          onChange={(next) => {
            if (next === "create") {
              // Just switched to "New": seed the base branch to the
              // currently checked-out one (same default the old checkbox
              // had on first check).
              setWorktreeMode(sessionId, "create");
              setWorktreeBase(sessionId, currentBranch);
            } else if (next === "attach") {
              setWorktreeMode(sessionId, "attach");
            } else {
              // "none" — clear the intent entirely.
              setWorktreeMode(sessionId, "none");
              setWorktreeBase(sessionId, null);
            }
          }}
        />

        {/* Mode-specific controls — sit next to the segmented control so
            the whole bar reads as one row when the window is wide. */}
        {mode === "create" && (
          <>
            <BranchDropdown
              branches={branches}
              currentBranch={currentBranch}
              value={base}
              onChange={(b) => {
                if (b !== null) setWorktreeBase(sessionId, b);
              }}
              includeRemoteBranches={includeRemote}
              onToggleRemote={handleToggleRemote}
              disabled={creating || copyUncommitted}
              triggerLabel={baseLabel}
              ariaLabel="Choose worktree base branch"
              placement="top"
            />
            <label className="worktree-bar__copy-changes">
              <input
                type="checkbox"
                checked={copyUncommitted}
                disabled={creating}
                onChange={(event) => {
                  const copy = event.currentTarget.checked;
                  if (copy) setWorktreeBase(sessionId, currentBranch);
                  setWorktreeCopyUncommitted(sessionId, copy);
                }}
              />
              <span>Copy uncommitted changes</span>
            </label>
          </>
        )}

        {mode === "attach" && (
          <WorktreeAttachField
            workspacePath={session.workspacePath}
            path={session.worktreeAttachPath ?? ""}
            disabled={creating}
            onPathChange={(path) => setWorktreeAttachPath(sessionId, path)}
          />
        )}

        {creating && (
          <span className="worktree-bar__spinner">
            <Spinner className="worktree-bar__spinner-dot" aria-hidden="true" />
            {mode === "attach" ? "Attaching worktree…" : "Creating worktree…"}
          </span>
        )}
      </div>

      {/* Inline, durable failure message (create or attach). */}
      {worktreeError && !creating && (
        <div className="worktree-bar__error" role="alert">
          <span className="worktree-bar__error-text">{worktreeError}</span>
        </div>
      )}
    </div>
  );
}

// ── Segmented control ────────────────────────────────────────────────
//
// Three-way selector: In Workspace | New Worktree | Existing Worktree.
// pill with the active segment highlighted in mauve (matching the
// BranchDropdown's accent). Keyboard-operable (button group).
function SegmentedControl({
  mode,
  disabled,
  onChange,
}: {
  mode: WorktreeMode;
  disabled: boolean;
  onChange: (next: WorktreeMode) => void;
}): React.ReactElement {
  const segments: { value: WorktreeMode; label: string }[] = [
    { value: "none", label: "In Workspace" },
    { value: "create", label: "New Worktree" },
    { value: "attach", label: "Existing Worktree" },
  ];
  return (
    <div className="worktree-bar__segmented" role="group" aria-label="Worktree mode">
      {segments.map((seg) => {
        const active = mode === seg.value;
        return (
          <button
            key={seg.value}
            type="button"
            className={`worktree-bar__segment${active ? " worktree-bar__segment--active" : ""}`}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(seg.value);
            }}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
