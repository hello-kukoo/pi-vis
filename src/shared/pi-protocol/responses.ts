import { z } from "zod";
import { ThinkingLevelSchema } from "./thinking.js";

export const PiRpcResponseSchema = z.object({
  type: z.literal("response"),
  command: z.string(),
  success: z.boolean(),
  id: z.string().optional(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export type PiRpcResponse = z.infer<typeof PiRpcResponseSchema>;

const SessionStateModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  api: z.string().optional(),
  provider: z.string().optional(),
  baseUrl: z.string().optional(),
  reasoning: z.boolean().optional(),
}).passthrough();

export const SessionStateSchema = z.object({
  model: SessionStateModelSchema.nullable().optional(),
  thinkingLevel: ThinkingLevelSchema,
  isStreaming: z.boolean().optional(),
  isCompacting: z.boolean().optional(),
  steeringMode: z.enum(["all", "one-at-a-time"]).optional(),
  followUpMode: z.enum(["all", "one-at-a-time"]).optional(),
  sessionFile: z.string().optional(),
  sessionId: z.string(),
  sessionName: z.string().optional(),
  autoCompactionEnabled: z.boolean().optional(),
  messageCount: z.number().optional(),
  pendingMessageCount: z.number().optional(),
}).passthrough();

export type SessionState = z.infer<typeof SessionStateSchema>;

// Real wire shape from get_state/get_available_models: model has id, name, api, provider, baseUrl, etc.
export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  api: z.string().optional(),
  provider: z.string().optional(),
  baseUrl: z.string().optional(),
  reasoning: z.boolean().optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
}).passthrough();

export type ModelInfo = z.infer<typeof ModelInfoSchema>;

// Real wire shape from get_session_stats response data
export const SessionStatsSchema = z.object({
  sessionFile: z.string().optional(),
  sessionId: z.string(),
  userMessages: z.number().optional(),
  assistantMessages: z.number().optional(),
  toolCalls: z.number().optional(),
  toolResults: z.number().optional(),
  totalMessages: z.number().optional(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
  }).optional(),
  cost: z.number().optional(),
  contextUsage: z.object({
    tokens: z.number().nullable(),
    contextWindow: z.number(),
    percent: z.number().nullable(),
  }).optional(),
}).passthrough();

export type SessionStats = z.infer<typeof SessionStatsSchema>;

export const SlashCommandInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.string().optional(),
});

export type SlashCommandInfo = z.infer<typeof SlashCommandInfoSchema>;
