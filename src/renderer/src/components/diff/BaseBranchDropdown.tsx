import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDiffStore } from "../../stores/diff-store.js";

function highlightMatch(text: string, query: string): React.ReactNode {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="diff-viewer__match">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function BaseBranchDropdown(): React.ReactElement {
  const branches = useDiffStore((s) => s.branches);
  const currentBranch = useDiffStore((s) => s.currentBranch);
  const selectedBase = useDiffStore((s) => s.selectedBase);
  const includeRemoteBranches = useDiffStore((s) => s.includeRemoteBranches);
  const setBase = useDiffStore((s) => s.setBase);
  const setIncludeRemoteBranches = useDiffStore((s) => s.setIncludeRemoteBranches);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Filtered branches
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return branches.filter((b) => {
      if (!q) return true;
      return b.name.toLowerCase().includes(q);
    });
  }, [branches, search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setHighlightedIndex(0);
      return;
    }
    setSearch("");
    setHighlightedIndex(0);
    setTimeout(() => searchInputRef.current?.focus(), 10);
  }, [open]);

  // Reset highlight on search change
  // biome-ignore lint/correctness/useExhaustiveDependencies: depends on search value, not on identity
  useEffect(() => {
    setHighlightedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    const btn = itemRefs.current.get(highlightedIndex);
    btn?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, [open]);

  // Build the ordered list: HEAD, filtered branches, checkbox row
  const allItems = useMemo(() => {
    type Item =
      | { type: "head" }
      | { type: "branch"; branch: (typeof branches)[number] }
      | { type: "checkbox" };
    const items: Item[] = [{ type: "head" }];
    for (const b of filtered) {
      if (!includeRemoteBranches && b.remote) continue;
      items.push({ type: "branch", branch: b });
    }
    items.push({ type: "checkbox" });
    return items;
  }, [filtered, includeRemoteBranches]);

  const handleSelect = useCallback(
    (base: string | null) => {
      setOpen(false);
      setBase(base);
    },
    [setBase],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          if (search) {
            setSearch("");
          } else {
            setOpen(false);
          }
          e.preventDefault();
          e.stopPropagation();
          break;
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setHighlightedIndex((i) => (i < allItems.length - 1 ? i + 1 : 0));
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setHighlightedIndex((i) => (i > 0 ? i - 1 : allItems.length - 1));
          break;
        case "Home":
          e.preventDefault();
          e.stopPropagation();
          setHighlightedIndex(0);
          break;
        case "End":
          e.preventDefault();
          e.stopPropagation();
          setHighlightedIndex(allItems.length - 1);
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          {
            const item = allItems[highlightedIndex];
            if (!item) break;
            if (item.type === "head") {
              handleSelect(null);
            } else if (item.type === "branch") {
              handleSelect(item.branch.name);
            } else if (item.type === "checkbox") {
              setIncludeRemoteBranches(!includeRemoteBranches);
            }
          }
          break;
      }
    },
    [
      search,
      allItems,
      highlightedIndex,
      handleSelect,
      includeRemoteBranches,
      setIncludeRemoteBranches,
    ],
  );

  const triggerLabel = selectedBase ?? "HEAD";

  return (
    <div className="diff-viewer__branch-picker" ref={dropdownRef}>
      <button
        type="button"
        className="diff-viewer__branch-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        {triggerLabel} ▾
      </button>
      {open && (
        <div className="diff-viewer__branch-dropdown">
          <div className="diff-viewer__branch-search">
            <input
              ref={searchInputRef}
              className="diff-viewer__branch-search-input"
              placeholder="Search branches…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              role="combobox"
              aria-expanded={open}
              aria-controls="branch-listbox"
              aria-autocomplete="list"
            />
          </div>
          {allItems.length === 0 ? (
            <div className="diff-viewer__branch-empty">No branches found</div>
          ) : (
            <div role="listbox" id="branch-listbox">
              {allItems.map((item, idx) => {
                if (item.type === "head") {
                  const active = idx === highlightedIndex;
                  return (
                    <button
                      key="__head__"
                      type="button"
                      ref={(el) => {
                        if (el) itemRefs.current.set(idx, el);
                        else itemRefs.current.delete(idx);
                      }}
                      role="option"
                      aria-selected={selectedBase === null}
                      className={`diff-viewer__branch-item${active ? " diff-viewer__branch-item--highlighted" : ""}${selectedBase === null ? " diff-viewer__branch-item--active" : ""}`}
                      onClick={() => handleSelect(null)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                    >
                      <span className="diff-viewer__branch-item-label">
                        {search ? highlightMatch("HEAD", search) : "HEAD"}
                      </span>
                      {selectedBase === null && (
                        <span className="diff-viewer__branch-check">✓</span>
                      )}
                    </button>
                  );
                }
                if (item.type === "checkbox") {
                  const active = idx === highlightedIndex;
                  return (
                    <div
                      key="__checkbox__"
                      role="option"
                      aria-selected={false}
                      className={`diff-viewer__branch-checkbox-row${active ? " diff-viewer__branch-item--highlighted" : ""}`}
                      onClick={() => setIncludeRemoteBranches(!includeRemoteBranches)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setIncludeRemoteBranches(!includeRemoteBranches);
                        }
                      }}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                    >
                      <label className="diff-viewer__branch-checkbox-label">
                        <input
                          type="checkbox"
                          checked={includeRemoteBranches}
                          onChange={() => setIncludeRemoteBranches(!includeRemoteBranches)}
                        />
                        <span>Include remote branches</span>
                      </label>
                    </div>
                  );
                }
                // branch item
                const b = item.branch;
                const active = idx === highlightedIndex;
                const selected = selectedBase === b.name;
                return (
                  <button
                    key={b.name}
                    type="button"
                    ref={(el) => {
                      if (el) itemRefs.current.set(idx, el);
                      else itemRefs.current.delete(idx);
                    }}
                    role="option"
                    aria-selected={selected}
                    className={`diff-viewer__branch-item${active ? " diff-viewer__branch-item--highlighted" : ""}${selected ? " diff-viewer__branch-item--active" : ""}`}
                    onClick={() => handleSelect(b.name)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                  >
                    <span className="diff-viewer__branch-item-label">
                      {search ? highlightMatch(b.name, search) : b.name}
                    </span>
                    {b.current && <span className="diff-viewer__branch-current">current</span>}
                    {selected && <span className="diff-viewer__branch-check">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
