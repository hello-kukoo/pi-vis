import type { ModelInfo } from "@shared/pi-protocol/responses.js";

/**
 * Stable composite identity for a model: ``${provider}/${id}``.
 *
 * The same model `id` can be offered by several providers (e.g. an
 * open-weights model served through two different subscriptions/APIs). The
 * old code keyed React lists and matched the "selected" item on `id` alone,
 * which (a) collided keys in `.map()` so React silently de-duplicated the
 * rows, and (b) made the active highlight ambiguous. Keying on the composite
 * makes each provider's copy a distinct, selectable item.
 */
export function modelKey(m: { provider?: string | undefined; id: string }): string {
  return `${m.provider ?? ""}/${m.id}`;
}

/**
 * Human label with the provider in brackets, mirroring pi's TUI
 * (`glm-5.2 [zai]`). Falls back to the bare name/id when a provider isn't
 * known, so legacy shapes render unchanged.
 */
export function modelDisplayName(m: {
  name?: string | undefined;
  provider?: string | undefined;
  id: string;
}): string {
  const base = m.name ?? m.id;
  return m.provider ? `${base} [${m.provider}]` : base;
}

/**
 * True when `m` is the session's active model. Matches on `id`, and — when
 * the current provider is known — additionally requires the provider to
 * match, so that out of two same-id entries only the actually-selected one
 * is highlighted. When the current provider is unknown (older pi / data race)
 * it falls back to id-only matching, preserving the prior behaviour.
 */
export function isCurrentModel(
  m: { provider?: string | undefined; id: string },
  currentModel?: string | undefined,
  currentProvider?: string | undefined,
): boolean {
  if (!currentModel) return false;
  if (m.id !== currentModel) return false;
  // When we know the active provider, require an exact provider match so that
  // same-id entries from other providers (and legacy no-provider entries)
  // don't also light up — the whole point of provider-aware matching.
  if (currentProvider != null) return m.provider === currentProvider;
  // Provider unknown: id-only fallback (legacy pi shapes / pre-get_state).
  return true;
}

/**
 * Find the active model entry within a list. Uses {@link isCurrentModel} so a
 * known provider disambiguates same-id copies.
 */
export function findCurrentModel(
  models: readonly ModelInfo[],
  currentModel?: string | undefined,
  currentProvider?: string | undefined,
): ModelInfo | undefined {
  return models.find((m) => isCurrentModel(m, currentModel, currentProvider));
}
