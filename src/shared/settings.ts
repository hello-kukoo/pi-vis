import { z } from "zod";
import { ThinkingLevelSchema } from "./pi-protocol/thinking.js";

const FontSettingsSchema = z.object({
  family: z.string(),
  sizePx: z.number().min(8).max(48),
});

export const AppSettingsSchema = z.object({
  piBinaryPath: z.string().nullable().default(null),
  fonts: z
    .object({
      display: FontSettingsSchema.default({ family: "Inter", sizePx: 14 }),
      code: FontSettingsSchema.default({ family: "IBM Plex Mono", sizePx: 13 }),
    })
    .default({}),
  recentWorkspaces: z.array(z.string()).default([]),
  lastUsedModel: z
    .object({ provider: z.string(), modelId: z.string() })
    .nullable()
    .default(null),
  lastUsedThinkingLevel: ThinkingLevelSchema.nullable().default(null),
  openTabs: z
    .array(z.object({ workspacePath: z.string(), sessionFile: z.string() }))
    .default([]),
  activeSessionFile: z.string().nullable().default(null),
  window: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const defaultSettings: AppSettings = AppSettingsSchema.parse({});
