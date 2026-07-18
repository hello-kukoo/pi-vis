import type { RendererPublication } from "@shared/pi-protocol/runtime-state.js";
import { describe, expect, it } from "vitest";
import { transcriptPublicationIncludes } from "./transcript-publication.js";

function transcriptPublication(entries: unknown[]): RendererPublication {
  const owner = { hostInstanceId: "host", sessionEpoch: 1 };
  return {
    sessionId: "session",
    rendererGeneration: 1,
    publicationSequence: 1,
    plane: "transcript",
    owner,
    payload: {
      kind: "delta",
      cursor: { ...owner, transportSequence: 1, snapshotSequence: 1 },
      liveTailCursor: "1",
      entries,
    },
  };
}

describe("transcriptPublicationIncludes", () => {
  it("recognizes tool completion and turn settlement from authority publications", () => {
    const publication = transcriptPublication([
      {
        type: "tool_execution_end",
        toolCallId: "call",
        toolName: "write",
        result: {},
        isError: false,
      },
      { type: "agent_end" },
    ]);

    expect(transcriptPublicationIncludes(publication, ["tool_execution_end"])).toBe(true);
    expect(transcriptPublicationIncludes(publication, ["agent_end"])).toBe(true);
  });

  it("ignores unrelated transcript entries", () => {
    expect(
      transcriptPublicationIncludes(transcriptPublication([{ type: "message_update" }]), [
        "agent_end",
      ]),
    ).toBe(false);
  });
});
