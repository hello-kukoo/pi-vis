export interface RendererKeyInput {
  type: string;
  key: string;
  meta: boolean;
  control: boolean;
}

/**
 * Renderer reloads destroy the generation-fenced UI state while live session
 * hosts keep running. Pi-Vis owns its recovery lifecycle explicitly, so both
 * the normal and hard-refresh accelerators must be consumed by main before
 * Chromium can act on them.
 */
export function isRendererReloadShortcut(input: RendererKeyInput): boolean {
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") return false;
  return (input.meta || input.control) && input.key.toLowerCase() === "r";
}
