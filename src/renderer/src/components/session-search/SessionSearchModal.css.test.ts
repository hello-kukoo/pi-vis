import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SessionSearchModal CSS", () => {
  it("keeps result fades out of the scrollbar lane", () => {
    const css = readFileSync(new URL("./SessionSearchModal.css", import.meta.url), "utf8");
    const frameCss = readFileSync(
      new URL("../common/ScrollFadeFrame.css", import.meta.url),
      "utf8",
    );
    const paneRule =
      css.match(
        /\.session-search__context-pane,\s*\.session-search__results-pane\s*{(?<body>[^}]*)}/s,
      )?.groups?.body ?? "";

    expect(paneRule).toContain("overflow-y: auto;");
    expect(paneRule).toContain("overflow-x: hidden;");
    expect(frameCss).toMatch(/\.scroll-fade-frame__edge\s*{[^}]*right: var\(--scrollbar-size\);/s);
    expect(frameCss).toMatch(
      /\.scroll-fade-frame--horizontal \.scroll-fade-frame__edge--bottom\s*{[^}]*bottom: var\(--scrollbar-size\);/s,
    );
    expect(css).not.toMatch(/\.session-search__results-pane[^{}]*{[^}]*mask-image:/s);
  });
});
