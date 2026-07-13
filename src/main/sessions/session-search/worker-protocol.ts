import type { SessionSearchCoverage, SessionSearchRole } from "@shared/session-search.js";
import type {
  ContextLoadOptions,
  ContextLoadResult,
  ResolvedContextTarget,
} from "./context-loader.js";
import type { CatalogSource } from "./session-catalog.js";

export interface SearchWorkerSource {
  canonicalPath: string;
  sessionsRoot: string;
  sessionId: string;
  workspacePath: string;
  worktreeName?: string;
  archived: boolean;
  sessionName: string;
  size: number;
  mtimeMs: number;
  device?: number;
  inode?: number;
  prefixFingerprint: string;
  /** Catalog-computed revision shared with exact context validation. */
  sourceRevision: string;
}

export interface SearchWorkerMatch {
  sourcePath: string;
  sourceRevision: string;
  workspacePath: string;
  sessionId: string;
  sessionName: string;
  worktreeName?: string;
  entryOrdinal: number;
  byteStart: number;
  byteEnd: number;
  entryId: string;
  contentPartKey: string;
  occurrence: number;
  contentDigest: string;
  role: SessionSearchRole;
  timestamp: number | null;
  snippet: string;
  /** UTF-16 ranges in the bounded snippet sent to the renderer. */
  matchRanges: Array<{ start: number; end: number }>;
  /** Exact UTF-16 ranges in the persisted segment, retained only by main. */
  sourceMatchRanges: Array<{ start: number; end: number }>;
  latestPersistedPath: boolean;
  additionalMatches: number;
  score: number;
  closeMatchTerm?: string;
}

export type SearchWorkerRequest =
  | {
      id: number;
      type: "initialize";
      databaseDirectory: string;
    }
  | {
      id: number;
      type: "reconcile";
      sources: SearchWorkerSource[];
      /** False for a streamed cold-catalog prefix; do not delete absent rows. */
      completeCatalog?: boolean;
    }
  | {
      id: number;
      type: "query";
      workspacePath: string;
      query: string;
      offset: number;
      limit: number;
      pinnedSourcePaths: string[];
      /** Main-resolved paths only; never sourced directly from renderer input. */
      expandedSourcePaths: string[];
      /** Current catalog authority; settings/archive changes apply to every query. */
      allowedSourcePaths: string[];
    }
  | {
      id: number;
      type: "context";
      source: CatalogSource;
      target: ResolvedContextTarget;
      options: ContextLoadOptions;
      /** Process fd retained by main for descriptor-bound explicit-open relocation. */
      sourceDescriptor?: number;
    }
  | {
      id: number;
      type: "validate";
      source: CatalogSource;
      target: ResolvedContextTarget;
      /** Process fd retained by main through validation and normal opening. */
      sourceDescriptor?: number;
    }
  | { id: number; type: "status"; workspacePath?: string }
  | { id: number; type: "rebuild"; sources: SearchWorkerSource[] }
  | { id: number; type: "shutdown" };

export type SearchWorkerResponse =
  | {
      id: number;
      ok: true;
      type: "initialized" | "reconciled" | "rebuilt";
      revision: number;
      coverage: SessionSearchCoverage;
    }
  | {
      id: number;
      ok: true;
      type: "query";
      revision: number;
      matches: SearchWorkerMatch[];
      total: number;
      truncated: boolean;
      coverage: SessionSearchCoverage;
    }
  | { id: number; ok: true; type: "context"; result: ContextLoadResult }
  | { id: number; ok: true; type: "validate"; valid: boolean }
  | {
      id: number;
      ok: true;
      type: "status";
      revision: number;
      coverage: SessionSearchCoverage;
    }
  | { id: number; ok: true; type: "shutdown" }
  | { id: number; ok: false; error: string; recoverable: boolean };
