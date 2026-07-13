/** Search text is folded for retrieval; source text is never modified. */
export interface NormalizedText {
  original: string;
  normalized: string;
  /** Whole tokens plus useful identifier/path components, all folded. */
  components: readonly string[];
}

const WORD_OR_IDENTIFIER = /[\p{L}\p{N}_./\\-]+/gu;

export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("und");
}

/**
 * Split identifiers without losing the original complete token. This is used
 * as a secondary retrieval field, so punctuation-bearing code is still
 * available as its complete normalized token.
 */
export function deriveSearchComponents(text: string): string[] {
  const components = new Set<string>();
  const normalized = normalizeText(text);
  for (const token of normalized.match(WORD_OR_IDENTIFIER) ?? []) {
    components.add(token);
    for (const piece of token.split(/[./\\_-]+/u)) {
      if (piece) components.add(piece);
    }
    // The source was folded above, but camel boundaries must be discovered
    // from its original spelling.
  }
  for (const token of text.normalize("NFKC").match(WORD_OR_IDENTIFIER) ?? []) {
    for (const identifier of token.split(/[./\\_-]+/u)) {
      if (!identifier) continue;
      for (const piece of identifier.split(/(?<=[\p{Ll}\d])(?=[\p{Lu}])/u)) {
        const folded = normalizeText(piece);
        if (folded) components.add(folded);
      }
    }
  }
  return [...components];
}

export function normalizeForSearch(text: string): NormalizedText {
  return {
    original: text,
    normalized: normalizeText(text),
    components: deriveSearchComponents(text),
  };
}
