import type { SessionId } from "@shared/ids.js";
import { afterEach, describe, expect, it } from "vitest";
import type { PanelInputIdentity } from "./panel-input-buffer.js";
import {
  acknowledgePanelInput,
  activatePanelInputIdentity,
  enqueuePanelInputAttempt,
  forgetPanelInputSequence,
  forgetPanelInputSession,
  isPanelInputBlocked,
  nextPanelInputSequence,
  panelAcknowledgedThrough,
  queuePanelInput,
  releaseQueuedPanelInput,
} from "./panel-input-sequence.js";

const SESSION = "panel-sequence-test" as SessionId;
const COLON_SESSION = "file:workspace" as SessionId;
const COLON_SIBLING_SESSION = "file:workspace:branch" as SessionId;
const PANEL: PanelInputIdentity = {
  hostInstanceId: "host-a",
  sessionEpoch: 3,
  panelId: 7,
};

afterEach(() => {
  forgetPanelInputSession(SESSION);
  forgetPanelInputSession(COLON_SESSION);
  forgetPanelInputSession(COLON_SIBLING_SESSION);
});

describe("panel input identity coordinator", () => {
  it("seeds the next sequence from an authority attach acknowledgement", () => {
    acknowledgePanelInput(SESSION, PANEL.hostInstanceId, PANEL.sessionEpoch, PANEL.panelId, 8);

    expect(
      nextPanelInputSequence(SESSION, PANEL.hostInstanceId, PANEL.sessionEpoch, PANEL.panelId),
    ).toBe(9);
  });

  it("keeps rejected input across component-local lifetimes", () => {
    queuePanelInput(SESSION, PANEL, "first");
    queuePanelInput(SESSION, PANEL, "\u001b[13;2u");

    expect(isPanelInputBlocked(SESSION, PANEL)).toBe(true);
    expect(releaseQueuedPanelInput(SESSION, PANEL, false)).toEqual([]);
    // A new component instance releases from the identity-owned mailbox.
    expect(releaseQueuedPanelInput(SESSION, PANEL, true)).toEqual(["first", "\u001b[13;2u"]);
    expect(isPanelInputBlocked(SESSION, PANEL)).toBe(false);
  });

  it("serializes attempts that were enqueued by different component instances", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let finishSecond!: () => void;
    const secondFinished = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });

    enqueuePanelInputAttempt(SESSION, PANEL, async () => {
      order.push("first:start");
      markFirstStarted();
      await firstGate;
      order.push("first:end");
    });
    // This represents a remounted host: the ordering tail is not component-local.
    enqueuePanelInputAttempt(SESSION, PANEL, async () => {
      order.push("second");
      finishSecond();
    });

    await firstStarted;
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await secondFinished;
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("tombstones an in-flight identity until late completion cannot recreate it", async () => {
    let releaseAttempt!: () => void;
    const attemptGate = new Promise<void>((resolve) => {
      releaseAttempt = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let markFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      markFinished = resolve;
    });
    let queuedAttemptRan = false;

    enqueuePanelInputAttempt(SESSION, PANEL, async (inputGeneration) => {
      markStarted();
      await attemptGate;
      acknowledgePanelInput(
        SESSION,
        PANEL.hostInstanceId,
        PANEL.sessionEpoch,
        PANEL.panelId,
        8,
        inputGeneration,
      );
      markFinished();
    });
    enqueuePanelInputAttempt(SESSION, PANEL, async () => {
      queuedAttemptRan = true;
    });

    await started;
    forgetPanelInputSequence(SESSION, PANEL.panelId);
    const successor = activatePanelInputIdentity(SESSION, PANEL);
    expect(
      nextPanelInputSequence(
        SESSION,
        PANEL.hostInstanceId,
        PANEL.sessionEpoch,
        PANEL.panelId,
        successor,
      ),
    ).toBe(1);
    releaseAttempt();
    await finished;
    await Promise.resolve();
    await Promise.resolve();

    expect(queuedAttemptRan).toBe(false);
    expect(
      panelAcknowledgedThrough(SESSION, PANEL.hostInstanceId, PANEL.sessionEpoch, PANEL.panelId),
    ).toBe(0);
    expect(
      nextPanelInputSequence(
        SESSION,
        PANEL.hostInstanceId,
        PANEL.sessionEpoch,
        PANEL.panelId,
        successor,
      ),
    ).toBe(2);
  });

  it("retires every coordinator entry for a removed session", () => {
    const otherPanel = { ...PANEL, panelId: PANEL.panelId + 1 };
    acknowledgePanelInput(SESSION, PANEL.hostInstanceId, PANEL.sessionEpoch, PANEL.panelId, 3);
    acknowledgePanelInput(
      SESSION,
      otherPanel.hostInstanceId,
      otherPanel.sessionEpoch,
      otherPanel.panelId,
      5,
    );

    forgetPanelInputSession(SESSION);

    expect(
      panelAcknowledgedThrough(SESSION, PANEL.hostInstanceId, PANEL.sessionEpoch, PANEL.panelId),
    ).toBe(0);
    expect(
      panelAcknowledgedThrough(
        SESSION,
        otherPanel.hostInstanceId,
        otherPanel.sessionEpoch,
        otherPanel.panelId,
      ),
    ).toBe(0);
  });

  it("isolates session retirement when session ids contain colons", () => {
    acknowledgePanelInput(
      COLON_SESSION,
      PANEL.hostInstanceId,
      PANEL.sessionEpoch,
      PANEL.panelId,
      3,
    );
    acknowledgePanelInput(
      COLON_SIBLING_SESSION,
      PANEL.hostInstanceId,
      PANEL.sessionEpoch,
      PANEL.panelId,
      5,
    );

    forgetPanelInputSession(COLON_SESSION);

    expect(
      panelAcknowledgedThrough(
        COLON_SESSION,
        PANEL.hostInstanceId,
        PANEL.sessionEpoch,
        PANEL.panelId,
      ),
    ).toBe(0);
    expect(
      panelAcknowledgedThrough(
        COLON_SIBLING_SESSION,
        PANEL.hostInstanceId,
        PANEL.sessionEpoch,
        PANEL.panelId,
      ),
    ).toBe(5);
  });
});
