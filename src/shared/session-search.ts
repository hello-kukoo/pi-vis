import { z } from "zod";
import type { SessionId } from "./ids.js";

/**
 * Persisted session search is deliberately separate from the live SDK-host
 * protocol. Targets are renderer-scoped capabilities; paths and runtime host
 * identities never cross this boundary in a search result.
 */
export const SEARCH_QUERY_MAX_LENGTH = 512;
export const SEARCH_PAGE_MAX_SIZE = 50;
export const SEARCH_BATCH_MAX_BYTES = 128 * 1024;

export const SearchIdSchema = z.string().min(16).max(128).brand<"SearchId">();
export type SearchId = z.infer<typeof SearchIdSchema>;

export const SearchTargetIdSchema = z.string().min(16).max(128).brand<"SearchTargetId">();
export type SearchTargetId = z.infer<typeof SearchTargetIdSchema>;

const RendererGenerationSchema = z.number().int().nonnegative();
const WorkspacePathSchema = z.string().min(1).max(4096);
const ClientQueryIdSchema = z.string().min(1).max(128);
const IndexRevisionSchema = z.number().int().nonnegative();

export const SearchMatchRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine(({ start, end }) => end > start, "match range must be non-empty");
export type SearchMatchRange = z.infer<typeof SearchMatchRangeSchema>;

export const SessionSearchRoleSchema = z.enum([
  "session-name",
  "user",
  "assistant",
  "error",
  "custom-message",
  "compaction-summary",
  "branch-summary",
]);
export type SessionSearchRole = z.infer<typeof SessionSearchRoleSchema>;

export const SessionSearchStartRequestSchema = z.object({
  rendererGeneration: RendererGenerationSchema,
  clientQueryId: ClientQueryIdSchema,
  workspacePath: WorkspacePathSchema,
  query: z.string().max(SEARCH_QUERY_MAX_LENGTH),
  pageSize: z.number().int().min(1).max(SEARCH_PAGE_MAX_SIZE),
});
export type SessionSearchStartRequest = z.infer<typeof SessionSearchStartRequestSchema>;

export const SessionSearchMoreRequestSchema = z.object({
  rendererGeneration: RendererGenerationSchema,
  searchId: SearchIdSchema,
});
export type SessionSearchMoreRequest = z.infer<typeof SessionSearchMoreRequestSchema>;

export const SessionSearchCancelRequestSchema = SessionSearchMoreRequestSchema;
export type SessionSearchCancelRequest = z.infer<typeof SessionSearchCancelRequestSchema>;

export const SessionSearchExpandRequestSchema = SessionSearchMoreRequestSchema.extend({
  targetId: SearchTargetIdSchema,
});
export type SessionSearchExpandRequest = z.infer<typeof SessionSearchExpandRequestSchema>;

export const SessionSearchContextRequestSchema = z.object({
  rendererGeneration: RendererGenerationSchema,
  searchId: SearchIdSchema,
  targetId: SearchTargetIdSchema,
  indexRevision: IndexRevisionSchema,
  before: z.number().int().min(0).max(20).default(4),
  after: z.number().int().min(0).max(20).default(4),
});
export type SessionSearchContextRequest = z.infer<typeof SessionSearchContextRequestSchema>;

export const SessionSearchOpenRequestSchema = z.object({
  rendererGeneration: RendererGenerationSchema,
  targetId: SearchTargetIdSchema,
});
export type SessionSearchOpenRequest = z.infer<typeof SessionSearchOpenRequestSchema>;

export const SessionSearchStatusRequestSchema = z.object({
  rendererGeneration: RendererGenerationSchema,
  workspacePath: WorkspacePathSchema,
});
export type SessionSearchStatusRequest = z.infer<typeof SessionSearchStatusRequestSchema>;

export const SessionSearchRebuildRequestSchema = SessionSearchStatusRequestSchema;
export type SessionSearchRebuildRequest = z.infer<typeof SessionSearchRebuildRequestSchema>;

export const SessionSearchCoverageSchema = z.object({
  indexedSources: z.number().int().nonnegative(),
  totalSources: z.number().int().nonnegative(),
  skippedSources: z.number().int().nonnegative(),
});
export type SessionSearchCoverage = z.infer<typeof SessionSearchCoverageSchema>;

export const SessionSearchResultSchema = z.object({
  targetId: SearchTargetIdSchema,
  sessionName: z.string(),
  worktreeName: z.string().optional(),
  role: SessionSearchRoleSchema,
  timestamp: z.number().nullable(),
  snippet: z.string(),
  matchRanges: z.array(SearchMatchRangeSchema).max(64),
  branchKind: z.enum(["latest-persisted-path", "other-saved-branch"]),
  sourceRevision: z.string().min(1).max(256),
  additionalMatches: z.number().int().nonnegative(),
  closeMatchTerm: z.string().optional(),
});
export type SessionSearchResult = z.infer<typeof SessionSearchResultSchema>;

export const SessionSearchBatchSchema = z.object({
  rendererGeneration: RendererGenerationSchema,
  clientQueryId: ClientQueryIdSchema,
  searchId: SearchIdSchema,
  sequence: z.number().int().nonnegative(),
  indexRevision: IndexRevisionSchema,
  disposition: z.enum(["replace", "append"]),
  results: z.array(SessionSearchResultSchema).max(SEARCH_PAGE_MAX_SIZE),
  count: z.object({
    value: z.number().int().nonnegative(),
    exact: z.boolean(),
  }),
  coverage: SessionSearchCoverageSchema,
  done: z.boolean(),
  error: z.string().optional(),
});
export type SessionSearchBatch = z.infer<typeof SessionSearchBatchSchema>;

export const SessionSearchContextItemSchema = z.object({
  entryId: z.string(),
  contentPartKey: z.string(),
  role: SessionSearchRoleSchema,
  timestamp: z.number().nullable(),
  text: z.string(),
  target: z.boolean(),
  matchRanges: z.array(SearchMatchRangeSchema).max(64),
});
export type SessionSearchContextItem = z.infer<typeof SessionSearchContextItemSchema>;

const ContextReadySchema = z.object({
  outcome: z.enum(["ready", "relocated"]),
  targetId: SearchTargetIdSchema,
  sourceRevision: z.string(),
  sessionName: z.string(),
  worktreeName: z.string().optional(),
  branchKind: z.enum(["latest-persisted-path", "other-saved-branch"]),
  items: z.array(SessionSearchContextItemSchema).max(41),
  ancestryIncomplete: z.boolean(),
  hasEarlier: z.boolean(),
  hasLater: z.boolean(),
});

const ContextFailureSchema = z.object({
  outcome: z.enum(["changed", "removed", "forbidden", "unavailable"]),
  message: z.string(),
});

export const SessionSearchContextResultSchema = z.union([ContextReadySchema, ContextFailureSchema]);
export type SessionSearchContextResult = z.infer<typeof SessionSearchContextResultSchema>;

export const SessionSearchOpenResultSchema = z.union([
  z.object({
    outcome: z.enum(["opened", "existing"]),
    sessionId: z.string().transform((value) => value as SessionId),
    /** Trusted main-process resolution; never accepted back as open authority. */
    sessionFile: z.string(),
    workspacePath: z.string(),
    name: z.string().nullable(),
    preview: z.string().nullable(),
    sessionStatus: z.enum(["cold", "starting", "ready", "exited", "failed"]),
    worktreeOperationInProgress: z.boolean().optional(),
    worktreeOperationError: z.string().optional(),
    worktreeIdentityRevision: z.number().int().nonnegative().optional(),
    worktree: z
      .object({
        path: z.string(),
        branch: z.string(),
        name: z.string(),
        base: z.string(),
      })
      .optional(),
  }),
  z.object({
    outcome: z.enum(["missing", "forbidden", "invalid-target", "unavailable"]),
    message: z.string(),
  }),
]);
export type SessionSearchOpenResult = z.infer<typeof SessionSearchOpenResultSchema>;

export const SessionSearchIndexStatusSchema = z.object({
  state: z.enum(["starting", "indexing", "ready", "rebuilding", "unavailable", "failed"]),
  indexRevision: IndexRevisionSchema,
  coverage: SessionSearchCoverageSchema,
  message: z.string().optional(),
});
export type SessionSearchIndexStatus = z.infer<typeof SessionSearchIndexStatusSchema>;
