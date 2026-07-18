// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ScrollFadeFrame } from "./ScrollFadeFrame.js";

describe("ScrollFadeFrame", () => {
  it("shows only edges that still have clipped content", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <ScrollFadeFrame aria-label="bounded list">
          <div>rows</div>
        </ScrollFadeFrame>,
      );
    });
    const scroller = host.querySelector<HTMLElement>("[aria-label='bounded list']")!;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    act(() => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(host.querySelector(".scroll-fade-frame__edge--top")).toBeNull();
    expect(host.querySelector(".scroll-fade-frame__edge--bottom")).not.toBeNull();

    scroller.scrollTop = 100;
    act(() => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(host.querySelector(".scroll-fade-frame__edge--top")).not.toBeNull();
    expect(host.querySelector(".scroll-fade-frame__edge--bottom")).not.toBeNull();

    scroller.scrollTop = 200;
    act(() => scroller.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(host.querySelector(".scroll-fade-frame__edge--top")).not.toBeNull();
    expect(host.querySelector(".scroll-fade-frame__edge--bottom")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("composes external refs and scroll handlers", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const ref = { current: null as HTMLDivElement | null };
    const onScroll = vi.fn();
    act(() => {
      root.render(
        <ScrollFadeFrame scrollerRef={ref} onScroll={onScroll} horizontalScrollbar>
          content
        </ScrollFadeFrame>,
      );
    });
    expect(ref.current).not.toBeNull();
    expect(host.querySelector(".scroll-fade-frame--horizontal")).not.toBeNull();
    act(() => ref.current?.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(onScroll).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(ref.current).toBeNull();
    host.remove();
  });
});
