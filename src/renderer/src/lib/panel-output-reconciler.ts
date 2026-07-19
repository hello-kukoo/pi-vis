export interface PanelOutputProjection {
  buffer: readonly string[];
  outputSequence?: number;
  outputKind?: "keyframe" | "delta" | "reset" | "repaint_required";
  renderRevision?: number;
}

export interface AppliedPanelOutput {
  chunks: readonly string[];
  sequence: number | null;
  renderRevision: number | null;
  /**
   * An unanchored replay-buffer replacement cannot reconstruct a terminal.
   * Stay blank and ignore later deltas until the host supplies a keyframe.
   */
  repaintRequired: boolean;
}

export type PanelOutputAction =
  | { kind: "none" }
  | { kind: "append"; ansi: string }
  | { kind: "replace"; ansi: string }
  | { kind: "clear" }
  | { kind: "request_repaint" };

export interface PanelOutputReconciliation {
  applied: AppliedPanelOutput;
  action: PanelOutputAction;
}

/** A destructive grid operation must drain before panel input can resume. */
export function panelOutputActionRequiresDrain(action: PanelOutputAction): boolean {
  return action.kind === "replace" || action.kind === "clear" || action.kind === "request_repaint";
}

/** Clear viewport + scrollback without resetting xterm keyboard modes. */
export const PANEL_REPLAY_CLEAR_ANSI = "\x1b[2J\x1b[H\x1b[3J";

export function initialAppliedPanelOutput(panel: PanelOutputProjection): AppliedPanelOutput {
  const authorityReplayPresent = panel.outputSequence !== undefined;
  const replayRequired =
    authorityReplayPresent &&
    panel.outputKind !== "keyframe" &&
    (panel.outputKind === "reset" ||
      panel.outputKind === "repaint_required" ||
      !hasReplayAnchor(panel));
  return {
    chunks: panel.buffer,
    sequence: panel.outputSequence ?? null,
    renderRevision: panel.renderRevision ?? null,
    repaintRequired: replayRequired,
  };
}

function isPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  if (prefix.length > value.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (prefix[index] !== value[index]) return false;
  }
  return true;
}

function hasReplayAnchor(panel: PanelOutputProjection): boolean {
  if (panel.outputKind === "keyframe") return true;
  // One forced paint may be published as several ordered chunks. In
  // particular, terminal-mode renegotiation can precede the TUI's hard-clear
  // frame, and React may coalesce that keyframe with its following delta. The
  // authority segment was emptied by repaint_required, so an anchor anywhere
  // in this bounded segment reconstructs the current generation safely.
  return panel.buffer.some((chunk) => chunk.includes("\x1bc") || chunk.includes("\x1b[2J"));
}

/**
 * Reconcile the terminal against the authority projection's complete ordered
 * replay segment. The latest `outputAnsi` alone is insufficient: React may
 * batch several panel publications into one render, and a cursor-relative ANSI
 * delta is only meaningful after every preceding delta has been applied.
 *
 * Invariants:
 * - output sequences never render twice or backwards;
 * - a prefix extension appends every skipped/coalesced chunk in order;
 * - a replacement is replayed only from a keyframe/full-screen-clear anchor;
 * - an unanchored replacement stays blank until a forced keyframe arrives.
 */
export function reconcilePanelOutput(
  current: AppliedPanelOutput,
  panel: PanelOutputProjection,
): PanelOutputReconciliation {
  const sequence = panel.outputSequence;
  if (sequence === undefined || (current.sequence !== null && sequence <= current.sequence)) {
    return { applied: current, action: { kind: "none" } };
  }

  const nextBase: AppliedPanelOutput = {
    chunks: panel.buffer,
    sequence,
    renderRevision: panel.renderRevision ?? null,
    repaintRequired: current.repaintRequired,
  };

  if (panel.outputKind === "reset" || panel.outputKind === "repaint_required") {
    return {
      applied: { ...nextBase, repaintRequired: true },
      action: { kind: "clear" },
    };
  }

  if (panel.outputKind === "keyframe") {
    const sameRevision = current.renderRevision === (panel.renderRevision ?? null);
    if (!current.repaintRequired && sameRevision && isPrefix(current.chunks, panel.buffer)) {
      const ansi = panel.buffer.slice(current.chunks.length).join("");
      return {
        applied: { ...nextBase, repaintRequired: false },
        action: ansi ? { kind: "append", ansi } : { kind: "none" },
      };
    }
    return {
      applied: { ...nextBase, repaintRequired: false },
      action: { kind: "replace", ansi: panel.buffer.join("") },
    };
  }

  if (current.repaintRequired) {
    // The keyframe publication itself may be coalesced with a later delta.
    // In that case `outputKind` describes the latest delta, while the replay
    // segment still contains the complete hard-clear frame and is sufficient
    // to leave the reconstruction fence safely. Protocol-negotiation bytes may
    // be an earlier chunk in that same repaint generation.
    if (hasReplayAnchor(panel)) {
      return {
        applied: { ...nextBase, repaintRequired: false },
        action: { kind: "replace", ansi: panel.buffer.join("") },
      };
    }
    return {
      applied: nextBase,
      // This is a newer unsafe replay generation, not a duplicate render of
      // the generation already requested above. Ask again so a dropped or
      // teardown-raced recovery request cannot leave the terminal fenced
      // forever. Sequenced repaint_required remains handled by the clear case
      // above and is never echoed here.
      action: { kind: "request_repaint" },
    };
  }

  if (isPrefix(current.chunks, panel.buffer)) {
    const ansi = panel.buffer.slice(current.chunks.length).join("");
    return {
      applied: { ...nextBase, repaintRequired: false },
      action: ansi ? { kind: "append", ansi } : { kind: "none" },
    };
  }

  if (hasReplayAnchor(panel)) {
    return {
      applied: { ...nextBase, repaintRequired: false },
      action: { kind: "replace", ansi: panel.buffer.join("") },
    };
  }

  return {
    applied: { ...nextBase, repaintRequired: true },
    action: { kind: "request_repaint" },
  };
}
