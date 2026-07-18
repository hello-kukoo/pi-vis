import type React from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import "./ScrollFadeFrame.css";

type ScrollFadeFrameProps = Omit<React.HTMLAttributes<HTMLDivElement>, "onScroll"> & {
  /** Optional class for the non-scrolling frame that owns the fade overlays. */
  frameClassName?: string | undefined;
  /** Ref consumed by virtual-list or focus-management callers. */
  scrollerRef?: React.Ref<HTMLDivElement> | undefined;
  /** Called after the frame has refreshed its edge state. */
  onScroll?: React.UIEventHandler<HTMLDivElement> | undefined;
  /** Reserve the bottom scrollbar lane as well as the right lane. */
  horizontalScrollbar?: boolean | undefined;
  /** Let the frame participate as the flexible child in a bounded column. */
  fill?: boolean | undefined;
};

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * Non-scrolling shell for bounded scrollers. Edge fades are siblings of the
 * scroll owner, so neither the vertical nor horizontal scrollbar lane is
 * composited through a mask or overlay.
 */
export function ScrollFadeFrame({
  frameClassName,
  scrollerRef,
  onScroll,
  horizontalScrollbar = false,
  fill = false,
  className,
  children,
  ...scrollerProps
}: ScrollFadeFrameProps): React.ReactElement {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const updateEdges = useCallback((): void => {
    const element = localRef.current;
    if (!element) return;
    const next = {
      top: element.scrollTop > 1,
      bottom: element.scrollHeight - element.scrollTop - element.clientHeight > 1,
    };
    setEdges((current) =>
      current.top === next.top && current.bottom === next.bottom ? current : next,
    );
  }, []);

  const setScroller = useCallback(
    (element: HTMLDivElement | null): void => {
      localRef.current = element;
      assignRef(scrollerRef, element);
    },
    [scrollerRef],
  );

  useLayoutEffect(() => {
    const element = localRef.current;
    if (!element) return;
    updateEdges();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateEdges);
    resizeObserver?.observe(element);
    for (const child of element.children) resizeObserver?.observe(child);

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            for (const child of element.children) resizeObserver?.observe(child);
            updateEdges();
          });
    mutationObserver?.observe(element, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [updateEdges]);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>): void => {
      updateEdges();
      onScroll?.(event);
    },
    [onScroll, updateEdges],
  );

  const frameClasses = [
    "scroll-fade-frame",
    fill ? "scroll-fade-frame--fill" : "",
    horizontalScrollbar ? "scroll-fade-frame--horizontal" : "",
    frameClassName ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={frameClasses}>
      <div className="scroll-fade-frame__viewport">
        <div
          {...scrollerProps}
          ref={setScroller}
          className={`scroll-fade-frame__scroller${className ? ` ${className}` : ""}`}
          onScroll={handleScroll}
        >
          {children}
        </div>
        {edges.top && (
          <div
            className="scroll-fade-frame__edge scroll-fade-frame__edge--top"
            aria-hidden="true"
          />
        )}
        {edges.bottom && (
          <div
            className="scroll-fade-frame__edge scroll-fade-frame__edge--bottom"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}
