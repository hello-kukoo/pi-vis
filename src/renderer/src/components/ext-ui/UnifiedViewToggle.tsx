/**
 * UnifiedViewToggle — the segmented switcher between the extension's unified
 * TUI surface and the native Composer.
 *
 * When a factory `setWidget` opens a persistent unified panel, this toggle
 * allows switching between the extension's TUI and the native Composer without
 * closing the widget. Both surfaces stay "ready" while toggled away (the TUI
 * editor keeps its contents in the host process; the Composer draft lives in
 * the store) — this control only chooses which one renders in the flex slot.
 * Default: unified TUI (the parity-correct surface when a factory widget is live).
 *
 * **Placement:** Lives in the right-side controls cluster of the session header,
 * before the changes button. This follows modern UX patterns where session-level
 * toggles live in the header alongside other controls.
 *
 * **Visual language:** A hairlined `surface0` pill with a mauve active segment.
 * Uses text labels for clarity: "Extension" (default) for the TUI panel and
 * "Input" (default) for the native composer. Custom labels can be provided via
 * props.
 */

import type { SessionId } from "@shared/ids.js";
import type React from "react";
import { useSessionsStore } from "../../stores/sessions-store.js";
import "./UnifiedViewToggle.css";

interface UnifiedViewToggleProps {
  sessionId: SessionId;
  extensionLabel?: string;
  inputLabel?: string;
}

export function UnifiedViewToggle({
  sessionId,
  extensionLabel = "Extension",
  inputLabel = "Input",
}: UnifiedViewToggleProps): React.ReactElement | null {
  const hidden = useSessionsStore((s) => s.sessions.get(sessionId)?.unifiedPanelHidden ?? false);
  const setUnifiedPanelHidden = useSessionsStore((s) => s.setUnifiedPanelHidden);

  return (
    <div className="unified-toggle unified-toggle--header" role="tablist" aria-label="Input view">
      <button
        type="button"
        role="tab"
        aria-selected={!hidden}
        className={`unified-toggle__seg${!hidden ? " unified-toggle__seg--active" : ""}`}
        onClick={() => setUnifiedPanelHidden(sessionId, false)}
        title="Extension panel (TUI)"
      >
        {extensionLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={hidden}
        className={`unified-toggle__seg${hidden ? " unified-toggle__seg--active" : ""}`}
        onClick={() => setUnifiedPanelHidden(sessionId, true)}
        title="Native chat composer"
      >
        {inputLabel}
      </button>
    </div>
  );
}
