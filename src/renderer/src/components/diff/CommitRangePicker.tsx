import type { GitCommitMetadata, GitCommitRange, GitCommitsResult } from "@shared/git.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeClaim } from "../../hooks/useEscapeClaim.js";
import { useVirtualList } from "../../hooks/useVirtualList.js";
import { useDiffStore } from "../../stores/diff-store.js";
import { FadeText } from "../common/FadeText.js";
import { IconChevronDown } from "../common/icons.js";
import "./CommitRangePicker.css";

function sameRange(a: GitCommitRange | null, b: GitCommitRange | null): boolean {
  return a?.start === b?.start && a?.end === b?.end;
}

export function CommitRangePicker(): React.ReactElement {
  const root = useDiffStore((s) => s.root);
  const base = useDiffStore((s) => s.selectedBase);
  const range = useDiffStore((s) => s.commitRange);
  const editing = useDiffStore((s) => s.editSession !== null || s.commentEditorFiles.size > 0);
  const setCommitRange = useDiffStore((s) => s.setCommitRange);
  const [open, setOpen] = useState(false);
  const [commits, setCommits] = useState<GitCommitMetadata[]>([]); // oldest → newest
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GitCommitRange | null>(range);
  const [first, setFirst] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEscapeClaim(open);

  const close = useCallback((): void => {
    setOpen(false);
    setDraft(range);
    setFirst(null);
    queueMicrotask(() => triggerRef.current?.focus());
  }, [range]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() =>
      dialogRef.current?.querySelector<HTMLElement>("button, [tabindex='0']")?.focus(),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", outside, true);
    return () => document.removeEventListener("mousedown", outside, true);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key !== "Escape" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  useEffect(() => {
    if (!open || !root || !base) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.pivis
      .invoke("git.commits", { root, base })
      .then((result: GitCommitsResult) => {
        if (
          cancelled ||
          useDiffStore.getState().root !== root ||
          useDiffStore.getState().selectedBase !== base
        )
          return;
        if (result.kind === "ok") {
          setCommits(result.commits);
          setTruncated(result.truncated);
          setHighlightedIndex(0);
        } else if (result.kind === "error") setError(result.message);
        else setError("Commit history is unavailable for this repository.");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, root, base]);

  const list = [...commits].reverse(); // newest first
  const virtual = useVirtualList<HTMLDivElement>({
    count: list.length,
    rowHeight: 44,
    minOverscan: 16,
  });
  const selectedIndices = draft
    ? [
        commits.findIndex((c) => c.sha === draft.start),
        commits.findIndex((c) => c.sha === draft.end),
      ]
    : [-1, -1];
  const startIndex = selectedIndices[0] ?? -1;
  const endIndex = selectedIndices[1] ?? -1;
  const count = startIndex >= 0 && endIndex >= 0 ? endIndex - startIndex + 1 : 0;
  const label = range === null ? "Working tree" : count === 1 ? "1 commit" : `${count} commits`;

  useEffect(() => {
    if (open) virtual.ensureIndexVisible(highlightedIndex);
  }, [highlightedIndex, open, virtual.ensureIndexVisible]);

  const choose = (sha: string): void => {
    if (first === null) {
      // A first click is already a valid, one-commit range. The anchor only
      // controls whether the next click expands that draft.
      setFirst(sha);
      setDraft({ start: sha, end: sha });
      return;
    }
    const a = commits.findIndex((c) => c.sha === first);
    const b = commits.findIndex((c) => c.sha === sha);
    if (a < 0 || b < 0) return;
    setDraft({ start: commits[Math.min(a, b)]!.sha, end: commits[Math.max(a, b)]!.sha });
    setFirst(null);
  };
  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let next = highlightedIndex;
    switch (event.key) {
      case "ArrowDown":
        next = Math.min(list.length - 1, highlightedIndex + 1);
        break;
      case "ArrowUp":
        next = Math.max(0, highlightedIndex - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = Math.max(0, list.length - 1);
        break;
      case "PageDown":
        next = Math.min(list.length - 1, highlightedIndex + 5);
        break;
      case "PageUp":
        next = Math.max(0, highlightedIndex - 5);
        break;
      case "Enter":
      case " ": {
        const commit = list[highlightedIndex];
        if (commit) choose(commit.sha);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    setHighlightedIndex(next);
  };

  const apply = (): void => {
    if (!sameRange(range, draft)) setCommitRange(draft);
    setOpen(false);
    setFirst(null);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  return (
    <div className="commit-range-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="commit-range-picker__trigger fade-scope"
        disabled={editing}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Choose commit range"
        title={editing ? "Finish editing before changing the comparison" : "Choose commit range"}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setDraft(range);
          setFirst(null);
          setOpen(true);
        }}
      >
        <FadeText>{label}</FadeText>
        <IconChevronDown className="commit-range-picker__caret" />
      </button>
      {open && (
        <div
          ref={dialogRef}
          className="commit-range-picker__popup"
          role="dialog"
          aria-label="Commit range"
        >
          <div className="commit-range-picker__header">
            <span className="commit-range-picker__eyebrow">Diff scope</span>
            <FadeText className="commit-range-picker__base" title={base ?? "No base selected"}>
              {base ? `${base} → HEAD` : "Choose a base branch"}
            </FadeText>
            <p>Choose one commit, or two endpoints. The range is inclusive.</p>
          </div>
          {!base ? (
            <div className="commit-range-picker__guidance">
              Select a base branch first to choose commits.
            </div>
          ) : (
            <>
              <button
                type="button"
                className={`commit-range-picker__working${draft === null && first === null ? " commit-range-picker__working--selected" : ""}`}
                aria-pressed={draft === null && first === null}
                onClick={() => {
                  setDraft(null);
                  setFirst(null);
                }}
              >
                Working tree
              </button>
              {loading && <div className="commit-range-picker__guidance">Loading commits…</div>}
              {error && (
                <div className="commit-range-picker__guidance" role="alert">
                  {error}
                </div>
              )}
              {!loading && !error && commits.length === 0 && (
                <div className="commit-range-picker__guidance">
                  No commits to show for this base.
                </div>
              )}
              {!loading && !error && commits.length > 0 && (
                <div
                  className="commit-range-picker__list"
                  ref={virtual.containerRef}
                  onScroll={virtual.onScroll}
                  role="listbox"
                  aria-label="Commits, newest first"
                  tabIndex={0}
                  aria-activedescendant={
                    list[highlightedIndex]?.sha ? `commit-${list[highlightedIndex].sha}` : undefined
                  }
                  onKeyDown={handleListKeyDown}
                >
                  <div
                    className="commit-range-picker__spacer"
                    style={{ height: virtual.totalHeight }}
                  >
                    <div
                      className="commit-range-picker__window"
                      style={{ transform: `translateY(${virtual.offsetY}px)` }}
                    >
                      {virtual.rows.map(({ index }) => {
                        const commit = list[index]!;
                        const original = commits.length - 1 - index;
                        const inBand =
                          startIndex >= 0 && original >= startIndex && original <= endIndex;
                        const endpoint =
                          startIndex === endIndex && original === startIndex
                            ? "Only"
                            : original === startIndex
                              ? "Start"
                              : original === endIndex
                                ? "End"
                                : "";
                        return (
                          <button
                            key={commit.sha}
                            id={`commit-${commit.sha}`}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={inBand}
                            className={`commit-range-picker__commit${inBand ? " commit-range-picker__commit--selected" : ""}${first === commit.sha ? " commit-range-picker__commit--first" : ""}${index === highlightedIndex ? " commit-range-picker__commit--highlighted" : ""}`}
                            onClick={() => {
                              setHighlightedIndex(index);
                              choose(commit.sha);
                            }}
                          >
                            <span className="commit-range-picker__sha">{commit.shortSha}</span>
                            <FadeText className="commit-range-picker__subject">
                              {commit.subject}
                            </FadeText>
                            {endpoint && (
                              <span className="commit-range-picker__endpoint">{endpoint}</span>
                            )}
                            <FadeText
                              className="commit-range-picker__meta"
                              title={`${commit.authorName} · ${new Date(commit.authoredAt).toLocaleDateString()}`}
                            >
                              {commit.authorName} ·{" "}
                              {new Date(commit.authoredAt).toLocaleDateString()}
                            </FadeText>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {truncated && !loading && !error && (
                <div className="commit-range-picker__hint">Showing latest 500 commits</div>
              )}
              {first && (
                <div className="commit-range-picker__hint">
                  Select another commit to set the range.
                </div>
              )}
            </>
          )}
          <footer className="commit-range-picker__footer">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button type="button" className="commit-range-picker__apply" onClick={apply}>
              {draft === null
                ? "Show working tree"
                : `Show ${count} ${count === 1 ? "commit" : "commits"}`}
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
