// Shared single-line truncation treatment: instead of an ellipsis, text that
// doesn't fit fades out at the trailing edge, and hovering it (or a parent
// marked `.fade-scope`) glides the text sideways to reveal the tail, then
// glides back on leave. Non-overflowing text renders untouched — the mask and
// the marquee only engage when the measured content is wider than the box.
//
// Usage: replace `<span className="x">{text}</span>` (where .x ellipsized)
// with `<FadeText className="x">{text}</FadeText>`; the site class keeps its
// layout/color duties (flex, min-width: 0, color) and FadeText owns clipping.

import { useLayoutEffect, useRef } from "react";
import "./FadeText.css";

interface FadeTextProps {
  children: React.ReactNode;
  className?: string;
  /** Preserve whitespace runs (pre-formatted content, e.g. widget lines). */
  pre?: boolean;
  /**
   * Truncate the head instead of the tail: at rest the END of the text is
   * visible and the leading edge fades (for values whose tail matters, e.g.
   * long directory paths); hovering reveals the head. Replaces the old
   * `direction: rtl` left-ellipsis hack.
   */
  head?: boolean;
  title?: string;
}

// Reveal glide pacing: proportional to the hidden distance so short and long
// overflows both read at the same speed, clamped so tiny overflows don't
// blink and huge paths don't crawl forever.
const REVEAL_MS_PER_PX = 14;
const REVEAL_MIN_MS = 450;
const REVEAL_MAX_MS = 4500;

export function FadeText({ children, className, pre = false, head = false, title }: FadeTextProps) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const measure = () => {
      // Rect widths are sub-pixel accurate; translateX doesn't change them,
      // so a mid-glide re-measure (from a container resize) stays correct.
      const overflow = inner.getBoundingClientRect().width - outer.getBoundingClientRect().width;
      if (overflow > 1) {
        outer.dataset.overflow = "true";
        outer.style.setProperty("--fade-shift", `${-overflow}px`);
        const ms = Math.min(REVEAL_MAX_MS, Math.max(REVEAL_MIN_MS, overflow * REVEAL_MS_PER_PX));
        outer.style.setProperty("--fade-dur", `${ms}ms`);
      } else if (outer.dataset.overflow) {
        delete outer.dataset.overflow;
        outer.style.removeProperty("--fade-shift");
        outer.style.removeProperty("--fade-dur");
      }
    };

    // jsdom (unit tests) has no ResizeObserver — degrade to a one-shot
    // measure so the component renders as plain clipped text.
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }

    // Observing both catches container resizes (outer) and content changes —
    // new text, font swap — (inner) without effect re-runs.
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    measure();
    return () => ro.disconnect();
  }, []);

  return (
    <span
      ref={outerRef}
      className={`fade-text${pre ? " fade-text--pre" : ""}${head ? " fade-text--head" : ""}${className ? ` ${className}` : ""}`}
      title={title}
    >
      <span ref={innerRef} className="fade-text__inner">
        {children}
      </span>
    </span>
  );
}
