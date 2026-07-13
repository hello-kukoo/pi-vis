import type { SessionSearchRole } from "@shared/session-search.js";
import type { ParsedSearchQuery, SearchQueryTerm } from "./query-parser.js";

export interface RankableSegment {
  id: string;
  sessionId: string;
  role: SessionSearchRole;
  normalizedText: string;
  derivedComponents?: readonly string[] | undefined;
  fileOrdinal: number;
  timestamp?: number | null | undefined;
  pinned?: boolean | undefined;
  /** Number of otherwise-missing query terms evidenced by neighboring entries. */
  neighboringTermCount?: number | undefined;
}

export interface RankedSegment<T extends RankableSegment> {
  segment: T;
  score: number;
  matchedTerms: readonly string[];
  closeMatchTerms: readonly string[];
}

const TOKEN = /[\p{L}\p{N}_./\\-]+/gu;
const WORD = /^[\p{L}]+$/u;

function tokens(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

export function boundedEditDistance(left: string, right: string, maximum = 1): number | undefined {
  if (Math.abs(left.length - right.length) > maximum) return undefined;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    let lowest = current[0] ?? row;
    for (let column = 1; column <= right.length; column++) {
      const substitution =
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1);
      const insertion = (current[column - 1] ?? 0) + 1;
      const deletion = (previous[column] ?? 0) + 1;
      const value = Math.min(substitution, insertion, deletion);
      current.push(value);
      lowest = Math.min(lowest, value);
    }
    if (lowest > maximum) return undefined;
    previous = current;
  }
  return (previous[right.length] ?? maximum + 1) <= maximum ? previous[right.length] : undefined;
}

export function isTypoEligible(term: string): boolean {
  return term.length >= 5 && WORD.test(term);
}

/** Bounded, deterministic typo alternatives; code/path syntax is intentionally excluded. */
export function findTypoAlternatives(
  term: string,
  dictionary: Iterable<string>,
  limit = 8,
): string[] {
  if (!isTypoEligible(term)) return [];
  const maxDistance = term.length >= 9 ? 2 : 1;
  const matches: Array<{ value: string; distance: number }> = [];
  for (const value of dictionary) {
    if (!isTypoEligible(value)) continue;
    const distance = boundedEditDistance(term, value, maxDistance);
    if (distance !== undefined) matches.push({ value, distance });
  }
  return matches
    .sort((a, b) => a.distance - b.distance || a.value.localeCompare(b.value))
    .slice(0, limit)
    .map(({ value }) => value);
}

function matchTerm(
  segment: RankableSegment,
  term: SearchQueryTerm,
): "phrase" | "token" | "derived" | "typo" | undefined {
  const text = segment.normalizedText;
  if (term.quoted) return text.includes(term.text) ? "phrase" : undefined;
  const words = tokens(text);
  if (words.some((word) => (term.prefix ? word.startsWith(term.text) : word === term.text)))
    return "token";
  const components = segment.derivedComponents ?? [];
  if (
    components.some((component) =>
      term.prefix ? component.startsWith(term.text) : component === term.text,
    )
  ) {
    return "derived";
  }
  if (
    isTypoEligible(term.text) &&
    words.some(
      (word) => boundedEditDistance(term.text, word, term.text.length >= 9 ? 2 : 1) !== undefined,
    )
  ) {
    return "typo";
  }
  return undefined;
}

function roleBase(
  role: SessionSearchRole,
  strength: "phrase" | "token" | "derived" | "typo",
): number {
  if (strength === "derived") return 150;
  if (strength === "typo") return 60;
  if (role === "session-name") return strength === "phrase" ? 1100 : 1000;
  if (role === "user") return strength === "phrase" ? 950 : 850;
  if (role === "assistant" || role === "error") return strength === "phrase" ? 750 : 650;
  return strength === "phrase" ? 700 : 600;
}

/**
 * Scores persisted segments only. Exact terms dominate weak recency; callers
 * may pass already bounded candidates from their index stage.
 */
export function rankSearchCandidates<T extends RankableSegment>(
  candidates: readonly T[],
  query: ParsedSearchQuery,
  limit = 200,
): RankedSegment<T>[] {
  if (!query.terms.length) return [];
  const ranked: RankedSegment<T>[] = [];
  for (const segment of candidates) {
    const matched = query.terms.map((term) => ({ term, strength: matchTerm(segment, term) }));
    const strengths = matched.flatMap(({ strength }) => (strength ? [strength] : []));
    if (!strengths.length) continue;
    const best = strengths.includes("phrase")
      ? "phrase"
      : strengths.includes("token")
        ? "token"
        : strengths.includes("derived")
          ? "derived"
          : "typo";
    const sameSegment = strengths.length === query.terms.length;
    const score =
      roleBase(segment.role, best) +
      (sameSegment ? 120 : 0) +
      (segment.neighboringTermCount ?? 0) * 35 +
      (segment.pinned ? 8 : 0) +
      Math.min(5, Math.max(0, segment.fileOrdinal) / 1_000_000);
    ranked.push({
      segment,
      score,
      matchedTerms: matched.flatMap(({ term, strength }) => (strength ? [term.text] : [])),
      closeMatchTerms: matched.flatMap(({ term, strength }) =>
        strength === "typo" ? [term.text] : [],
      ),
    });
  }
  return ranked
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.segment.fileOrdinal - a.segment.fileOrdinal ||
        a.segment.id.localeCompare(b.segment.id),
    )
    .slice(0, limit);
}

/** Apply a hard cap before expensive reranking/typo work. */
export function boundCandidates<T>(candidates: Iterable<T>, limit: number): T[] {
  const bounded: T[] = [];
  for (const candidate of candidates) {
    if (bounded.length >= Math.max(0, limit)) break;
    bounded.push(candidate);
  }
  return bounded;
}
