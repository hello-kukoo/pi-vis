import type {
  SearchMatchRange,
  SearchTargetId,
  SessionSearchContextResult,
  SessionSearchResult,
} from "@shared/session-search.js";
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { useEscapeClaim } from "../../hooks/useEscapeClaim.js";
import { RENDERER_GENERATION } from "../../lib/renderer-generation.js";
import { useSessionSearchStore } from "../../stores/session-search-store.js";
import { useSessionsStore } from "../../stores/sessions-store.js";
import { FadeText } from "../common/FadeText.js";
import { IconChevronLeft, IconClose, IconSearch } from "../common/icons.js";
import "./SessionSearchModal.css";

export const SESSION_SEARCH_FOCUS_EVENT = "pivis:focus-session-search";

interface SessionSearchModalProps {
  /** Must delegate to the normal session-open orchestration. */
  onOpenResult?: (targetId: SearchTargetId) => Promise<undefined | boolean>;
}

function formatTime(timestamp: number | null): string {
  if (timestamp === null) return "Saved history";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    timestamp,
  );
}

/** Ranges are source offsets, not regexes. Invalid ranges are discarded. */
export function HighlightedText({ text, ranges }: { text: string; ranges: SearchMatchRange[] }) {
  const valid = [...ranges]
    .filter((range) => range.start >= 0 && range.end <= text.length && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of valid) {
    if (range.start < cursor) continue;
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <mark key={`${range.start}-${range.end}`} className="session-search__match">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

function isReadyContext(
  value: SessionSearchContextResult,
): value is Extract<SessionSearchContextResult, { outcome: "ready" | "relocated" }> {
  return value.outcome === "ready" || value.outcome === "relocated";
}

function ResultOption({
  result,
  selected,
  id,
  onSelect,
  onExpand,
}: {
  result: SessionSearchResult;
  selected: boolean;
  id: string;
  onSelect: () => void;
  onExpand: () => void;
}): React.ReactElement {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={`session-search__result${selected ? " session-search__result--selected" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
    >
      <FadeText className="session-search__result-name" title={result.sessionName}>
        {result.sessionName}
      </FadeText>
      <div className="session-search__metadata">
        <span>{result.role.replaceAll("-", " ")}</span>
        <span>{formatTime(result.timestamp)}</span>
        {result.worktreeName && <FadeText>{result.worktreeName}</FadeText>}
      </div>
      <div className="session-search__snippet">
        <HighlightedText text={result.snippet} ranges={result.matchRanges} />
      </div>
      <div className="session-search__metadata">
        {result.branchKind === "other-saved-branch" && <span>Other saved branch</span>}
        {result.additionalMatches > 0 && (
          <button
            type="button"
            className="session-search__additional"
            onClick={(event) => {
              event.stopPropagation();
              onExpand();
            }}
          >
            {result.additionalMatches} more matches in this session
          </button>
        )}
      </div>
    </div>
  );
}

function focusableChildren(element: HTMLElement): HTMLElement[] {
  return [
    ...element.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((candidate) => !candidate.hasAttribute("hidden"));
}

export function SessionSearchModal({
  onOpenResult,
}: SessionSearchModalProps): React.ReactElement | null {
  const state = useSessionSearchStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selectedOptionId = state.selectedTargetId
    ? `session-search-result-${state.selectedTargetId}`
    : undefined;
  useEscapeClaim(state.open);

  const close = useCallback(() => {
    const returnFocus = useSessionSearchStore.getState().returnFocus;
    useSessionSearchStore.getState().closeSearch();
    requestAnimationFrame(() => returnFocus?.focus());
  }, []);

  // Event subscription belongs to the modal lifetime, not App: no batch can
  // mutate this renderer after the search surface has gone away.
  useEffect(() => {
    if (!state.open) return;
    return window.pivis.on("sessionSearch.batch", (batch) => {
      useSessionSearchStore.getState().acceptBatch(batch);
    });
  }, [state.open]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      event.stopPropagation();
      const current = useSessionSearchStore.getState();
      if (current.open) {
        current.openSearch(current.workspacePath, current.returnFocus);
      } else {
        current.openSearch(
          useSessionsStore.getState().activeWorkspacePath,
          document.activeElement as HTMLElement | null,
        );
      }
    };
    window.addEventListener("keydown", onShortcut, true);
    return () => window.removeEventListener("keydown", onShortcut, true);
  }, []);

  // focusNonce intentionally retriggers selection for Cmd/Ctrl+Shift+F while open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusNonce is an imperative focus signal
  useEffect(() => {
    if (!state.open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [state.open, state.focusNonce]);

  useEffect(() => {
    if (!state.open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (state.narrowPane === "context" && window.matchMedia("(max-width: 760px)").matches) {
          state.setNarrowPane("results");
        } else {
          close();
        }
        return;
      }
      if (event.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const items = focusableChildren(dialog);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, state]);

  const select = useCallback(
    (targetId: SearchTargetId, preview = false) => {
      state.selectTarget(targetId);
      if (preview) state.setNarrowPane("context");
    },
    [state],
  );

  // Arrow navigation may move quickly. Resolve context only after selection
  // settles briefly, and fence the response again in the store.
  useEffect(() => {
    if (!state.open || !state.selectedTargetId) return;
    if (state.context.state === "loading" && state.context.targetId === state.selectedTargetId) {
      return;
    }
    if (state.context.state === "ready" && state.context.targetId === state.selectedTargetId) {
      return;
    }
    const targetId = state.selectedTargetId;
    const timer = setTimeout(() => {
      void useSessionSearchStore.getState().loadContext(targetId);
    }, 100);
    return () => clearTimeout(timer);
  }, [state.context, state.open, state.selectedTargetId]);

  const selectedIndex = useMemo(
    () => state.results.findIndex((result) => result.targetId === state.selectedTargetId),
    [state.results, state.selectedTargetId],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!state.results.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const index = Math.max(0, Math.min(state.results.length - 1, selectedIndex + delta));
      const target = state.results[index];
      if (target) select(target.targetId);
      return;
    }
    if (event.key === "Enter" && state.selectedTargetId) {
      event.preventDefault();
      select(state.selectedTargetId, true);
    }
  };

  const openSelected = (): void => {
    if (!onOpenResult) return;
    void state.openSelected(onOpenResult);
  };

  if (!state.open) return null;
  const context = state.context;
  const contextMatchesSelection =
    context.state === "idle" || context.targetId === state.selectedTargetId;
  const readyContext = context.state === "ready" && contextMatchesSelection ? context.value : null;
  const contextItems = readyContext && isReadyContext(readyContext) ? readyContext.items : [];
  const noWorkspace = !state.workspacePath;
  const workspaceName = state.workspacePath?.split("/").filter(Boolean).at(-1);
  const noResults = state.query.trim() && !state.loading && state.results.length === 0;

  return (
    <div
      className="session-search-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        className="session-search"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-search-title"
      >
        <header className="session-search__header">
          <div>
            <h2 id="session-search-title">
              {workspaceName ? `Search sessions in ${workspaceName}` : "Search saved sessions"}
            </h2>
            <FadeText
              className="session-search__workspace"
              head
              {...(state.workspacePath ? { title: state.workspacePath } : {})}
            >
              {state.workspacePath ?? "Add a workspace to search saved sessions."}
            </FadeText>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={close}
            aria-label="Close session search"
          >
            <IconClose />
          </button>
        </header>
        <div className="session-search__input-wrap">
          <IconSearch />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="Search saved sessions"
            aria-autocomplete="list"
            aria-expanded={state.results.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={selectedOptionId}
            value={state.query}
            placeholder="Search messages, errors, and session names…"
            disabled={noWorkspace}
            onChange={(event) => state.setQuery(event.currentTarget.value)}
            onCompositionStart={() => state.setComposing(true)}
            onCompositionEnd={(event) => {
              state.setComposing(false);
              state.setQuery(event.currentTarget.value);
            }}
            onKeyDown={onInputKeyDown}
          />
          {state.query && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear search"
              onClick={() => state.setQuery("")}
            >
              <IconClose />
            </button>
          )}
        </div>
        <div className={`session-search__body session-search__body--${state.narrowPane}`}>
          <section className="session-search__results-pane" aria-label="Search results">
            {!state.query && !noWorkspace && (
              <div className="session-search__empty">
                <strong>Search saved sessions</strong>
                <span>Find session names, messages, errors, and saved summaries.</span>
              </div>
            )}
            {state.error && (
              <div className="session-search__notice session-search__notice--error">
                <span>{state.error}</span>
                <button type="button" onClick={() => void state.rebuild()}>
                  Retry rebuild
                </button>
              </div>
            )}
            {noResults && (
              <div className="session-search__empty">
                {state.done
                  ? "No saved-session matches."
                  : "No matches yet — older sessions are still being indexed."}
              </div>
            )}
            <div
              id={listboxId}
              role="listbox"
              aria-label="Session search results"
              className="session-search__results"
            >
              {state.results.map((result) => (
                <ResultOption
                  key={result.targetId}
                  id={`session-search-result-${result.targetId}`}
                  result={result}
                  selected={result.targetId === state.selectedTargetId}
                  onSelect={() => select(result.targetId, true)}
                  onExpand={() => void state.expandSession(result.targetId)}
                />
              ))}
              {!state.done && state.results.length > 0 && (
                <button
                  type="button"
                  className="session-search__more"
                  disabled={state.loading}
                  onClick={() => void state.loadMore()}
                >
                  {state.loading ? "Searching…" : "Load more matches"}
                </button>
              )}
            </div>
          </section>
          <section className="session-search__context-pane" aria-label="Saved history context">
            <div className="session-search__context-header">
              <button
                type="button"
                className="icon-btn session-search__back"
                onClick={() => state.setNarrowPane("results")}
                aria-label="Return to results"
              >
                <IconChevronLeft />
              </button>
              <span>Saved history · Read-only</span>
              {onOpenResult && (
                <button
                  type="button"
                  className="session-search__open"
                  disabled={!state.selectedTargetId || state.openError === "Opening session…"}
                  onClick={openSelected}
                >
                  {state.openError === "Opening session…" ? "Opening…" : "Open session"}
                </button>
              )}
            </div>
            {state.openError && state.openError !== "Opening session…" && (
              <div className="session-search__notice session-search__notice--error">
                {state.openError}
              </div>
            )}
            {(context.state === "idle" || !contextMatchesSelection) && (
              <div className="session-search__empty">Select a result to inspect saved history.</div>
            )}
            {context.state === "loading" && contextMatchesSelection && (
              <div className="session-search__empty">Loading saved history…</div>
            )}
            {context.state === "error" && contextMatchesSelection && (
              <div className="session-search__notice session-search__notice--error">
                {context.message}
              </div>
            )}
            {readyContext && !isReadyContext(readyContext) && (
              <div className="session-search__notice">
                <span>{readyContext.message}</span>
                {(readyContext.outcome === "changed" || readyContext.outcome === "removed") && (
                  <div className="session-search__context-actions">
                    <button type="button" onClick={() => void state.startSearchNow()}>
                      Refresh result
                    </button>
                    <button type="button" onClick={() => state.setNarrowPane("results")}>
                      Return to results
                    </button>
                  </div>
                )}
              </div>
            )}
            {readyContext && isReadyContext(readyContext) && (
              <div className="session-search__context-items">
                {readyContext.branchKind === "other-saved-branch" && (
                  <div className="session-search__notice">
                    Other saved branch. Opening the session uses its current saved path.
                  </div>
                )}
                {readyContext.ancestryIncomplete && (
                  <div className="session-search__notice">Some saved history is unavailable.</div>
                )}
                {readyContext.hasEarlier && state.selectedTargetId && (
                  <button
                    type="button"
                    className="session-search__context-more"
                    onClick={() =>
                      void state.loadContext(state.selectedTargetId ?? undefined, {
                        before: state.contextBefore + 8,
                        after: state.contextAfter,
                      })
                    }
                  >
                    Load earlier saved context
                  </button>
                )}
                {contextItems.map((item) => (
                  <article
                    key={`${item.entryId}-${item.contentPartKey}`}
                    className={`session-search__context-item session-search__context-item--${item.role}${item.target ? " session-search__context-item--target" : ""}`}
                  >
                    <div className="session-search__metadata">
                      {item.role.replaceAll("-", " ")} · {formatTime(item.timestamp)}
                    </div>
                    <div>
                      <HighlightedText text={item.text} ranges={item.matchRanges} />
                    </div>
                  </article>
                ))}
                {readyContext.hasLater && state.selectedTargetId && (
                  <button
                    type="button"
                    className="session-search__context-more"
                    onClick={() =>
                      void state.loadContext(state.selectedTargetId ?? undefined, {
                        before: state.contextBefore,
                        after: state.contextAfter + 8,
                      })
                    }
                  >
                    Load later saved context
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
        <footer className="session-search__footer">
          <span aria-live="polite">
            {state.count ? `${state.count.value}${state.count.exact ? "" : "+"} matches` : ""}
          </span>
          {state.coverage && (
            <span>
              {state.loading
                ? `Indexing saved sessions — ${state.coverage.indexedSources} of ${state.coverage.totalSources}`
                : `${state.coverage.indexedSources} sessions searched`}
            </span>
          )}
          {state.coverage && state.coverage.skippedSources > 0 && (
            <span>{state.coverage.skippedSources} sessions could not be searched</span>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Convenience entry point for workspace buttons that retain their own focus. */
export function openSessionSearch(workspacePath: string, returnFocus: HTMLElement | null): void {
  useSessionSearchStore.getState().openSearch(workspacePath, returnFocus);
}
