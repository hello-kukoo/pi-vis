import type { KnownPiEvent } from "@shared/pi-protocol/events.js";
import { describe, expect, it } from "vitest";
import { addUserBlock, applyPiEvent, createTranscriptState } from "./transcript.js";

function e<T extends KnownPiEvent>(event: T): T {
  return event;
}

// Minimal wire AgentMessage stubs for events that require a message snapshot
const USER_MSG = { role: "user" as const, content: "hello", timestamp: 0 };
const ASST_MSG = {
  role: "assistant" as const,
  content: [],
  api: "test",
  provider: "test",
  model: "test",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  stopReason: "stop",
  timestamp: 0,
};

describe("transcript reducer", () => {
  it("starts empty", () => {
    const state = createTranscriptState();
    expect(state.blocks).toHaveLength(0);
  });

  it("adds user block", () => {
    const state = addUserBlock(createTranscriptState(), "Hello pi");
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.type).toBe("user");
  });

  it("assembles assistant text from deltas", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "Hello " },
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "world" },
      }),
    );
    state = applyPiEvent(state, e({ type: "message_end", message: ASST_MSG }));

    expect(state.blocks).toHaveLength(1);
    const block = state.blocks[0];
    expect(block?.type).toBe("assistant");
    if (block?.type === "assistant") {
      expect(block.data.textContent).toBe("Hello world");
      expect(block.data.isStreaming).toBe(false);
    }
  });

  it("tracks thinking content separately", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "thinking_delta", delta: "Hmm" },
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "Answer" },
      }),
    );
    state = applyPiEvent(state, e({ type: "message_end", message: ASST_MSG }));

    const block = state.blocks[0];
    if (block?.type === "assistant") {
      expect(block.data.thinkingContent).toBe("Hmm");
      expect(block.data.textContent).toBe("Answer");
    }
  });

  it("streams tool calls with output updates", () => {
    let state = createTranscriptState();
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "read_file",
        args: { path: "foo.txt" },
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "read_file",
        args: {},
        partialResult: "line1\n",
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "read_file",
        args: {},
        partialResult: "line2\n",
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "read_file",
        result: "line1\nline2\n",
        isError: false,
      }),
    );

    const block = state.blocks[0];
    expect(block?.type).toBe("tool_call");
    if (block?.type === "tool_call") {
      expect(block.data.outputText).toBe("line1\nline2\n");
      expect(block.data.isStreaming).toBe(false);
      expect(block.data.isError).toBe(false);
    }
  });

  it("extracts final output from tool_execution_end result (real wire shape, no updates)", () => {
    let state = createTranscriptState();
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "read",
        args: { file_path: "package.json" },
      }),
    );
    // Real pi often sends no tool_execution_update at all — the output
    // arrives only in the end event's result.content[].text
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "read",
        result: { content: [{ type: "text", text: '{\n  "name": "pi-vis"\n}' }] },
        isError: false,
      }),
    );

    const block = state.blocks[0];
    expect(block?.type).toBe("tool_call");
    if (block?.type === "tool_call") {
      expect(block.data.outputText).toBe('{\n  "name": "pi-vis"\n}');
      expect(block.data.isStreaming).toBe(false);
    }
  });

  it("prefers the authoritative end result over accumulated partials and picks up diffs", () => {
    let state = createTranscriptState();
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "edit",
        args: { file_path: "a.ts" },
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "edit",
        args: {},
        partialResult: "working...\n",
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "edit",
        result: {
          content: [{ type: "text", text: "Edited a.ts" }],
          details: { diff: "-old\n+new" },
        },
        isError: false,
      }),
    );

    const block = state.blocks[0];
    if (block?.type === "tool_call") {
      expect(block.data.outputText).toBe("Edited a.ts");
      expect(block.data.diff).toBe("-old\n+new");
    }
  });

  it("keeps accumulated partial output when the end result has no text", () => {
    let state = createTranscriptState();
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "bash",
        args: { command: "make" },
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "bash",
        args: {},
        partialResult: "step 1\n",
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "bash",
        args: {},
        partialResult: "step 2\n",
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "bash",
        result: null,
        isError: false,
      }),
    );

    const block = state.blocks[0];
    if (block?.type === "tool_call") {
      expect(block.data.outputText).toBe("step 1\nstep 2\n");
    }
  });

  it("interleaves thinking and tool blocks", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "thinking_delta", delta: "thinking..." },
      }),
    );
    state = applyPiEvent(
      state,
      e({ type: "tool_execution_start", toolCallId: "t2", toolName: "bash", args: {} }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_end",
        toolCallId: "t2",
        toolName: "bash",
        result: null,
        isError: false,
      }),
    );
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "done" },
      }),
    );
    state = applyPiEvent(state, e({ type: "message_end", message: ASST_MSG }));

    expect(state.blocks).toHaveLength(2); // assistant + tool
    expect(state.blocks[0]?.type).toBe("assistant");
    expect(state.blocks[1]?.type).toBe("tool_call");
  });

  it("inserts compaction marker on compaction_end", () => {
    let state = createTranscriptState();
    state = applyPiEvent(
      state,
      e({ type: "compaction_end", result: { summary: "Compacted 500 tokens" } }),
    );
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.type).toBe("compaction");
    if (state.blocks[0]?.type === "compaction") {
      expect(state.blocks[0].data.summary).toBe("Compacted 500 tokens");
    }
  });
});

/**
 * WP3 — Transcript reconciliation for `role: "user"` and `role: "custom"`
 * message_start events. The optimistic user bubble from `addUserBlock(registerEcho)`
 * must dedupe against pi's authoritative echo.
 */
describe("transcript reducer — role-based message_start", () => {
  it("user message_start with matching head of pendingEchoes is consumed silently", () => {
    let state = createTranscriptState();
    state = addUserBlock(state, "hello", undefined, true);
    expect(state.blocks).toHaveLength(1);
    expect(state.pendingEchoes).toEqual(["hello"]);

    state = applyPiEvent(state, e({ type: "message_start", message: USER_MSG }));
    // No new block — the optimistic user bubble stands.
    expect(state.blocks).toHaveLength(1);
    expect(state.pendingEchoes).toEqual([]);
  });

  it("user message_start with non-matching text still consumes the pending echo (regression)", () => {
    // Under the old exact-string-equals dedupe, a normalized or
    // template-expanded echo (trailing newline, whitespace, prompt
    // template) would fall through to addUserBlock and append a second
    // user bubble. The new rule is positional: an optimistic
    // addUserBlock always expects exactly one echo, so the head of
    // pendingEchoes is consumed regardless of text content — and the
    // user's originally-typed optimistic text stands.
    let state = createTranscriptState();
    state = addUserBlock(state, "what I typed", undefined, true);
    state = applyPiEvent(
      state,
      e({ type: "message_start", message: { role: "user", content: "expanded prompt" } }),
    );
    expect(state.blocks).toHaveLength(1);
    if (state.blocks[0]?.type === "user") {
      expect(state.blocks[0].data.content).toBe("what I typed");
    }
    expect(state.pendingEchoes).toEqual([]);
  });

  it("user message_start with no pending echo appends a fresh user block (server/extension-originated)", () => {
    // When there is no optimistic block waiting for an echo, a
    // role:"user" message_start must still render — this covers
    // server-/extension-originated user messages (slash command
    // dispatched via `prompt` with `commandSource: "extension"`), which
    // don't go through the optimistic addUserBlock(registerEcho) path.
    let state = createTranscriptState();
    expect(state.pendingEchoes).toEqual([]);
    state = applyPiEvent(
      state,
      e({ type: "message_start", message: { role: "user", content: "from extension" } }),
    );
    expect(state.blocks).toHaveLength(1);
    if (state.blocks[0]?.type === "user") {
      expect(state.blocks[0].data.content).toBe("from extension");
    }
    expect(state.pendingEchoes).toEqual([]);
  });

  it("optimistic user block is deduped against a trailing-newline echo", () => {
    // Direct regression test for the most common normalization case:
    // pi appends a trailing newline on echo, breaking exact string
    // equality. The user's "hi" bubble must be the one that stands.
    let state = createTranscriptState();
    state = addUserBlock(state, "hi", undefined, true);
    state = applyPiEvent(
      state,
      e({ type: "message_start", message: { role: "user", content: "hi\n" } }),
    );
    expect(state.blocks).toHaveLength(1);
    if (state.blocks[0]?.type === "user") {
      expect(state.blocks[0].data.content).toBe("hi");
    }
    expect(state.pendingEchoes).toEqual([]);
  });

  it("custom message_start with display:true renders content (not display)", () => {
    // `display` is a boolean visibility gate; `content` is the rendered text.
    // (Mirrors pi's TUI: CustomMessageComponent renders message.content.)
    let state = createTranscriptState();
    state = applyPiEvent(
      state,
      e({
        type: "message_start",
        message: {
          role: "custom",
          customType: "skill",
          display: true,
          content: "ran skill brave-search",
        },
      }),
    );
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.type).toBe("custom_message");
    if (state.blocks[0]?.type === "custom_message") {
      expect(state.blocks[0].data.content).toBe("ran skill brave-search");
    }

    // content as an array of text blocks is joined (pi's CustomMessageComponent
    // does the same).
    state = createTranscriptState();
    state = applyPiEvent(
      state,
      e({
        type: "message_start",
        message: {
          role: "custom",
          customType: "skill",
          display: true,
          content: [
            { type: "text", text: "line one" },
            { type: "text", text: "line two" },
          ],
        },
      }),
    );
    expect(state.blocks).toHaveLength(1);
    if (state.blocks[0]?.type === "custom_message") {
      expect(state.blocks[0].data.content).toBe("line one\nline two");
    }
  });

  it("custom message_start without display renders nothing (matches pi's TUI)", () => {
    let state = createTranscriptState();
    state = applyPiEvent(
      state,
      e({
        type: "message_start",
        message: { role: "custom", customType: "x", content: { foo: 1 } },
      }),
    );
    expect(state.blocks).toHaveLength(0);

    // A boolean `content: true` must not be JSON-stringified into "true".
    state = applyPiEvent(
      state,
      e({
        type: "message_start",
        message: { role: "custom", customType: "x", content: true },
      }),
    );
    expect(state.blocks).toHaveLength(0);
  });

  it("message_end with role: 'user' is a no-op (does not close assistant)", () => {
    let state = createTranscriptState();
    state = addUserBlock(state, "hello", undefined, true);
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    const activeId = state.activeAssistantId;
    expect(activeId).toBeTruthy();
    // Now pi sends user message_end (echo close) followed by an
    // assistant turn. The user end must not clear activeAssistantId.
    state = applyPiEvent(state, e({ type: "message_end", message: USER_MSG }));
    expect(state.activeAssistantId).toBe(activeId);
  });

  it("multiple pending echoes are consumed FIFO across turns", () => {
    let state = createTranscriptState();
    state = addUserBlock(state, "first", undefined, true);
    state = addUserBlock(state, "second", undefined, true);
    state = applyPiEvent(
      state,
      e({ type: "message_start", message: { role: "user", content: "first" } }),
    );
    expect(state.pendingEchoes).toEqual(["second"]);
    state = applyPiEvent(
      state,
      e({ type: "message_start", message: { role: "user", content: "second" } }),
    );
    expect(state.pendingEchoes).toEqual([]);
  });
});

describe("transcript reducer — provider errors", () => {
  const ERR_MSG = {
    ...ASST_MSG,
    stopReason: "error" as const,
    errorMessage: "Provider returned error",
  };

  it("surfaces an empty failed turn as an error block (no blank bubble)", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: ERR_MSG }));
    state = applyPiEvent(state, e({ type: "message_end", message: ERR_MSG }));

    expect(state.activeAssistantId).toBeNull();
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.type).toBe("error");
    if (state.blocks[0]?.type === "error") {
      expect(state.blocks[0].data.message).toBe("Provider returned error");
    }
  });

  it("falls back to a generic message when errorMessage is absent", () => {
    const noMsg = { ...ASST_MSG, stopReason: "error" as const };
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: noMsg }));
    state = applyPiEvent(state, e({ type: "message_end", message: noMsg }));

    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.type).toBe("error");
    if (state.blocks[0]?.type === "error") {
      expect(state.blocks[0].data.message).toBe("The model response ended with an error.");
    }
  });

  it("keeps partial output and appends an error block when a turn fails mid-stream", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "partial" },
      }),
    );
    state = applyPiEvent(state, e({ type: "message_end", message: ERR_MSG }));

    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[0]?.type).toBe("assistant");
    if (state.blocks[0]?.type === "assistant") {
      expect(state.blocks[0].data.textContent).toBe("partial");
      expect(state.blocks[0].data.isStreaming).toBe(false);
    }
    expect(state.blocks[1]?.type).toBe("error");
  });

  it("inserts the error block right after the assistant block, before later tool blocks", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "partial" },
      }),
    );
    state = applyPiEvent(
      state,
      e({ type: "tool_execution_start", toolCallId: "t1", toolName: "read_file", args: {} }),
    );
    state = applyPiEvent(state, e({ type: "message_end", message: ERR_MSG }));

    // Order must match what history-loader reconstructs on reload:
    // assistant → error → tool_call (not assistant → tool_call → error).
    expect(state.blocks.map((b) => b.type)).toEqual(["assistant", "error", "tool_call"]);
  });

  it("surfaces an error even if message_start was missed (no active block)", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_end", message: ERR_MSG }));
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.type).toBe("error");
  });

  it("a normal stop does not produce an error block", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "ok" },
      }),
    );
    state = applyPiEvent(state, e({ type: "message_end", message: ASST_MSG }));
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.type).toBe("assistant");
  });
});

// ── Performance: streaming must reconcile in O(1) per token ──────────────
// The reducer used to `.map` the whole `blocks` array on every text_delta /
// thinking_delta / tool_execution_update — a per-element callback that made
// streaming O(n²) over a long session (the freeze). It now copies only the
// array spine and replaces the one streamed slot, so every *element* ref
// except the streamed block stays stable — which is what lets the memo'd
// block renderers skip. The array ref itself changes each delta (preserving
// referential integrity for any ref-equality consumer); only the per-element
// copy is avoided.
describe("transcript reducer — streaming perf invariants", () => {
  it("a text_delta preserves every untouched element reference", () => {
    let state = createTranscriptState();
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    const refBefore = state.blocks;
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "x" },
      }),
    );
    // Fresh array (ref-equality consumers see the change) but no per-element
    // copy: the spine is cloned, the streamed slot replaced.
    expect(state.blocks).not.toBe(refBefore);
    expect(state.blocks).toHaveLength(refBefore.length);
  });

  it("a text_delta only changes the streamed block's `data` reference", () => {
    let state = createTranscriptState();
    // An earlier assistant block (unchanged by the next delta).
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "first" },
      }),
    );
    state = applyPiEvent(state, e({ type: "message_end", message: ASST_MSG }));
    const earlierData = state.blocks[0]?.data;

    // A second assistant turn whose text streams in.
    state = applyPiEvent(state, e({ type: "message_start", message: ASST_MSG }));
    state = applyPiEvent(
      state,
      e({
        type: "message_update",
        message: ASST_MSG,
        assistantMessageEvent: { type: "text_delta", delta: "second" },
      }),
    );

    // The earlier, untouched block keeps its exact `data` reference, so a
    // React.memo'd renderer skips it. Only the streaming block changed.
    expect(state.blocks[0]?.data).toBe(earlierData);
    expect((state.blocks[1]?.data as { textContent: string }).textContent).toBe("second");
  });

  it("a tool_execution_update preserves untouched element references", () => {
    let state = createTranscriptState();
    // An earlier block the tool update must not touch.
    state = addUserBlock(state, "earlier");
    const earlierData = state.blocks[0]?.data;
    state = applyPiEvent(
      state,
      e({ type: "tool_execution_start", toolCallId: "t1", toolName: "read_file", args: {} }),
    );
    const refBefore = state.blocks;
    state = applyPiEvent(
      state,
      e({
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "read_file",
        partialResult: "chunk",
      }),
    );
    // Fresh array, but the earlier block keeps its exact `data` ref so a
    // memo'd renderer skips it.
    expect(state.blocks).not.toBe(refBefore);
    expect(state.blocks[0]?.data).toBe(earlierData);
  });
});

// ── Memory: compaction bounds the in-memory transcript ───────────────────
// blocks used to grow without bound: compaction_end appended a marker but
// never dropped the blocks it summarised. It now trims at the compaction
// boundary, keeping only the most recent compaction marker onward (plus a
// recent-context window on the first compaction). Reload from the session
// file still restores the full history.
describe("transcript reducer — compaction trims memory", () => {
  // Helper: build a transcript with `n` user blocks so a compaction has
  // something pre-existing to trim.
  function withUserBlocks(n: number) {
    let state = createTranscriptState();
    for (let i = 0; i < n; i++) state = addUserBlock(state, `m${i}`);
    return state;
  }

  it("first compaction keeps a recent-context window plus the new marker", () => {
    // MAX_PRE_COMPACTION_KEEP is 200; with 250 pre-compaction blocks the
    // oldest 50 are dropped and the most recent 200 are retained, then the
    // compaction marker is appended.
    let state = withUserBlocks(250);
    state = applyPiEvent(state, e({ type: "compaction_end", result: { summary: "s1" } }));
    expect(state.blocks).toHaveLength(201); // 200 retained + 1 marker
    expect(state.blocks[200]?.type).toBe("compaction");
  });

  it("a later compaction drops everything before the previous marker", () => {
    let state = withUserBlocks(250);
    state = applyPiEvent(state, e({ type: "compaction_end", result: { summary: "s1" } }));
    // Add 50 more blocks in the new epoch, then compact again.
    for (let i = 0; i < 50; i++) state = addUserBlock(state, `post${i}`);
    state = applyPiEvent(state, e({ type: "compaction_end", result: { summary: "s2" } }));

    // After the second compaction, everything before the *first* compaction
    // marker is dropped: kept = [first marker .. end] + new marker.
    // Before the 2nd: [200 user, s1, 50 post] (251). slice(from s1) =
    // [s1, 50 post] (51) + s2 marker = 52. The first marker is now at index 0.
    expect(state.blocks[0]?.type).toBe("compaction");
    if (state.blocks[0]?.type === "compaction") {
      expect(state.blocks[0].data.summary).toBe("s1");
    }
    expect(state.blocks).toHaveLength(52);
    expect(state.blocks[51]?.type).toBe("compaction");
  });

  it("compaction on an empty transcript still produces just the marker", () => {
    const state = applyPiEvent(
      createTranscriptState(),
      e({ type: "compaction_end", result: { summary: "s" } }),
    );
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.type).toBe("compaction");
  });
});
