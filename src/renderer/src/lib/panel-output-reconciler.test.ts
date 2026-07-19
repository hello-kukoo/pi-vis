import { describe, expect, it } from "vitest";
import {
  initialAppliedPanelOutput,
  panelOutputActionRequiresDrain,
  reconcilePanelOutput,
} from "./panel-output-reconciler.js";

describe("panel output reconciliation", () => {
  it("applies every coalesced authority chunk in order", () => {
    const current = initialAppliedPanelOutput({
      buffer: ["keyframe"],
      outputSequence: 4,
      outputKind: "keyframe",
      renderRevision: 1,
    });
    const result = reconcilePanelOutput(current, {
      buffer: ["keyframe", "delta-5", "delta-6"],
      outputSequence: 6,
      outputKind: "delta",
      renderRevision: 1,
    });

    expect(result.action).toEqual({ kind: "append", ansi: "delta-5delta-6" });
    expect(result.applied.sequence).toBe(6);
  });

  it("never renders a duplicate or backwards output sequence", () => {
    const current = initialAppliedPanelOutput({
      buffer: ["frame", "new"],
      outputSequence: 8,
      renderRevision: 2,
    });

    expect(
      reconcilePanelOutput(current, {
        buffer: ["frame", "old"],
        outputSequence: 7,
        outputKind: "delta",
        renderRevision: 2,
      }),
    ).toEqual({ applied: current, action: { kind: "none" } });
  });

  it("rebuilds from a hard-clear replay anchor", () => {
    const current = initialAppliedPanelOutput({
      buffer: ["old-frame", "old-delta"],
      outputSequence: 2,
      renderRevision: 1,
    });
    const result = reconcilePanelOutput(current, {
      buffer: ["\x1b[2J\x1b[Hnew-frame", "new-delta"],
      outputSequence: 3,
      outputKind: "delta",
      renderRevision: 1,
    });

    expect(result.action).toEqual({
      kind: "replace",
      ansi: "\x1b[2J\x1b[Hnew-framenew-delta",
    });
    expect(result.applied.repaintRequired).toBe(false);
    expect(panelOutputActionRequiresDrain(result.action)).toBe(true);
  });

  it("keeps input open for ordered suffix appends but fences destructive grid changes", () => {
    expect(panelOutputActionRequiresDrain({ kind: "append", ansi: "delta" })).toBe(false);
    expect(panelOutputActionRequiresDrain({ kind: "none" })).toBe(false);
    expect(panelOutputActionRequiresDrain({ kind: "replace", ansi: "frame" })).toBe(true);
    expect(panelOutputActionRequiresDrain({ kind: "clear" })).toBe(true);
    expect(panelOutputActionRequiresDrain({ kind: "request_repaint" })).toBe(true);
  });

  it("refuses an unanchored truncated tail until a keyframe arrives", () => {
    const current = initialAppliedPanelOutput({
      buffer: ["keyframe", "delta-1"],
      outputSequence: 2,
      outputKind: "keyframe",
      renderRevision: 1,
    });
    const truncated = reconcilePanelOutput(current, {
      buffer: ["delta-2", "delta-3"],
      outputSequence: 4,
      outputKind: "delta",
      renderRevision: 1,
    });
    expect(truncated.action).toEqual({ kind: "request_repaint" });
    expect(truncated.applied.repaintRequired).toBe(true);

    const laterDelta = reconcilePanelOutput(truncated.applied, {
      buffer: ["delta-2", "delta-3", "delta-4"],
      outputSequence: 5,
      outputKind: "delta",
      renderRevision: 1,
    });
    expect(laterDelta.action).toEqual({ kind: "request_repaint" });
    expect(laterDelta.applied.repaintRequired).toBe(true);

    const keyframe = reconcilePanelOutput(laterDelta.applied, {
      buffer: ["complete-frame"],
      outputSequence: 6,
      outputKind: "keyframe",
      renderRevision: 2,
    });
    expect(keyframe.action).toEqual({ kind: "replace", ansi: "complete-frame" });
    expect(keyframe.applied.repaintRequired).toBe(false);
  });

  it("clears on reset and stays fenced until a keyframe", () => {
    const current = initialAppliedPanelOutput({
      buffer: ["frame"],
      outputSequence: 1,
      outputKind: "keyframe",
      renderRevision: 1,
    });
    const reset = reconcilePanelOutput(current, {
      buffer: [],
      outputSequence: 2,
      outputKind: "reset",
      renderRevision: 2,
    });
    expect(reset.action).toEqual({ kind: "clear" });
    expect(reset.applied.repaintRequired).toBe(true);

    const repaintRequired = reconcilePanelOutput(current, {
      buffer: [],
      outputSequence: 2,
      outputKind: "repaint_required",
      renderRevision: 2,
    });
    expect(repaintRequired.action).toEqual({ kind: "clear" });
    expect(repaintRequired.applied.repaintRequired).toBe(true);
  });

  it("accepts an anchored replay when a keyframe and its next delta are coalesced", () => {
    const reset = reconcilePanelOutput(
      initialAppliedPanelOutput({
        buffer: ["old"],
        outputSequence: 1,
        outputKind: "keyframe",
        renderRevision: 1,
      }),
      {
        buffer: [],
        outputSequence: 2,
        outputKind: "reset",
        renderRevision: 2,
      },
    );
    const coalesced = reconcilePanelOutput(reset.applied, {
      buffer: ["\x1b[2J\x1b[Hcomplete frame", "dependent delta"],
      outputSequence: 4,
      outputKind: "delta",
      renderRevision: 2,
    });

    expect(coalesced.action).toEqual({
      kind: "replace",
      ansi: "\x1b[2J\x1b[Hcomplete framedependent delta",
    });
    expect(coalesced.applied.repaintRequired).toBe(false);
  });

  it("finds a hard-clear anchor after a coalesced terminal handshake", () => {
    const reset = reconcilePanelOutput(
      initialAppliedPanelOutput({
        buffer: ["old"],
        outputSequence: 1,
        outputKind: "keyframe",
        renderRevision: 1,
      }),
      {
        buffer: [],
        outputSequence: 2,
        outputKind: "reset",
        renderRevision: 2,
      },
    );
    const handshake = "\x1b[?2004h\x1b[>7u\x1b[?u\x1b[c";
    const coalesced = reconcilePanelOutput(reset.applied, {
      buffer: [handshake, "\x1b[2J\x1b[Hcomplete frame", "dependent delta"],
      outputSequence: 5,
      outputKind: "delta",
      renderRevision: 2,
    });

    expect(coalesced.action).toEqual({
      kind: "replace",
      ansi: `${handshake}\x1b[2J\x1b[Hcomplete framedependent delta`,
    });
    expect(coalesced.applied.repaintRequired).toBe(false);
  });

  it("fences an unanchored authority replay on renderer remount", () => {
    const unanchored = initialAppliedPanelOutput({
      buffer: ["cursor-relative tail"],
      outputSequence: 9,
      outputKind: "delta",
      renderRevision: 3,
    });
    const legacy = initialAppliedPanelOutput({ buffer: ["legacy replay"] });

    expect(unanchored.repaintRequired).toBe(true);
    expect(legacy.repaintRequired).toBe(false);
  });
});
