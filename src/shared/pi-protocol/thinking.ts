import { z } from "zod";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const ThinkingLevelSchema = z.enum(THINKING_LEVELS);

export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;
