import { normalizeText } from "./text-normalization.js";

export interface SearchQueryTerm {
  text: string;
  quoted: boolean;
  /** Only an unquoted final term is a prefix while the user is typing. */
  prefix: boolean;
}

export const MAX_SEARCH_QUERY_TERMS = 16;

export interface ParsedSearchQuery {
  raw: string;
  terms: readonly SearchQueryTerm[];
}

/** Plain text only: quote-delimited phrases and whitespace-delimited terms. */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const terms: SearchQueryTerm[] = [];
  let cursor = 0;
  while (cursor < query.length && terms.length < MAX_SEARCH_QUERY_TERMS) {
    while (/\s/u.test(query[cursor] ?? "")) cursor++;
    if (cursor >= query.length) break;
    const quoted = query[cursor] === '"';
    if (quoted) cursor++;
    const start = cursor;
    if (quoted) {
      while (cursor < query.length && query[cursor] !== '"') cursor++;
    } else {
      while (cursor < query.length && !/\s/u.test(query[cursor] ?? "")) cursor++;
    }
    const value = normalizeText(query.slice(start, cursor).trim());
    if (value) terms.push({ text: value, quoted, prefix: false });
    if (quoted && query[cursor] === '"') cursor++;
  }
  const final = terms.at(-1);
  if (final && !final.quoted) final.prefix = true;
  return { raw: query, terms };
}
