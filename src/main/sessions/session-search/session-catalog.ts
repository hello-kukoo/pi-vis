import { createHash } from "node:crypto";
import { constants as fsConstants, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as yieldImmediate } from "node:timers/promises";
import { SessionHeaderSchema } from "@shared/session-file/entries.js";

/** Settings are injected: the catalog must not make the header's cwd authoritative. */
export interface SessionCatalogSettings {
  workspaceOrder: readonly string[];
  worktrees?: Readonly<
    Record<string, { workspacePath: string; branch: string; name: string; base: string }>
  >;
  archivedSessions?: readonly string[];
}

export type CatalogHealth = "healthy" | "unavailable" | "removed" | "invalid" | "forbidden";

export interface CatalogSource {
  canonicalPath: string;
  /** Canonical confinement root retained only in main/worker internals. */
  sessionsRoot: string;
  sessionId: string;
  headerCwd: string;
  workspacePath: string | null;
  worktree?: { path: string; branch: string; name: string; base: string };
  archived: boolean;
  sessionName: string | null;
  lastUserActivity: number | null;
  size: number;
  mtimeMs: number;
  device: number | null;
  inode: number | null;
  prefixFingerprint: string;
  sourceRevision: string;
  health: CatalogHealth;
}

export interface SessionCatalogOptions {
  /** Defaults to PIVIS_SESSIONS_DIR or ~/.pi/agent/sessions. */
  sessionsRoot?: string;
  getSettings: () => SessionCatalogSettings;
}

interface Metadata {
  sessionName: string | null;
  lastUserActivity: number | null;
}

function defaultRoot(): string {
  return process.env["PIVIS_SESSIONS_DIR"] ?? path.join(os.homedir(), ".pi", "agent", "sessions");
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function epoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readOnlyNoFollowFlags(): number {
  return fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
}

async function firstLine(handle: fs.FileHandle): Promise<string | null> {
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const value = buffer.subarray(0, bytesRead).toString("utf8");
    const end = value.indexOf("\n");
    return end < 0 ? value : value.slice(0, end);
  } catch {
    return null;
  }
}

const METADATA_SAMPLE_BYTES = 1024 * 1024;

async function metadata(handle: fs.FileHandle, size: number): Promise<Metadata> {
  // Cataloging must not duplicate the indexer's full corpus read. Sample a
  // bounded head/tail; the worker later derives the exact latest name while it
  // streams every persisted row for indexing.
  let text = "";
  try {
    if (size <= METADATA_SAMPLE_BYTES * 2) {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } else {
      const head = Buffer.alloc(METADATA_SAMPLE_BYTES);
      const tail = Buffer.alloc(METADATA_SAMPLE_BYTES);
      const headRead = await handle.read(head, 0, head.length, 0);
      const tailStart = size - tail.length;
      const tailRead = await handle.read(tail, 0, tail.length, tailStart);
      const headText = head.subarray(0, headRead.bytesRead).toString("utf8");
      const tailText = tail.subarray(0, tailRead.bytesRead).toString("utf8");
      text = `${headText.slice(0, headText.lastIndexOf("\n") + 1)}${tailText.slice(
        Math.max(0, tailText.indexOf("\n") + 1),
      )}`;
    }
  } catch {
    return { sessionName: null, lastUserActivity: null };
  }

  let sessionName: string | null = null;
  let lastUserActivity: number | null = null;
  let lineCount = 0;
  for (const line of text.split("\n")) {
    lineCount += 1;
    if (lineCount % 500 === 0) await yieldImmediate();
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type === "session_info" && typeof entry.name === "string" && entry.name) {
        sessionName = entry.name;
      }
      const message = entry.message as Record<string, unknown> | undefined;
      if (entry.type === "message" && message?.role === "user") {
        const at = epoch(entry.timestamp) ?? epoch(message.timestamp);
        if (at !== null && (lastUserActivity === null || at > lastUserActivity)) {
          lastUserActivity = at;
        }
      }
    } catch {
      // A sampled boundary or malformed row does not poison neighboring data.
    }
  }
  return { sessionName, lastUserActivity };
}

const RUNTIME_PIN_PATTERN = /^\.pivis-session-(\d+)-[0-9a-f-]+\.runtime-pin$/u;

async function reapStaleRuntimePin(candidate: string, name: string): Promise<void> {
  const match = RUNTIME_PIN_PATTERN.exec(name);
  if (!match) return;
  const owner = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isSafeInteger(owner) || owner <= 0 || owner === process.pid) return;
  try {
    process.kill(owner, 0);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
  }
  await fs.unlink(candidate).catch(() => {});
}

function priorityScore(candidate: string, priorityPaths: Iterable<string>): number {
  const compact = (value: string) => value.toLocaleLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, "");
  const normalizedCandidate = compact(candidate);
  let score = 0;
  for (const priority of priorityPaths) {
    const normalizedPriority = compact(priority);
    if (normalizedPriority && normalizedCandidate.includes(normalizedPriority)) score += 10_000;
    for (const component of priority.split(path.sep)) {
      const normalizedComponent = compact(component);
      if (normalizedComponent.length > 2 && normalizedCandidate.includes(normalizedComponent)) {
        score += normalizedComponent.length;
      }
    }
  }
  return score;
}

/** Streams fixed-size candidate batches without materializing directory entry arrays. */
interface CatalogPriorityState {
  paths: ReadonlySet<string>;
  version: number;
}

async function* pathsBelow(
  root: string,
  getPriorityState: () => CatalogPriorityState,
  onTraversalFailure: () => void,
): AsyncGenerator<string[]> {
  const priorityDirectories = [root];
  const ordinaryDirectories: string[] = [];
  let priorityCursor = 0;
  let ordinaryCursor = 0;
  let visitedEntries = 0;
  let observedPriorityVersion = -1;
  while (
    priorityCursor < priorityDirectories.length ||
    ordinaryCursor < ordinaryDirectories.length
  ) {
    const priorityState = getPriorityState();
    if (priorityState.version !== observedPriorityVersion) {
      observedPriorityVersion = priorityState.version;
      const rootScore = priorityScore(root, priorityState.paths);
      const retainedOrdinary: string[] = [];
      for (let index = ordinaryCursor; index < ordinaryDirectories.length; index++) {
        const candidate = ordinaryDirectories[index]!;
        if (priorityScore(candidate, priorityState.paths) > rootScore) {
          priorityDirectories.push(candidate);
        } else {
          retainedOrdinary.push(candidate);
        }
      }
      ordinaryDirectories.splice(ordinaryCursor, ordinaryDirectories.length, ...retainedOrdinary);
    }
    // Increment only the queue actually consumed. An ordinary ancestor may
    // discover a priority directory after the initial priority queue drained.
    const directory =
      priorityCursor < priorityDirectories.length
        ? priorityDirectories[priorityCursor++]!
        : ordinaryDirectories[ordinaryCursor++]!;
    let handle: Awaited<ReturnType<typeof fs.opendir>>;
    try {
      handle = await fs.opendir(directory);
    } catch {
      onTraversalFailure();
      continue;
    }
    let discovered: string[] = [];
    try {
      for await (const entry of handle) {
        visitedEntries += 1;
        if (visitedEntries % 128 === 0) await yieldImmediate();
        const candidate = path.join(directory, entry.name);
        // Do not recurse through directory symlinks. File symlinks are resolved
        // and subjected to the canonical containment check during inspection.
        if (entry.isDirectory()) {
          const currentPriority = getPriorityState();
          if (
            priorityScore(candidate, currentPriority.paths) >
            priorityScore(root, currentPriority.paths)
          ) {
            priorityDirectories.push(candidate);
          } else {
            ordinaryDirectories.push(candidate);
          }
        } else if (entry.name.endsWith(".jsonl")) {
          discovered.push(candidate);
          if (discovered.length === 16) {
            yield discovered;
            discovered = [];
          }
        } else {
          await reapStaleRuntimePin(candidate, entry.name);
        }
      }
    } catch {
      onTraversalFailure();
    }
    if (discovered.length > 0) yield discovered;
  }
}

/**
 * Security boundary for persisted-session search. It owns no registry or host
 * dependency: a source belongs to a workspace only through current settings.
 */
export class SessionCatalog {
  private readonly rootInput: string;
  private canonicalRoot: string | null = null;
  private sources = new Map<string, CatalogSource>();
  private scannedCandidates = 0;
  private skippedCandidates = 0;
  private activePriorityState: { paths: Set<string>; version: number } | null = null;
  private readonly classificationPathCache = new Map<string, string>();

  constructor(private readonly options: SessionCatalogOptions) {
    this.rootInput = options.sessionsRoot ?? defaultRoot();
  }

  prioritize(workspacePath: string): void {
    const active = this.activePriorityState;
    if (!active || active.paths.has(workspacePath)) return;
    active.paths.add(workspacePath);
    active.version += 1;
  }

  async refresh(
    options: {
      priorityWorkspacePaths?: readonly string[];
      onDiscovered?: (sources: readonly CatalogSource[]) => Promise<void>;
    } = {},
  ): Promise<readonly CatalogSource[]> {
    this.classificationPathCache.clear();
    try {
      this.canonicalRoot = await fs.realpath(this.rootInput);
      if (!(await fs.stat(this.canonicalRoot)).isDirectory()) {
        this.sources.clear();
        this.scannedCandidates = 0;
        this.skippedCandidates = 0;
        return [];
      }
    } catch {
      this.canonicalRoot = null;
      this.sources.clear();
      this.scannedCandidates = 0;
      this.skippedCandidates = 0;
      return [];
    }

    const priorityState = {
      paths: new Set(options.priorityWorkspacePaths ?? []),
      version: 0,
    };
    this.activePriorityState = priorityState;
    const previousComplete = new Map(this.sources);
    const next = new Map<string, CatalogSource>();
    const retiredDuringRefresh = new Set<string>();
    this.scannedCandidates = 0;
    this.skippedCandidates = 0;
    // Publish each bounded inspection batch. On a warm scan, retain the prior
    // complete snapshot until deletion has been authoritatively confirmed at
    // the end; query authority must never collapse to only the current batch.
    // A requested workspace can still be promoted to worker indexing early.
    for await (const candidates of pathsBelow(
      this.canonicalRoot,
      () => priorityState,
      () => {
        this.skippedCandidates += 1;
      },
    )) {
      this.scannedCandidates += candidates.length;
      const inspected = await Promise.all(candidates.map((candidate) => this.inspect(candidate)));
      const newlyDiscovered: CatalogSource[] = [];
      for (const source of inspected) {
        if (source) {
          next.set(source.canonicalPath, source);
          retiredDuringRefresh.delete(source.canonicalPath);
          if (source.health === "healthy" && !previousComplete.has(source.canonicalPath)) {
            newlyDiscovered.push(source);
          }
        } else {
          this.skippedCandidates += 1;
        }
      }

      // A concurrent known-source pass may append, replace, or remove records
      // while this full traversal awaits I/O/worker indexing. Detect removals
      // before rebuilding the published union and overlay newer revisions.
      const currentBeforePublish = this.sources;
      for (const canonicalPath of previousComplete.keys()) {
        if (!currentBeforePublish.has(canonicalPath)) retiredDuringRefresh.add(canonicalPath);
      }
      const published = new Map<string, CatalogSource>();
      for (const [canonicalPath, source] of previousComplete) {
        if (!retiredDuringRefresh.has(canonicalPath)) published.set(canonicalPath, source);
      }
      for (const [canonicalPath, source] of next) published.set(canonicalPath, source);
      for (const [canonicalPath, source] of currentBeforePublish) {
        const previous = previousComplete.get(canonicalPath);
        const inspected = next.get(canonicalPath);
        // Do not overwrite a freshly inspected warm source with the old
        // complete snapshot. Only a revision that changed since refresh start
        // can be a newer concurrent known-source observation.
        if (
          published.has(canonicalPath) &&
          (!inspected || (previous && source.sourceRevision !== previous.sourceRevision))
        ) {
          published.set(canonicalPath, source);
        }
      }
      this.sources = published;
      if (newlyDiscovered.length > 0) await options.onDiscovered?.(newlyDiscovered);

      // Preserve concurrent known-source updates in the eventual complete map,
      // and remember concurrent removals so the next union cannot resurrect.
      const currentAfterPublish = this.sources;
      for (const canonicalPath of published.keys()) {
        if (!currentAfterPublish.has(canonicalPath)) retiredDuringRefresh.add(canonicalPath);
      }
      for (const current of currentAfterPublish.values()) {
        const previous = previousComplete.get(current.canonicalPath);
        if (
          next.has(current.canonicalPath) &&
          previous &&
          current.sourceRevision !== previous.sourceRevision
        ) {
          next.set(current.canonicalPath, current);
        }
      }
    }
    for (const canonicalPath of retiredDuringRefresh) next.delete(canonicalPath);
    for (const current of this.sources.values()) {
      const previous = previousComplete.get(current.canonicalPath);
      if (
        next.has(current.canonicalPath) &&
        previous &&
        current.sourceRevision !== previous.sourceRevision
      ) {
        next.set(current.canonicalPath, current);
      }
    }
    this.sources = next;
    if (this.activePriorityState === priorityState) this.activePriorityState = null;
    return this.list();
  }

  /**
   * Stats already-discovered paths and fully re-inspects only changed sources.
   * This is the fast completed-append path used while search is open.
   */
  async refreshKnownChanges(): Promise<{
    sources: readonly CatalogSource[];
    changedSources: readonly CatalogSource[];
    changed: boolean;
  }> {
    const current = [...this.sources.values()];
    if (current.length === 0) {
      return { sources: this.list(), changedSources: [], changed: false };
    }
    const updates = new Map<string, { snapshotRevision: string; inspected: CatalogSource }>();
    const removals = new Map<string, string>();
    let changed = false;
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(16, current.length) },
      async (): Promise<void> => {
        while (cursor < current.length) {
          const source = current[cursor++]!;
          let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
          try {
            stat = await fs.stat(source.canonicalPath);
          } catch {}
          if (
            stat?.isFile() &&
            stat.size === source.size &&
            stat.mtimeMs === source.mtimeMs &&
            stat.dev === source.device &&
            stat.ino === source.inode
          ) {
            continue;
          }
          changed = true;
          const inspected = await this.inspect(source.canonicalPath);
          if (inspected) {
            updates.set(inspected.canonicalPath, {
              snapshotRevision: source.sourceRevision,
              inspected,
            });
          } else {
            removals.set(source.canonicalPath, source.sourceRevision);
          }
        }
      },
    );
    await Promise.all(workers);
    const changedSources: CatalogSource[] = [];
    if (changed) {
      // Apply only per-path deltas to the latest map. A concurrent full refresh
      // may have discovered/deleted unrelated paths or inspected a newer
      // revision while this stat pass was awaiting I/O.
      const merged = new Map(this.sources);
      for (const [canonicalPath, update] of updates) {
        const latest = merged.get(canonicalPath);
        if (!latest) {
          // A concurrent full refresh finalized deletion of this same path.
          // Its tombstone wins over a delayed descriptor inspection.
          continue;
        }
        if (
          latest.sourceRevision === update.snapshotRevision ||
          latest.sourceRevision === update.inspected.sourceRevision
        ) {
          merged.set(canonicalPath, update.inspected);
          changedSources.push(update.inspected);
        } else {
          changedSources.push(latest);
        }
      }
      for (const [canonicalPath, snapshotRevision] of removals) {
        if (merged.get(canonicalPath)?.sourceRevision === snapshotRevision) {
          merged.delete(canonicalPath);
        }
      }
      this.sources = merged;
    }
    return { sources: this.list(), changedSources, changed };
  }

  /** Reapplies current ownership and archive settings on every call. */
  list(): readonly CatalogSource[] {
    return [...this.sources.values()]
      .map((source) => this.classify(source))
      .sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
  }

  coverage(): { indexedSources: number; totalSources: number; skippedSources: number } {
    const indexedSources = this.list().filter((source) => source.health === "healthy").length;
    return {
      indexedSources,
      totalSources: Math.max(this.scannedCandidates, indexedSources + this.skippedCandidates),
      skippedSources: this.skippedCandidates,
    };
  }

  /** Archived sources are intentionally retained by list(), but not queryable. */
  sourcesForWorkspace(workspacePath: string): readonly CatalogSource[] {
    return this.list().filter(
      (source) =>
        source.health === "healthy" && source.workspacePath === workspacePath && !source.archived,
    );
  }

  /**
   * Re-inspects the path instead of trusting the cached record. This is used by
   * context/open authority and catches replacement, deletion, and ownership changes.
   */
  async revalidate(canonicalPath: string, workspacePath: string): Promise<CatalogSource | null> {
    const source = await this.inspect(canonicalPath);
    if (!source) return null;
    const classified = this.classify(source);
    if (classified.health !== "healthy" || classified.workspacePath !== workspacePath) return null;
    this.sources.set(classified.canonicalPath, classified);
    return classified;
  }

  private classify(source: CatalogSource): CatalogSource {
    const settings = this.options.getSettings();
    const canonical = (candidate: string): string => {
      const cached = this.classificationPathCache.get(candidate);
      if (cached) return cached;
      let value: string;
      try {
        value = realpathSync(candidate);
      } catch {
        value = path.resolve(candidate);
      }
      this.classificationPathCache.set(candidate, value);
      return value;
    };
    const headerCwd = canonical(source.headerCwd);
    const direct =
      settings.workspaceOrder.find((workspacePath) => canonical(workspacePath) === headerCwd) ??
      null;
    const worktreeEntry = Object.entries(settings.worktrees ?? {}).find(
      ([worktreePath]) => canonical(worktreePath) === headerCwd,
    );
    const worktree = worktreeEntry?.[1];
    // A worktree only has authority when both its parent is still registered and
    // its persisted map points exactly at the canonical untrusted header cwd.
    const parentWorkspace = worktree
      ? settings.workspaceOrder.find(
          (workspacePath) => canonical(workspacePath) === canonical(worktree.workspacePath),
        )
      : undefined;
    const ownedWorktree =
      !direct && worktree && parentWorkspace
        ? {
            path: worktreeEntry?.[0] ?? source.headerCwd,
            ...worktree,
            workspacePath: parentWorkspace,
          }
        : undefined;
    const archived = new Set((settings.archivedSessions ?? []).map(canonical));
    const { worktree: _previousWorktree, ...base } = source;
    return {
      ...base,
      workspacePath: direct ?? ownedWorktree?.workspacePath ?? null,
      ...(ownedWorktree ? { worktree: ownedWorktree } : {}),
      archived: archived.has(canonical(source.canonicalPath)),
    };
  }

  private async inspect(candidate: string): Promise<CatalogSource | null> {
    if (!this.canonicalRoot) return null;
    let handle: fs.FileHandle | undefined;
    try {
      let canonicalPath = await fs.realpath(candidate);
      if (!contained(this.canonicalRoot, canonicalPath) || path.extname(canonicalPath) !== ".jsonl")
        return null;

      handle = await fs.open(canonicalPath, readOnlyNoFollowFlags());
      const descriptorStat = await handle.stat();
      if (!descriptorStat.isFile()) return null;

      // O_NOFOLLOW covers only the final component. Bind containment to the
      // descriptor actually read by checking the post-open path identity too.
      canonicalPath = await fs.realpath(canonicalPath);
      if (!contained(this.canonicalRoot, canonicalPath) || path.extname(canonicalPath) !== ".jsonl")
        return null;
      const pathStat = await fs.stat(canonicalPath);
      if (pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino) return null;

      const line = await firstLine(handle);
      if (!line) return null;
      let header: ReturnType<typeof SessionHeaderSchema.safeParse>;
      try {
        header = SessionHeaderSchema.safeParse(JSON.parse(line));
      } catch {
        return null;
      }
      if (!header.success) return null;

      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const prefix = createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
      const device = typeof descriptorStat.dev === "number" ? descriptorStat.dev : null;
      const inode = typeof descriptorStat.ino === "number" ? descriptorStat.ino : null;
      const cached = this.sources.get(canonicalPath);
      if (
        cached &&
        cached.size === descriptorStat.size &&
        cached.mtimeMs === descriptorStat.mtimeMs &&
        cached.device === device &&
        cached.inode === inode &&
        cached.prefixFingerprint === prefix
      ) {
        return this.classify(cached);
      }
      const meta = await metadata(handle, descriptorStat.size);
      const sourceRevision = `${descriptorStat.size}:${descriptorStat.mtimeMs}:${device ?? ""}:${inode ?? ""}:${prefix}`;
      return this.classify({
        canonicalPath,
        sessionsRoot: this.canonicalRoot,
        sessionId: header.data.id,
        headerCwd: header.data.cwd,
        workspacePath: null,
        archived: false,
        sessionName: meta.sessionName,
        lastUserActivity: meta.lastUserActivity,
        size: descriptorStat.size,
        mtimeMs: descriptorStat.mtimeMs,
        device,
        inode,
        prefixFingerprint: prefix,
        sourceRevision,
        health: "healthy",
      });
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }
}
