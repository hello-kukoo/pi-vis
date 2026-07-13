// @vitest-environment jsdom
import type React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDiffStore } from "../../stores/diff-store.js";
import { CommitRangePicker } from "./CommitRangePicker.js";

const commits = [
  { sha: "aaa", shortSha: "aaa", subject: "oldest", authorName: "A", authoredAt: 0 },
  { sha: "bbb", shortSha: "bbb", subject: "middle", authorName: "B", authoredAt: 0 },
  { sha: "ccc", shortSha: "ccc", subject: "newest", authorName: "C", authoredAt: 0 },
];

function mount(node: React.ReactElement): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => flushSync(() => root.render(node)));
  return {
    container,
    unmount: () => {
      act(() => flushSync(() => root.unmount()));
      container.remove();
    },
  };
}

async function openPicker(container: HTMLDivElement): Promise<void> {
  const trigger = container.querySelector<HTMLButtonElement>(".commit-range-picker__trigger")!;
  await act(async () => {
    trigger.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickCommit(container: HTMLDivElement, sha: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>("[role=option]")].find((node) =>
    node.textContent?.includes(sha),
  );
  expect(button).toBeTruthy();
  act(() => button!.click());
}

describe("CommitRangePicker", () => {
  let setCommitRange: ReturnType<typeof vi.fn>;

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function setup(commitList = commits): void {
    setCommitRange = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.stubGlobal("window", {
      pivis: {
        invoke: vi.fn(async (channel: string) => {
          if (channel === "git.commits") {
            return {
              kind: "ok",
              head: commitList.at(-1)?.sha ?? "head",
              mergeBase: "base",
              commits: commitList,
              truncated: false,
            };
          }
          return {
            kind: "ok",
            repoRoot: "/repo",
            files: [],
            truncated: false,
            fingerprint: "clean",
          };
        }),
      },
    });
    useDiffStore.setState({
      root: "/repo",
      selectedBase: "main",
      commitRange: null,
      editSession: null,
      commentEditorFiles: new Set(),
      setCommitRange,
    });
  }

  it("is disabled while a comment editor owns an unsaved draft", () => {
    setup();
    useDiffStore.setState({ commentEditorFiles: new Set(["file.ts"]) });
    const view = mount(<CommitRangePicker />);

    expect(
      view.container.querySelector<HTMLButtonElement>(".commit-range-picker__trigger")?.disabled,
    ).toBe(true);
    view.unmount();
  });

  it("makes the first click a one-commit draft", async () => {
    setup();
    const view = mount(<CommitRangePicker />);
    await openPicker(view.container);

    clickCommit(view.container, "bbb");

    expect(view.container.querySelector(".commit-range-picker__endpoint")?.textContent).toBe(
      "Only",
    );
    expect(view.container.querySelector(".commit-range-picker__apply")?.textContent).toContain(
      "Show 1 commit",
    );
    view.unmount();
  });

  it("normalizes a reverse-order second click", async () => {
    setup();
    const view = mount(<CommitRangePicker />);
    await openPicker(view.container);

    clickCommit(view.container, "ccc");
    clickCommit(view.container, "aaa");

    expect(view.container.querySelector(".commit-range-picker__apply")?.textContent).toContain(
      "Show 3 commits",
    );
    expect(view.container.querySelectorAll(".commit-range-picker__endpoint")[0]?.textContent).toBe(
      "End",
    );
    expect(view.container.querySelectorAll(".commit-range-picker__endpoint")[1]?.textContent).toBe(
      "Start",
    );
    view.unmount();
  });

  it("keeps long histories compact and virtualized", async () => {
    const longHistory = Array.from({ length: 500 }, (_, index) => ({
      sha: `commit-${index}`,
      shortSha: index.toString(16).padStart(8, "0"),
      subject: `Commit ${index}`,
      authorName: `Author ${index}`,
      authoredAt: index,
    }));
    setup(longHistory);
    const view = mount(<CommitRangePicker />);
    await openPicker(view.container);

    expect(view.container.querySelectorAll("[role=option]").length).toBeLessThan(40);
    expect(
      view.container.querySelector<HTMLElement>(".commit-range-picker__spacer")?.style.height,
    ).toBe("22000px");
    view.unmount();
  });

  it("navigates the virtualized commit list with the keyboard", async () => {
    setup();
    const view = mount(<CommitRangePicker />);
    await openPicker(view.container);
    const listbox = view.container.querySelector<HTMLDivElement>("[role=listbox]")!;

    act(() => {
      listbox.focus();
      listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    act(() => {
      listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(view.container.querySelector(".commit-range-picker__endpoint")?.textContent).toBe(
      "Only",
    );
    expect(
      view.container.querySelector(".commit-range-picker__commit--selected")?.textContent,
    ).toContain("oldest");
    view.unmount();
  });

  it("applies the draft once", async () => {
    setup();
    const view = mount(<CommitRangePicker />);
    await openPicker(view.container);
    clickCommit(view.container, "bbb");

    act(() =>
      view.container.querySelector<HTMLButtonElement>(".commit-range-picker__apply")!.click(),
    );

    expect(setCommitRange).toHaveBeenCalledTimes(1);
    expect(setCommitRange).toHaveBeenCalledWith({ start: "bbb", end: "bbb" });
    view.unmount();
  });

  it("Escape discards the draft and does not leak to the viewer", async () => {
    setup();
    const view = mount(<CommitRangePicker />);
    await openPicker(view.container);
    expect(document.activeElement?.textContent).toContain("Working tree");
    clickCommit(view.container, "bbb");

    const trigger = view.container.querySelector<HTMLButtonElement>(
      ".commit-range-picker__trigger",
    )!;
    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => document.dispatchEvent(escapeEvent));
    await act(async () => Promise.resolve());

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(view.container.querySelector(".commit-range-picker__popup")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(setCommitRange).not.toHaveBeenCalled();
    view.unmount();
  });
});
