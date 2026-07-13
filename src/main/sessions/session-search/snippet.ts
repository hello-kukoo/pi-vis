import { normalizeText } from "./text-normalization.js";

export interface TextRange {
  start: number;
  end: number;
}

export interface SearchSnippet {
  text: string;
  /** Ranges are UTF-16 offsets in `text`, suitable for rendering source text. */
  matchRanges: readonly TextRange[];
  sourceStart: number;
  sourceEnd: number;
}

interface MappedNormalization {
  value: string;
  sourceRanges: TextRange[];
}

// NFKC is performed per source code point so every folded UTF-16 code unit has
// an authoritative source range. This intentionally favors reliable snippet
// highlighting over using a lossy FTS offset.
function normalizeWithSourceMap(text: string): MappedNormalization {
  let value = "";
  const sourceRanges: TextRange[] = [];
  const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text);
  for (const grapheme of graphemes) {
    const start = grapheme.index;
    const end = start + grapheme.segment.length;
    const folded = normalizeText(grapheme.segment);
    value += folded;
    for (let index = 0; index < folded.length; index++) sourceRanges.push({ start, end });
  }
  return { value, sourceRanges };
}

/**
 * Counts every non-overlapping occurrence but retains only a bounded prefix of
 * ranges. Query code uses this to avoid materializing attacker-controlled
 * thousands of repeated-match objects from one persisted segment.
 */
export function findOriginalMatchRangesBounded(
  text: string,
  query: string,
  limit: number,
): { ranges: TextRange[]; total: number } {
  const needle = normalizeText(query);
  if (!needle) return { ranges: [], total: 0 };
  const mapped = normalizeWithSourceMap(text);
  const ranges: TextRange[] = [];
  let total = 0;
  let from = 0;
  const boundedLimit = Math.max(0, Math.floor(limit));
  while (from <= mapped.value.length - needle.length) {
    const index = mapped.value.indexOf(needle, from);
    if (index === -1) break;
    const first = mapped.sourceRanges[index];
    const last = mapped.sourceRanges[index + needle.length - 1];
    if (first && last) {
      total++;
      if (ranges.length < boundedLimit) ranges.push({ start: first.start, end: last.end });
    }
    from = index + Math.max(1, needle.length);
  }
  return { ranges, total };
}

/** All non-overlapping occurrences, preserving repeated source occurrences. */
export function findOriginalMatchRanges(text: string, query: string): TextRange[] {
  return findOriginalMatchRangesBounded(text, query, Number.MAX_SAFE_INTEGER).ranges;
}

/**
 * Creates a source-text excerpt around a specified repeated occurrence. The
 * occurrence index is explicit so a target never silently highlights the
 * first identical phrase instead.
 */
export function createSnippet(
  text: string,
  ranges: readonly TextRange[],
  options: { occurrence?: number; context?: number } = {},
): SearchSnippet {
  const occurrence = Math.max(0, options.occurrence ?? 0);
  const target = ranges[occurrence] ?? ranges[0];
  const context = Math.max(0, options.context ?? 80);
  if (!target)
    return {
      text: text.slice(0, context * 2),
      matchRanges: [],
      sourceStart: 0,
      sourceEnd: Math.min(text.length, context * 2),
    };
  const sourceStart = Math.max(0, target.start - context);
  const sourceEnd = Math.min(text.length, target.end + context);
  return {
    text: text.slice(sourceStart, sourceEnd),
    matchRanges: ranges
      .filter((range) => range.start >= sourceStart && range.end <= sourceEnd)
      .map((range) => ({
        start: Math.max(range.start, sourceStart) - sourceStart,
        end: Math.min(range.end, sourceEnd) - sourceStart,
      })),
    sourceStart,
    sourceEnd,
  };
}
