import { z } from "zod";

/**
 * Panel lifecycle events for custom() → xterm.js rendering.
 *
 * These are emitted by the SessionHost (not by pi itself) when an extension
 * calls ctx.ui.custom(factory). The panel opens → receives ANSI data →
 * closes when done(result) is called.
 *
 * The `unified` flag on `panel_open` distinguishes the **unified TUI panel**
 * (a persistent Composer-replacement hosting the editor + factory `setWidget`
 * widgets) from a transient custom() overlay panel. The renderer renders a
 * `UnifiedTuiHost` for a unified panel and treats it as non-blocking; a plain
 * panel_open (overlay) renders the existing `CustomPanelHost`.
 */

export const PanelOpenEventSchema = z.object({
  type: z.literal("panel_open"),
  panelId: z.number(),
  overlay: z.boolean(),
  /** True for the persistent unified-TUI panel (factory `setWidget`); false/absent
   *  for a transient custom() overlay panel. */
  unified: z.boolean().optional(),
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

/**
 * The unified-TUI panel's host process is gone (host restart, `/reload`, or
 * session close). The dying host cannot emit a reliable `panel_close` for the
 * unified panel, so the main process emits this to tell the renderer to drop
 * stale `unifiedPanel` state and restore the native Composer. Distinct from
 * `panel_clear_all` (which clears custom() overlay panels) so each can be
 * handled independently.
 */
export const UnifiedPanelResetEventSchema = z.object({
  type: z.literal("unified_panel_reset"),
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
  UnifiedPanelResetEventSchema,
  HostFallbackEventSchema,
  SessionWarningEventSchema,
]);

export type PanelOpenEvent = z.infer<typeof PanelOpenEventSchema>;
export type PanelDataEvent = z.infer<typeof PanelDataEventSchema>;
export type PanelCloseEvent = z.infer<typeof PanelCloseEventSchema>;
export type PanelClearAllEvent = z.infer<typeof PanelClearAllEventSchema>;
export type UnifiedPanelResetEvent = z.infer<typeof UnifiedPanelResetEventSchema>;
export type HostFallbackEvent = z.infer<typeof HostFallbackEventSchema>;
export type SessionWarningEvent = z.infer<typeof SessionWarningEventSchema>;
export type PanelEvent = z.infer<typeof PanelEventSchema>;
