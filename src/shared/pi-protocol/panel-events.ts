import { z } from "zod";

/**
 * Panel lifecycle events for custom() → xterm.js rendering.
 *
 * These are emitted by the SessionHost (not by pi itself) when an extension
 * calls ctx.ui.custom(factory). The panel opens → receives ANSI data →
 * closes when done(result) is called.
 */

export const PanelOpenEventSchema = z.object({
  type: z.literal("panel_open"),
  panelId: z.number(),
  overlay: z.boolean(),
});

export const PanelDataEventSchema = z.object({
  type: z.literal("panel_data"),
  panelId: z.number(),
  data: z.string(),
});

export const PanelCloseEventSchema = z.object({
  type: z.literal("panel_close"),
  panelId: z.number(),
});

export const PanelClearAllEventSchema = z.object({
  type: z.literal("panel_clear_all"),
});

export const HostFallbackEventSchema = z.object({
  type: z.literal("host_fallback"),
  reason: z.string(),
});

/**
 * A non-fatal warning that should surface to the user (e.g. a toast) but does
 * NOT indicate the host fell back to pi --mode rpc. Distinct from
 * `host_fallback` so the renderer can render an upgrade prompt for a fallback
 * but a plain warning for mere contention.
 */
export const SessionWarningEventSchema = z.object({
  type: z.literal("session_warning"),
  message: z.string(),
});

export const PanelEventSchema = z.discriminatedUnion("type", [
  PanelOpenEventSchema,
  PanelDataEventSchema,
  PanelCloseEventSchema,
  PanelClearAllEventSchema,
  HostFallbackEventSchema,
  SessionWarningEventSchema,
]);

export type PanelOpenEvent = z.infer<typeof PanelOpenEventSchema>;
export type PanelDataEvent = z.infer<typeof PanelDataEventSchema>;
export type PanelCloseEvent = z.infer<typeof PanelCloseEventSchema>;
export type PanelClearAllEvent = z.infer<typeof PanelClearAllEventSchema>;
export type HostFallbackEvent = z.infer<typeof HostFallbackEventSchema>;
export type SessionWarningEvent = z.infer<typeof SessionWarningEventSchema>;
export type PanelEvent = z.infer<typeof PanelEventSchema>;
