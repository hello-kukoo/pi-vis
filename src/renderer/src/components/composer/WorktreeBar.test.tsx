// @vitest-environment jsdom
import type { SessionId } from "@shared/ids.js";
import type React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SessionViewState, useSessionsStore } from "../../stores/sessions-store.js";
import { createTranscriptState } from "../../stores/transcript.js";
import { WorktreeBar } from "./WorktreeBar.js";

const sessionId = "worktree-bar-session" as SessionId;

type Invoke = (channel: string, args?: unknown) => Promise<unknown>;

function setSession(overrides: Partial<SessionViewState> = {}): void {
  const session = {
    sessionId,
    workspacePath: "/tmp/project",
    sessionFile: "/tmp/sessions/new.jsonl",
    status: "ready",
    availability: "available",
    transcript: createTranscriptState(),
    hasTreeHistory: false,
    isNewPending: true,
    sessionEpoch: 1,
    editorRevision: 0,
    editorAttachments: [],
    editorAttachmentReads: 0,
    turnErrored: false,
    pendingDialogs: [],
    statusSegments: new Map(),
    widgets: new Map(),
    toasts: [],
    availableModels: [],
    commands: [],
    resumed: false,
    modelInitialized: true,
    ...overrides,
  } as unknown as SessionViewState;
  useSessionsStore.setState({ sessions: new Map([[sessionId, session]]) });
}

function installInvoke(handler?: Invoke): void {
  const invoke = vi.fn(
    handler ??
      (async (channel: string) => {
        if (channel === "settings.get") return { diffIncludeRemoteBranches: false };
        if (channel === "git.branches") {
          return {
            kind: "ok",
            current: "main",
            branches: [{ name: "main", current: true, remote: false }],
          };
        }
        return { ok: true };
      }),
  );
  (globalThis.window as unknown as { pivis: unknown }).pivis = {
    invoke,
    on: vi.fn(() => () => {}),
  };
}

function mount(node: React.ReactElement): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    flushSync(() => root.render(node));
  });
  return {
    container,
    unmount: () => {
      act(() => flushSync(() => root.unmount()));
      container.remove();
    },
  };
}

function click(element: Element): void {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("WorktreeBar", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    installInvoke();
  });

  afterEach(() => {
    useSessionsStore.setState({ sessions: new Map() });
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stays visible after startup creates a session file, then hides after the first message", async () => {
    setSession();
    const { container, unmount } = mount(<WorktreeBar sessionId={sessionId} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector(".worktree-bar")).toBeTruthy();

    act(() => {
      useSessionsStore.getState().addUserMessage(sessionId, "first prompt");
    });
    expect(container.querySelector(".worktree-bar")).toBeNull();
    unmount();
  });

  it("does not show for an established header-only session", async () => {
    setSession({ isNewPending: false });
    const { container, unmount } = mount(<WorktreeBar sessionId={sessionId} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector(".worktree-bar")).toBeNull();
    unmount();
  });

  it("shows an unchecked copy-changes checkbox only for New Worktree", async () => {
    setSession();
    const { container, unmount } = mount(<WorktreeBar sessionId={sessionId} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const newWorktree = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "New Worktree",
    );
    expect(newWorktree).toBeTruthy();
    click(newWorktree!);

    const checkbox = container.querySelector<HTMLInputElement>(
      ".worktree-bar__copy-changes input[type='checkbox']",
    );
    expect(checkbox).toBeTruthy();
    expect(checkbox?.checked).toBe(false);

    click(checkbox!);
    expect(useSessionsStore.getState().sessions.get(sessionId)?.worktreeCopyUncommitted).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>("[aria-label='Choose worktree base branch']")
        ?.disabled,
    ).toBe(true);
    expect(useSessionsStore.getState().sessions.get(sessionId)?.worktreeBase).toBe("main");
    act(() => useSessionsStore.getState().setWorktreeBase(sessionId, "stale-restored-base"));
    expect(
      container.querySelector<HTMLButtonElement>("[aria-label='Choose worktree base branch']")
        ?.textContent,
    ).toContain("main");

    const existing = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Existing Worktree",
    );
    click(existing!);
    expect(container.querySelector(".worktree-bar__copy-changes")).toBeNull();
    click(newWorktree!);
    expect(
      container.querySelector<HTMLInputElement>(
        ".worktree-bar__copy-changes input[type='checkbox']",
      )?.checked,
    ).toBe(true);
    unmount();
  });
});
