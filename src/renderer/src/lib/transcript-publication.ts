import type { RendererPublication } from "@shared/pi-protocol/runtime-state.js";

/**
 * Returns whether a sequenced transcript publication contains any requested
 * Pi event. Runtime hosts publish transcript events on this authority plane;
 * `session.events` is only a legacy compatibility channel.
 */
export function transcriptPublicationIncludes(
  publication: RendererPublication,
  eventTypes: readonly string[],
): boolean {
  if (publication.plane !== "transcript" || publication.payload.kind !== "delta") return false;
  return publication.payload.entries.some(
    (entry) =>
      !!entry &&
      typeof entry === "object" &&
      "type" in entry &&
      typeof entry.type === "string" &&
      eventTypes.includes(entry.type),
  );
}
