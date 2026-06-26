import { describe, expect, it } from "vitest";
import { formatMiB, parseSizeToMiB } from "./file-size.js";

describe("parseSizeToMiB", () => {
  it("reads a bare number as MiB", () => {
    expect(parseSizeToMiB("5")).toBe(5);
    expect(parseSizeToMiB("1.5")).toBe(1.5);
  });

  it("parses MiB/MB/M (binary, case-insensitive, whitespace-tolerant)", () => {
    expect(parseSizeToMiB("5mb")).toBe(5);
    expect(parseSizeToMiB("5 MiB")).toBe(5);
    expect(parseSizeToMiB("  5M ")).toBe(5);
  });

  it("parses KiB and GiB relative to MiB", () => {
    expect(parseSizeToMiB("512kb")).toBe(0.5);
    expect(parseSizeToMiB("1gb")).toBe(1024);
    expect(parseSizeToMiB("1.5 GiB")).toBe(1536);
  });

  it("parses raw bytes", () => {
    expect(parseSizeToMiB("1048576b")).toBe(1);
  });

  it("rejects garbage, negatives, and unknown units", () => {
    expect(parseSizeToMiB("")).toBeNull();
    expect(parseSizeToMiB("abc")).toBeNull();
    expect(parseSizeToMiB("-5mb")).toBeNull();
    expect(parseSizeToMiB("5tb")).toBeNull();
    expect(parseSizeToMiB("5 mb extra")).toBeNull();
  });
});

describe("formatMiB", () => {
  it("picks a natural unit for the magnitude", () => {
    expect(formatMiB(5)).toBe("5 MiB");
    expect(formatMiB(1.5)).toBe("1.5 MiB");
    expect(formatMiB(0.5)).toBe("512 KiB");
    expect(formatMiB(1024)).toBe("1 GiB");
    expect(formatMiB(1536)).toBe("1.5 GiB");
  });

  it("round-trips with parseSizeToMiB", () => {
    for (const mib of [1, 5, 0.5, 1024, 1536]) {
      expect(parseSizeToMiB(formatMiB(mib))).toBe(mib);
    }
  });
});
