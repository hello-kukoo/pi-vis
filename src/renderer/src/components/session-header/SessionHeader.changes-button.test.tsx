// @vitest-environment jsdom
import type { SessionId } from "@shared/ids.js";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffStore } from "../../stores/diff-store.js";
import { useSessionsStore } from "../../stores/sessions-store.js";
import { ChangesButton, shouldRefreshSessionStats } from "./SessionHeader.js";

const SID = "session-a" as SessionId;
const WORKSPACE = "/tmp/ws";

describe("session stats refresh boundaries", () => {
  it("refreshes for manual compaction as well as agent settlement", () => {
    expect(shouldRefreshSessionStats([{ type: "compaction_end" }])).toBe(true);
    expect(shouldRefreshSessionStats([{ type: "agent_end" }])).toBe(true);
    expect(shouldRefreshSessionStats([{ type: "message_end" }])).toBe(false);
  });
});

function mount(): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => flushSync(() => root.render(<ChangesButton sessionId={SID} />)));
  return {
    container,
    unmount: () => {
      act(() => flushSync(() => root.unmount()));
      container.remove();
    },
  };
}

describe("ChangesButton badge failure presentation", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(() => Promise.resolve({ kind: "error", message: "git blew up" }));
    (window as unknown as { pivis: unknown }).pivis = {
      invoke,
      on: vi.fn(() => () => {}),
    };
    useSessionsStore.setState({ sessions: new Map(), activeSessionId: SID });
    useSessionsStore.getState().createSession(SID, WORKSPACE, "/tmp/a.jsonl");
    useSessionsStore.getState().setSessionStatus(SID, "ready");
  });

  afterEach(() => {
    (window as unknown as { pivis?: unknown }).pivis = undefined;
    useDiffStore.setState({ badge: null, badgeKind: "loading", open: false });
    document.body.innerHTML = "";
  });

  it("stays visible with an error marker when the badge scan fails, and still opens the viewer", () => {
    act(() => {
      useDiffStore.setState({ badge: null, badgeKind: "error" });
    });
    const view = mount();
    const button = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="changes-button"]',
    );
    expect(button).not.toBeNull();
    expect(button?.title).toContain("Couldn't read git changes");
    expect(button?.querySelector(".session-header__changes-error")).not.toBeNull();

    act(() => button?.click());
    expect(useDiffStore.getState().open).toBe(true);
    expect(useDiffStore.getState().sessionId).toBe(SID);
    view.unmount();
  });

  it("still hides for a non-repo workspace and while the badge is loading", () => {
    act(() => {
      useDiffStore.setState({ badge: null, badgeKind: "not-a-repo" });
    });
    const nonRepo = mount();
    expect(nonRepo.container.querySelector('[data-testid="changes-button"]')).toBeNull();
    nonRepo.unmount();

    act(() => {
      useDiffStore.setState({ badge: null, badgeKind: "loading" });
    });
    const loading = mount();
    expect(loading.container.querySelector('[data-testid="changes-button"]')).toBeNull();
    loading.unmount();
  });
});
