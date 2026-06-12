import { z } from "zod";

export const SessionHeaderSchema = z.object({
  type: z.literal("session"),
  version: z.number(),
  id: z.string(),
  timestamp: z.string().or(z.number()),
  cwd: z.string(),
  model: z.string().optional(),
}).passthrough();

export type SessionHeader = z.infer<typeof SessionHeaderSchema>;

const BaseEntrySchema = z.object({
  id: z.string(), // 8-hex
  parentId: z.string().optional(),
  timestamp: z.string().or(z.number()).optional(),
});

export const MessageEntrySchema = BaseEntrySchema.extend({
  type: z.literal("message"),
  role: z.enum(["user", "assistant", "toolResult"]),
  content: z.unknown(),
  display: z.boolean().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
});

export const ModelChangeEntrySchema = BaseEntrySchema.extend({
  type: z.literal("model_change"),
  model: z.string(),
});

export const ThinkingLevelChangeEntrySchema = BaseEntrySchema.extend({
  type: z.literal("thinking_level_change"),
  level: z.string(),
});

export const CompactionEntrySchema = BaseEntrySchema.extend({
  type: z.literal("compaction"),
  summary: z.string().optional(),
  firstKeptEntryId: z.string().optional(),
});

export const BranchSummaryEntrySchema = BaseEntrySchema.extend({
  type: z.literal("branch_summary"),
  summary: z.string().optional(),
});

export const CustomEntrySchema = BaseEntrySchema.extend({
  type: z.literal("custom"),
}).passthrough();

export const CustomMessageEntrySchema = BaseEntrySchema.extend({
  type: z.literal("custom_message"),
  content: z.string().optional(),
  display: z.boolean().optional(),
}).passthrough();

export const LabelEntrySchema = BaseEntrySchema.extend({
  type: z.literal("label"),
  label: z.string().optional(),
});

export const SessionInfoEntrySchema = BaseEntrySchema.extend({
  type: z.literal("session_info"),
  name: z.string().optional(),
}).passthrough();

export const KnownSessionEntrySchema = z.discriminatedUnion("type", [
  MessageEntrySchema,
  ModelChangeEntrySchema,
  ThinkingLevelChangeEntrySchema,
  CompactionEntrySchema,
  BranchSummaryEntrySchema,
  CustomEntrySchema,
  CustomMessageEntrySchema,
  LabelEntrySchema,
  SessionInfoEntrySchema,
]);

const UnknownEntrySchema = z.object({ type: z.string() }).passthrough()
  .transform((v) => ({ ...v, __unknown: true as const }));

export const SessionEntrySchema = KnownSessionEntrySchema.or(UnknownEntrySchema);

export type SessionEntry = z.infer<typeof SessionEntrySchema>;
export type KnownSessionEntry = z.infer<typeof KnownSessionEntrySchema>;
export type MessageEntry = z.infer<typeof MessageEntrySchema>;
export type CompactionEntry = z.infer<typeof CompactionEntrySchema>;
export type CustomMessageEntry = z.infer<typeof CustomMessageEntrySchema>;
export type SessionInfoEntry = z.infer<typeof SessionInfoEntrySchema>;
