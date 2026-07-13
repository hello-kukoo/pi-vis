import fs from "node:fs/promises";
import { SessionEntrySchema, SessionHeaderSchema } from "@shared/session-file/entries.js";
import type {
  SearchMatchRange,
  SearchTargetId,
  SessionSearchContextItem,
  SessionSearchRole,
} from "@shared/session-search.js";
import {
  MAX_SESSION_SEARCH_SEGMENT_BYTES,
  type SearchableSegment,
  extractSearchSegments,
  streamJsonlRows,
} from "./entry-extractor.js";
import type { CatalogSource } from "./session-catalog.js";
import { buildSessionGraph } from "./session-graph.js";
import { findOriginalMatchRanges } from "./snippet.js";

/** Main-process-only authority resolved from an opaque renderer capability. */
export interface ResolvedContextTarget {
  targetId?: SearchTargetId;
  canonicalPath: string;
  workspacePath: string;
  sourceRevision: string;
  headerSessionId: string;
  entryOrdinal: number;
  /** Descriptor-bound persisted row range retained only by main/worker. */
  byteStart?: number;
  byteEnd?: number;
  entryId: string;
  contentPartKey: string;
  /** Which repeated query occurrence in this persisted content part matched. */
  occurrence: number;
  /** SHA-256 of the authoritative complete persisted content part. */
  digest: string;
  branchKind?: "latest-persisted-path" | "other-saved-branch";
  /** Exact UTF-16 source ranges retained from index retrieval. */
  sourceMatchRanges?: SearchMatchRange[];
  /** Compatibility evidence for callers that cannot retain source ranges. */
  matchText?: string;
}

export interface ContextCatalog {
  revalidate(canonicalPath: string, workspacePath: string): Promise<CatalogSource | null>;
}

export interface ContextLoadOptions {
  before?: number;
  after?: number;
}

export type ContextLoadResult =
  | {
      outcome: "ready" | "relocated";
      targetId?: SearchTargetId;
      sourceRevision: string;
      sessionName: string;
      worktreeName?: string;
      branchKind: "latest-persisted-path" | "other-saved-branch";
      items: SessionSearchContextItem[];
      ancestryIncomplete: boolean;
      hasEarlier: boolean;
      hasLater: boolean;
    }
  | { outcome: "changed" | "removed" | "forbidden" | "unavailable"; message: string };

interface EntryIndex {
  id: string;
  parentId?: string;
  fileOrdinal: number;
  segmentCount: number;
  targetSegmentIndex: number;
}

type ContextRole = SessionSearchRole;

const MAX_CONTEXT_RESULT_BYTES = 256 * 1024;
const MAX_CONTEXT_GRAPH_ENTRIES = 100_000;
const MAX_CONTEXT_GRAPH_METADATA_BYTES = 32 * 1024 * 1024;

interface ContextWorkLimits {
  graphEntries: number;
  graphMetadataBytes: number;
}

const DEFAULT_CONTEXT_WORK_LIMITS: ContextWorkLimits = {
  graphEntries: MAX_CONTEXT_GRAPH_ENTRIES,
  graphMetadataBytes: MAX_CONTEXT_GRAPH_METADATA_BYTES,
};

function extractedForRow(row: {
  fileOrdinal: number;
  byteStart: number;
  byteEnd: number;
  value: Record<string, unknown>;
}): { id: string; parentId?: string; segments: SearchableSegment[] } | null {
  const parsed = SessionEntrySchema.safeParse(row.value);
  if (!parsed.success) return null;
  const raw = parsed.data as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (!id) return null;
  return {
    id,
    ...(typeof raw.parentId === "string" ? { parentId: raw.parentId } : {}),
    segments: extractSearchSegments(raw, {
      fileOrdinal: row.fileOrdinal,
      byteStart: row.byteStart,
      byteEnd: row.byteEnd,
    }).filter(
      (segment) =>
        Buffer.byteLength(segment.originalText, "utf8") <= MAX_SESSION_SEARCH_SEGMENT_BYTES,
    ),
  };
}

async function readEntryIndex(
  file: string,
  confinementRoot: string,
  target: ResolvedContextTarget,
  limits: ContextWorkLimits,
  yieldToPriority?: (() => Promise<void>) | undefined,
  descriptor?: number,
): Promise<{ entries: EntryIndex[]; limitExceeded: boolean }> {
  const entries: EntryIndex[] = [];
  const ids = new Set<string>();
  let metadataBytes = 0;
  for await (const row of streamJsonlRows(file, {
    indexingMode: true,
    confinementRoot,
    ...(descriptor === undefined ? {} : { descriptor }),
  })) {
    if (row.fileOrdinal === 1) continue;
    const extracted = extractedForRow(row);
    if (!extracted || ids.has(extracted.id)) continue;
    ids.add(extracted.id);
    const targetSegmentIndex = extracted.segments.findIndex(
      (segment) =>
        extracted.id === target.entryId &&
        segment.contentPartKey === target.contentPartKey &&
        segment.digest === target.digest,
    );
    entries.push({
      id: extracted.id,
      ...(extracted.parentId ? { parentId: extracted.parentId } : {}),
      fileOrdinal: row.fileOrdinal,
      segmentCount: extracted.segments.length,
      targetSegmentIndex,
    });
    metadataBytes +=
      Buffer.byteLength(extracted.id, "utf8") +
      Buffer.byteLength(extracted.parentId ?? "", "utf8") +
      64;
    if (entries.length % 500 === 0) await yieldToPriority?.();
    if (entries.length >= limits.graphEntries || metadataBytes >= limits.graphMetadataBytes) {
      return { entries, limitExceeded: true };
    }
  }
  return { entries, limitExceeded: false };
}

async function readSelectedSegments(
  file: string,
  confinementRoot: string,
  selectedOrdinals: ReadonlySet<number>,
  yieldToPriority?: (() => Promise<void>) | undefined,
  descriptor?: number,
): Promise<Map<number, SearchableSegment[]>> {
  const selected = new Map<number, SearchableSegment[]>();
  const lastSelectedOrdinal = Math.max(0, ...selectedOrdinals);
  for await (const row of streamJsonlRows(file, {
    indexingMode: true,
    confinementRoot,
    ...(descriptor === undefined ? {} : { descriptor }),
  })) {
    if (row.fileOrdinal > lastSelectedOrdinal) break;
    if (row.fileOrdinal % 500 === 0) await yieldToPriority?.();
    if (!selectedOrdinals.has(row.fileOrdinal)) continue;
    const extracted = extractedForRow(row);
    if (extracted) selected.set(row.fileOrdinal, extracted.segments);
  }
  return selected;
}

function ancestorChain(
  entries: readonly EntryIndex[],
  target: EntryIndex,
): { chain: EntryIndex[]; incomplete: boolean } {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reverse: EntryIndex[] = [];
  const seen = new Set<string>();
  let current: EntryIndex | undefined = target;
  let incomplete = false;
  while (current) {
    if (seen.has(current.id)) {
      incomplete = true;
      break;
    }
    seen.add(current.id);
    reverse.push(current);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
    if (!current) incomplete = true;
  }
  return { chain: reverse.reverse(), incomplete };
}

function appendDeterministicFollowing(
  entries: readonly EntryIndex[],
  start: EntryIndex,
  chain: EntryIndex[],
): void {
  const children = new Map<string, EntryIndex[]>();
  for (const entry of entries) {
    if (!entry.parentId) continue;
    const existing = children.get(entry.parentId) ?? [];
    existing.push(entry);
    children.set(entry.parentId, existing);
  }
  const seen = new Set(chain.map((entry) => entry.id));
  let current: EntryIndex | undefined = start;
  while (current) {
    const choices = (children.get(current.id) ?? [])
      .filter((entry) => !seen.has(entry.id))
      .sort(
        (left, right) => left.fileOrdinal - right.fileOrdinal || left.id.localeCompare(right.id),
      );
    const next = choices.at(-1);
    if (!next) break;
    seen.add(next.id);
    chain.push(next);
    current = next;
  }
}

function safeTargetRanges(target: ResolvedContextTarget, text: string): SearchMatchRange[] {
  const retained = (target.sourceMatchRanges ?? []).filter(
    (range) => range.start >= 0 && range.end > range.start && range.end <= text.length,
  );
  if (retained.length) return retained;
  if (!target.matchText) return [];
  const all = findOriginalMatchRanges(text, target.matchText);
  const selected = all[target.occurrence];
  return selected ? [selected] : [];
}

function selectedEntryOrdinals(
  chain: readonly EntryIndex[],
  target: EntryIndex,
  before: number,
  after: number,
): { ordinals: Set<number>; hasEarlier: boolean; hasLater: boolean } {
  const targetEntryIndex = chain.findIndex(
    (entry) => entry.id === target.id && entry.fileOrdinal === target.fileOrdinal,
  );
  let targetFlatIndex = Math.max(0, target.targetSegmentIndex);
  for (let index = 0; index < targetEntryIndex; index++) {
    targetFlatIndex += chain[index]?.segmentCount ?? 0;
  }
  const total = chain.reduce((sum, entry) => sum + entry.segmentCount, 0);
  const start = Math.max(0, targetFlatIndex - before);
  const end = Math.min(total, targetFlatIndex + after + 1);
  const ordinals = new Set<number>();
  let cursor = 0;
  for (const entry of chain) {
    const next = cursor + entry.segmentCount;
    if (next > start && cursor < end) ordinals.add(entry.fileOrdinal);
    cursor = next;
  }
  return { ordinals, hasEarlier: start > 0, hasLater: end < total };
}

/**
 * Exact saved-history context. It never imports SessionRegistry/SDK-host code
 * and never emits live TranscriptBlocks, so preview cannot mutate runtime UI.
 * The first pass retains graph metadata only; a second pass materializes text
 * for the bounded context window, never a complete large transcript.
 */
export class ContextLoader {
  constructor(
    private readonly catalog: ContextCatalog,
    private readonly limits: ContextWorkLimits = DEFAULT_CONTEXT_WORK_LIMITS,
    private readonly yieldToPriority?: (() => Promise<void>) | undefined,
  ) {}

  async load(
    target: ResolvedContextTarget,
    options: ContextLoadOptions = {},
    descriptor?: number,
  ): Promise<ContextLoadResult> {
    const before = Math.min(Math.max(options.before ?? 4, 0), 20);
    const after = Math.min(Math.max(options.after ?? 4, 0), 20);
    const source = await this.catalog.revalidate(target.canonicalPath, target.workspacePath);
    if (!source) {
      try {
        await fs.stat(target.canonicalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { outcome: "removed", message: "The saved session was removed." };
        }
        return { outcome: "unavailable", message: "The saved session could not be read." };
      }
      return { outcome: "forbidden", message: "The workspace or source is no longer available." };
    }
    if (source.archived) {
      return { outcome: "forbidden", message: "The saved session is archived." };
    }
    if (source.sessionId !== target.headerSessionId) {
      return { outcome: "changed", message: "This session changed after the result was found." };
    }

    let entries: EntryIndex[];
    try {
      const indexed = await readEntryIndex(
        source.canonicalPath,
        source.sessionsRoot,
        target,
        this.limits,
        this.yieldToPriority,
        descriptor,
      );
      if (indexed.limitExceeded) {
        return {
          outcome: "unavailable",
          message: "This saved session is too large to preview safely.",
        };
      }
      entries = indexed.entries;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? { outcome: "removed", message: "The saved session was removed." }
        : { outcome: "unavailable", message: "The saved session could not be read." };
    }

    const entry =
      entries.find(
        (candidate) =>
          candidate.id === target.entryId && candidate.fileOrdinal === target.entryOrdinal,
      ) ?? entries.find((candidate) => candidate.id === target.entryId);
    if (!entry || entry.targetSegmentIndex < 0) {
      return source.sourceRevision === target.sourceRevision
        ? { outcome: "unavailable", message: "The saved match is unavailable." }
        : { outcome: "changed", message: "This session changed after the result was found." };
    }

    const { chain, incomplete } = ancestorChain(entries, entry);
    appendDeterministicFollowing(entries, entry, chain);
    const selectedWindow = selectedEntryOrdinals(chain, entry, before, after);
    let byOrdinal: Map<number, SearchableSegment[]>;
    try {
      byOrdinal = await readSelectedSegments(
        source.canonicalPath,
        source.sessionsRoot,
        selectedWindow.ordinals,
        this.yieldToPriority,
        descriptor,
      );
    } catch {
      return { outcome: "unavailable", message: "The saved session could not be read." };
    }
    const flattened = chain.flatMap((candidate) => byOrdinal.get(candidate.fileOrdinal) ?? []);
    const targetIndex = flattened.findIndex(
      (candidate) =>
        candidate.entryId === entry.id &&
        candidate.fileOrdinal === entry.fileOrdinal &&
        candidate.contentPartKey === target.contentPartKey &&
        candidate.digest === target.digest,
    );
    if (targetIndex < 0) {
      return { outcome: "changed", message: "This session changed after the result was found." };
    }
    const targetSegment = flattened[targetIndex]!;
    const requestedStart = Math.max(0, targetIndex - before);
    const requestedEnd = Math.min(flattened.length, targetIndex + after + 1);
    let start = requestedStart;
    let end = requestedEnd;
    let contextBytes = flattened
      .slice(start, end)
      .reduce((sum, candidate) => sum + Buffer.byteLength(candidate.originalText, "utf8") + 512, 0);
    while (contextBytes > MAX_CONTEXT_RESULT_BYTES && end - start > 1) {
      const removeBefore = targetIndex - start >= end - targetIndex - 1;
      const index = removeBefore && start < targetIndex ? start++ : --end;
      contextBytes -= Buffer.byteLength(flattened[index]?.originalText ?? "", "utf8") + 512;
    }
    const graph = buildSessionGraph(entries);
    const branchKind = graph.latestPersistedPathIds.has(targetSegment.entryId)
      ? "latest-persisted-path"
      : "other-saved-branch";
    const isTarget = (candidate: SearchableSegment): boolean =>
      candidate.entryId === targetSegment.entryId &&
      candidate.fileOrdinal === targetSegment.fileOrdinal &&
      candidate.contentPartKey === targetSegment.contentPartKey &&
      candidate.digest === targetSegment.digest;

    return {
      outcome: source.sourceRevision === target.sourceRevision ? "ready" : "relocated",
      ...(target.targetId ? { targetId: target.targetId } : {}),
      sourceRevision: source.sourceRevision,
      sessionName: source.sessionName ?? source.sessionId,
      ...(source.worktree ? { worktreeName: source.worktree.name } : {}),
      branchKind,
      items: flattened.slice(start, end).map((candidate) => ({
        entryId: candidate.entryId,
        contentPartKey: candidate.contentPartKey,
        role: candidate.role as ContextRole,
        timestamp: candidate.timestamp,
        text: candidate.originalText,
        target: isTarget(candidate),
        matchRanges: isTarget(candidate) ? safeTargetRanges(target, candidate.originalText) : [],
      })),
      ancestryIncomplete: incomplete,
      hasEarlier: selectedWindow.hasEarlier || start > requestedStart,
      hasLater: selectedWindow.hasLater || end < requestedEnd,
    };
  }
}

async function validateDescriptorHeader(
  source: CatalogSource,
  descriptor: number,
): Promise<boolean> {
  try {
    for await (const row of streamJsonlRows(source.canonicalPath, {
      indexingMode: true,
      includeSkipped: true,
      descriptor,
    })) {
      if (row.fileOrdinal !== 1 || row.skippedReason) return false;
      const header = SessionHeaderSchema.safeParse(row.value);
      return (
        header.success &&
        header.data.id === source.sessionId &&
        header.data.cwd === source.headerCwd
      );
    }
  } catch {
    return false;
  }
  return false;
}

/** Bounded worker-side exact-content validation for explicit opening. */
export async function validateExactTarget(
  source: CatalogSource,
  target: ResolvedContextTarget,
  descriptor?: number,
): Promise<boolean> {
  if (target.byteStart === undefined || target.byteEnd === undefined) return false;
  if (descriptor !== undefined && !(await validateDescriptorHeader(source, descriptor))) {
    return false;
  }
  try {
    for await (const row of streamJsonlRows(source.canonicalPath, {
      indexingMode: true,
      startOffset: target.byteStart,
      startingOrdinal: target.entryOrdinal - 1,
      confinementRoot: source.sessionsRoot,
      ...(descriptor === undefined ? {} : { descriptor }),
    })) {
      if (
        row.fileOrdinal !== target.entryOrdinal ||
        row.byteStart !== target.byteStart ||
        row.byteEnd !== target.byteEnd
      ) {
        return false;
      }
      const extracted = extractedForRow(row);
      if (!extracted || extracted.id !== target.entryId) return false;
      return extracted.segments.some(
        (segment) =>
          segment.contentPartKey === target.contentPartKey && segment.digest === target.digest,
      );
    }
  } catch {
    return false;
  }
  return false;
}

/** Worker entry after main has revalidated scope and source identity. */
export async function loadContextFromValidatedSource(
  source: CatalogSource,
  target: ResolvedContextTarget,
  options: ContextLoadOptions = {},
  yieldToPriority?: (() => Promise<void>) | undefined,
  descriptor?: number,
): Promise<ContextLoadResult> {
  if (descriptor !== undefined && !(await validateDescriptorHeader(source, descriptor))) {
    return { outcome: "changed", message: "This session changed after the result was found." };
  }
  return new ContextLoader(
    {
      revalidate: async (canonicalPath, workspacePath) =>
        canonicalPath === source.canonicalPath && workspacePath === source.workspacePath
          ? source
          : null,
    },
    DEFAULT_CONTEXT_WORK_LIMITS,
    yieldToPriority,
  ).load(target, options, descriptor);
}
