import type { TranscriptBlock } from "@shared/ipc-contract.js";
import type { KnownPiEvent } from "@shared/pi-protocol/events.js";
import { detectTurnError } from "@shared/pi-protocol/turn-error.js";
import { assertNever } from "@shared/result.js";

// All TranscriptBlock data shapes
export interface UserBlockData {
  role: "user";
  content: string;
  images?: string[] | undefined;
}

export interface AssistantBlockData {
  role: "assistant";
  textContent: string;
  thinkingContent: string;
  isStreaming: boolean;
}

export interface ToolCallBlockData {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown> | undefined;
  outputText: string;
  diff?: string | undefined;
  patch?: string | undefined;
  isError: boolean;
  isStreaming: boolean;
}

export interface BashBlockData {
  command: string;
  outputText: string;
  isStreaming: boolean;
  exitCode?: number | undefined;
}

export interface CompactionBlockData {
  summary?: string | undefined;
}

export interface CustomMessageBlockData {
  content: string;
}

/**
 * A model/provider failure surfaced into the transcript. pi records a
 * failed assistant turn as a `message_end` with `stopReason: "error"`
 * (and usually an `errorMessage`). Without rendering this, a provider
 * drop looks identical to "the stream mysteriously cut off". We surface
 * it as a visible block so the cause is obvious and the user knows to
 * retry / switch models.
 */
export interface ErrorBlockData {
  message: string;
}

export type TypedTranscriptBlock =
  | { id: string; type: "user"; data: UserBlockData }
  | { id: string; type: "assistant"; data: AssistantBlockData }
  | { id: string; type: "tool_call"; data: ToolCallBlockData }
  | { id: string; type: "bash"; data: BashBlockData }
  | { id: string; type: "compaction"; data: CompactionBlockData }
  | { id: string; type: "custom_message"; data: CustomMessageBlockData }
  | { id: string; type: "error"; data: ErrorBlockData };

let blockCounter = 0;
function newBlockId(): string {
  return `blk-${++blockCounter}`;
}

/**
 * Recent-context window retained in the live in-memory transcript across a
 * compaction. pi compacts by summarising everything *before* the compaction
 * point, so blocks prior to the most recent compaction marker are already
 * represented by that marker's summary and are dropped to bound memory
 * (reload from the session file restores the full history). On the *first*
 * compaction there is no prior marker to anchor a trim, so we keep this many
 * of the most recent pre-compaction blocks as a scroll-back window — large
 * enough to cover the renderer's MAX_VISIBLE_BLOCKS (150) plus headroom.
 */
const MAX_PRE_COMPACTION_KEEP = 200;

export interface TranscriptState {
  blocks: TypedTranscriptBlock[];
  // active ids for streaming
  activeAssistantId: string | null;
  activeToolCallIds: Map<string, string>; // toolCallId → blockId
  activeBashId: string | null;
  /**
   * FIFO of optimistic user-prompt texts the Composer added via
   * `addUserBlock(registerEcho: true)`. When a `message_start` with
   * `role: "user"` arrives, we extract the text and compare against the
   * head; if it matches, we consume the head (pi's authoritative echo
   * is the same text, so we don't add a duplicate). If it does not match
   * (e.g. a prompt template expanded to a different text, or a steered
   * message in a different order), we append a fresh user block.
   */
  pendingEchoes: string[];
}

export function createTranscriptState(): TranscriptState {
  return {
    blocks: [],
    activeAssistantId: null,
    activeToolCallIds: new Map(),
    activeBashId: null,
    pendingEchoes: [],
  };
}

export function seedFromHistory(
  state: TranscriptState,
  history: TranscriptBlock[],
): TranscriptState {
  const blocks: TypedTranscriptBlock[] = history
    .map((b): TypedTranscriptBlock | null => {
      const d = b.data as Record<string, unknown>;
      if (b.type === "user") {
        return {
          id: b.id,
          type: "user",
          data: {
            role: "user",
            content: (d.content as string) ?? "",
            images: d.images as string[] | undefined,
          },
        };
      }
      if (b.type === "assistant") {
        return {
          id: b.id,
          type: "assistant",
          data: {
            role: "assistant",
            textContent: (d.content as string) ?? "",
            thinkingContent: (d.thinking as string) ?? "",
            isStreaming: false,
          },
        };
      }
      if (b.type === "tool_call") {
        return {
          id: b.id,
          type: "tool_call",
          data: {
            toolCallId: (d.toolCallId as string) ?? "",
            toolName: (d.toolName as string) ?? "",
            input: d.input as Record<string, unknown> | undefined,
            outputText: (d.outputText as string) ?? "",
            diff: d.diff as string | undefined,
            patch: d.patch as string | undefined,
            isError: (d.isError as boolean) ?? false,
            isStreaming: (d.isStreaming as boolean) ?? false,
          },
        };
      }
      if (b.type === "bash") {
        return {
          id: b.id,
          type: "bash",
          data: {
            command: (d.command as string) ?? "",
            outputText: (d.outputText as string) ?? "",
            isStreaming: (d.isStreaming as boolean) ?? false,
            exitCode: d.exitCode as number | undefined,
          },
        };
      }
      if (b.type === "compaction") {
        return { id: b.id, type: "compaction", data: { summary: d.summary as string | undefined } };
      }
      if (b.type === "custom_message") {
        return { id: b.id, type: "custom_message", data: { content: (d.content as string) ?? "" } };
      }
      if (b.type === "error") {
        return { id: b.id, type: "error", data: { message: (d.message as string) ?? "" } };
      }
      // Unknown block type — drop it instead of synthesising an empty
      // user bubble, which would be confusing to the user.
      return null;
    })
    .filter((b): b is TypedTranscriptBlock => b !== null);
  return { ...state, blocks };
}

// tool_execution_end carries the final output in result.content[].text on the
// real wire (updates with partialResult may never arrive at all)
function extractResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    const parts: string[] = [];
    for (const item of r.content) {
      if (item && typeof item === "object") {
        const c = item as Record<string, unknown>;
        if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof r.output === "string") return r.output;
  return "";
}

/**
 * Extract the user-prompt text from a `message: { role: "user", content }`
 * snapshot. The content is either a plain string (legacy/simple) or an
 * array of `{ type: "text" | "image", text: string }` blocks. We collapse
 * the text blocks (concatenated) and ignore images; the result is what
 * the Composer would show in a user bubble.
 */
function extractUserText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as { content?: unknown };
  const content = m.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      }
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

function extractResultDiff(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  if (r.details && typeof r.details === "object") {
    const d = r.details as Record<string, unknown>;
    if (typeof d.diff === "string") return d.diff;
  }
  if (typeof r.diff === "string") return r.diff;
  return undefined;
}

export function applyPiEvent(state: TranscriptState, event: KnownPiEvent): TranscriptState {
  const { blocks, activeAssistantId, activeToolCallIds, activeBashId, pendingEchoes } = state;

  // Helper: immutably update a block by id. Pure O(n) copy — used for the
  // *lifecycle* events (message_end, tool_execution_end, text_end, …) that
  // fire once per block, not per token, so the aggregate cost over a session
  // is O(n) total, never O(n²).
  function updateBlock(
    id: string,
    updater: (b: TypedTranscriptBlock) => TypedTranscriptBlock,
  ): TypedTranscriptBlock[] {
    return blocks.map((b) => (b.id === id ? updater(b) : b));
  }

  // Streaming update for the per-token path (text_delta, thinking_delta,
  // tool_execution_update). Returns a *fresh* array (so the `blocks`
  // reference changes — referential integrity for any ref-equality consumer)
  // but copies only the array spine, leaving every element reference except
  // the streamed one untouched. That keeps the React reconcile O(1): the
  // block renderers are React.memo'd on their `data` prop, so only the one
  // changed slot (new `data` ref) re-renders and every unchanged slot (same
  // `data` ref) skips.
  //
  // Why not `updateBlock` (i.e. `.map`)? `.map` runs the callback once per
  // element, which made streaming O(n²) over a long session (the freeze).
  // `blocks.slice()` is a single bulk copy of the spine — far cheaper — and
  // the array is bounded to a few hundred blocks by the compaction trim, so
  // the per-token cost is negligible.
  //
  // We scan from the tail because the active assistant / tool-call block is
  // always among the most recently appended, so the match is found in O(1)
  // for the common case rather than scanning the whole array from the front.
  function patchBlock(
    id: string,
    updater: (b: TypedTranscriptBlock) => TypedTranscriptBlock,
  ): TypedTranscriptBlock[] {
    let idx = -1;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i]?.id === id) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return blocks;
    const cur = blocks[idx];
    if (!cur) return blocks;
    const nextBlock = updater(cur);
    if (nextBlock === cur) return blocks;
    const next = blocks.slice();
    next[idx] = nextBlock;
    return next;
  }

  switch (event.type) {
    case "agent_start":
    case "turn_start":
    case "agent_end":
    case "turn_end":
    case "queue_update":
    case "auto_retry_start":
    case "auto_retry_end":
    case "extension_error":
      return state;

    case "message_start": {
      const role = event.message?.role;
      if (role === "assistant") {
        const blockId = newBlockId();
        const newBlock: TypedTranscriptBlock = {
          id: blockId,
          type: "assistant",
          data: { role: "assistant", textContent: "", thinkingContent: "", isStreaming: true },
        };
        return {
          ...state,
          blocks: [...blocks, newBlock],
          activeAssistantId: blockId,
        };
      }
      if (role === "user") {
        // pi echoes the delivered prompt. We dedupe by *position*, not by
        // exact string equality: an optimistic `addUserBlock` always
        // expects exactly one echo, so we consume the head of
        // `pendingEchoes` whenever one is pending — regardless of whether
        // pi normalized the text (trailing newline, whitespace) or
        // expanded a template/skill. The user's originally-typed
        // optimistic text stands; we never replace it.
        //
        // If there is no pending echo, the message must be
        // server-/extension-originated (slash command dispatched via
        // `prompt` with `commandSource: "extension"`); render the echoed
        // text as a fresh user block.
        if (pendingEchoes.length > 0) {
          return { ...state, pendingEchoes: pendingEchoes.slice(1) };
        }
        const echoed = extractUserText(event.message);
        return echoed !== null ? addUserBlock(state, echoed, undefined, false) : state;
      }
      if (role === "custom") {
        // Match pi's TUI (interactive-mode.js `addMessageToChat` →
        // `case "custom"`): a custom message is rendered ONLY when `display`
        // is truthy — `display` is a boolean visibility gate, NOT the text.
        // The rendered text comes from `content` (pi's CustomMessageComponent
        // renders `message.content`, using `display` only to decide whether
        // to show the block at all). Rendering `display` would print "true"
        // for every legitimate `display: true` custom message — which is
        // exactly the bug that surfaced when an extension sent a custom
        // message with `content: true` and no `display` (the old fallback
        // JSON-stringified `content` → "true").
        const msg = event.message as { display?: unknown; content?: unknown } | undefined;
        if (!msg?.display) return state;
        const content = msg.content;
        let text: string | undefined;
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          // Mirror pi's CustomMessageComponent: join text blocks.
          text = content
            .filter(
              (c): c is { type: "text"; text: string } =>
                !!c &&
                typeof c === "object" &&
                (c as { type?: unknown }).type === "text" &&
                typeof (c as { text?: unknown }).text === "string",
            )
            .map((c) => c.text)
            .join("\n");
        }
        // Non-string/non-array content (e.g. a boolean) has no renderable
        // text — skip, matching pi which would likewise produce nothing.
        if (!text) return state;
        const blockId = newBlockId();
        return {
          ...state,
          blocks: [...blocks, { id: blockId, type: "custom_message", data: { content: text } }],
        };
      }
      // Unknown role (toolResult, bashExecution, etc.) — ignore for now;
      // these have their own dedicated event types in the wire.
      return state;
    }

    case "message_update": {
      if (!activeAssistantId || !event.assistantMessageEvent) return state;
      const msgEvent = event.assistantMessageEvent;

      switch (msgEvent.type) {
        case "text_start":
          // text_start carries no text content — actual text arrives via text_delta
          return state;
        case "text_delta":
          return {
            ...state,
            blocks: patchBlock(activeAssistantId, (b) => {
              if (b.type !== "assistant") return b;
              return {
                ...b,
                data: { ...b.data, textContent: b.data.textContent + msgEvent.delta },
              };
            }),
          };
        case "thinking_start":
          // thinking_start carries no thinking content — actual thinking arrives via thinking_delta
          return state;
        case "thinking_delta":
          return {
            ...state,
            blocks: patchBlock(activeAssistantId, (b) => {
              if (b.type !== "assistant") return b;
              return {
                ...b,
                data: { ...b.data, thinkingContent: b.data.thinkingContent + msgEvent.delta },
              };
            }),
          };
        case "text_end": {
          const content = (msgEvent as { content?: string }).content;
          if (content) {
            return {
              ...state,
              blocks: updateBlock(activeAssistantId, (b) => {
                if (b.type !== "assistant") return b;
                // Only use snapshot content if we didn't already get text via deltas
                if (b.data.textContent.length > 0) return b;
                return { ...b, data: { ...b.data, textContent: content } };
              }),
            };
          }
          return state;
        }
        case "thinking_end": {
          const content = (msgEvent as { content?: string }).content;
          if (content) {
            return {
              ...state,
              blocks: updateBlock(activeAssistantId, (b) => {
                if (b.type !== "assistant") return b;
                if (b.data.thinkingContent.length > 0) return b;
                return { ...b, data: { ...b.data, thinkingContent: content } };
              }),
            };
          }
          return state;
        }
        default:
          return state;
      }
    }

    case "message_end": {
      // Only assistant messages own the streaming state machine; closing a
      // non-assistant stream (user / custom) is a no-op.
      if (event.message?.role !== "assistant") return state;

      const { isError, message: errorMessage } = detectTurnError(event.message);

      // Normal close — just stop streaming on the active assistant block.
      if (!isError) {
        if (!activeAssistantId) return state;
        return {
          ...state,
          blocks: updateBlock(activeAssistantId, (b) => {
            if (b.type !== "assistant") return b;
            return { ...b, data: { ...b.data, isStreaming: false } };
          }),
          activeAssistantId: null,
        };
      }

      // Error close — surface a visible error block. If the active
      // assistant block already accumulated partial text/thinking, keep it
      // (the partial output is still useful context) and append the error
      // block after it. If the block is empty, drop it so the user doesn't
      // see a blank assistant bubble — the error block stands in for it.
      const errorBlock: TypedTranscriptBlock = {
        id: newBlockId(),
        type: "error",
        data: { message: errorMessage },
      };

      if (!activeAssistantId) {
        return { ...state, blocks: [...blocks, errorBlock], activeAssistantId: null };
      }

      const activeIndex = blocks.findIndex((b) => b.id === activeAssistantId);
      const active = activeIndex >= 0 ? blocks[activeIndex] : undefined;
      const hasContent =
        active?.type === "assistant" &&
        (active.data.textContent.length > 0 || active.data.thinkingContent.length > 0);

      // Insert the error block immediately after the assistant block (rather
      // than at the array end) so the in-session order matches what the
      // history loader reconstructs on reload, even when later blocks (e.g.
      // tool calls) were appended during the turn.
      if (hasContent) {
        const next = updateBlock(activeAssistantId, (b) =>
          b.type === "assistant" ? { ...b, data: { ...b.data, isStreaming: false } } : b,
        );
        next.splice(activeIndex + 1, 0, errorBlock);
        return { ...state, blocks: next, activeAssistantId: null };
      }

      // Drop the empty assistant block; the error block replaces it in place.
      const next = blocks.filter((b) => b.id !== activeAssistantId);
      next.splice(activeIndex, 0, errorBlock);
      return { ...state, blocks: next, activeAssistantId: null };
    }

    case "tool_execution_start": {
      const blockId = newBlockId();
      const newBlock: TypedTranscriptBlock = {
        id: blockId,
        type: "tool_call",
        data: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.args as Record<string, unknown> | undefined,
          outputText: "",
          isError: false,
          isStreaming: true,
        },
      };
      const newActiveIds = new Map(activeToolCallIds);
      newActiveIds.set(event.toolCallId, blockId);
      return {
        ...state,
        blocks: [...blocks, newBlock],
        activeToolCallIds: newActiveIds,
      };
    }

    case "tool_execution_update": {
      const blockId = activeToolCallIds.get(event.toolCallId);
      if (!blockId) return state;
      const delta = typeof event.partialResult === "string" ? event.partialResult : "";
      return {
        ...state,
        blocks: patchBlock(blockId, (b) => {
          if (b.type !== "tool_call") return b;
          return { ...b, data: { ...b.data, outputText: b.data.outputText + delta } };
        }),
      };
    }

    case "tool_execution_end": {
      const blockId = activeToolCallIds.get(event.toolCallId);
      if (!blockId) return state;
      const newActiveIds = new Map(activeToolCallIds);
      newActiveIds.delete(event.toolCallId);
      const resultText = extractResultText(event.result);
      const resultDiff = extractResultDiff(event.result);
      return {
        ...state,
        blocks: updateBlock(blockId, (b) => {
          if (b.type !== "tool_call") return b;
          return {
            ...b,
            data: {
              ...b.data,
              isStreaming: false,
              isError: event.isError,
              outputText: resultText || b.data.outputText,
              diff: b.data.diff ?? resultDiff,
            },
          };
        }),
        activeToolCallIds: newActiveIds,
      };
    }

    case "compaction_start":
      return state;

    case "compaction_end": {
      const blockId = newBlockId();
      const newCompactionBlock: TypedTranscriptBlock = {
        id: blockId,
        type: "compaction",
        data: { summary: event.result?.summary },
      };
      // Bound the in-memory transcript at the compaction boundary. Find the
      // most recent existing compaction marker; everything before it has
      // already been summarised by that compaction and is dropped — the live
      // session no longer needs it (pi has the summary, and reload from the
      // session file restores the full history). On the first compaction
      // (no prior marker) keep a recent window (MAX_PRE_COMPACTION_KEEP) so
      // the user can still scroll back through the just-compacted context.
      let lastCompactionIdx = -1;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (b?.type === "compaction") {
          lastCompactionIdx = i;
          break;
        }
      }
      const kept =
        lastCompactionIdx >= 0
          ? blocks.slice(lastCompactionIdx)
          : blocks.slice(Math.max(0, blocks.length - MAX_PRE_COMPACTION_KEEP));
      return { ...state, blocks: [...kept, newCompactionBlock] };
    }

    case "thinking_level_changed":
      // The thinking level lives on the session record in the store, not on
      // the transcript. Acknowledging the event here keeps the reducer total
      // so `applyEvent` in sessions-store can read `event.level` safely.
      return state;

    case "session_info_changed":
      // The session name lives on the session record in the store, not on
      // the transcript. Acknowledging the event here keeps the reducer total
      // so `applyEvent` in sessions-store can read `event.name` safely.
      return state;

    default:
      return assertNever(event);
  }
}

// User sends a prompt — add user block immediately.
//
// `registerEcho` is true for plain Composer text submissions, where the
// optimistic block is the user's own text and pi will echo it back via
// `message_start` with `role: "user"`. We register the text in
// `pendingEchoes` so the reducer can suppress the duplicate echo.
//
// `registerEcho` is false for extension-originated prompts (slash
// commands dispatched via `prompt` with `commandSource: "extension"`),
// which the Composer does not optimistically render; the message_start
// echo is the first and only user block in those cases.
export function addUserBlock(
  state: TranscriptState,
  content: string,
  images?: string[],
  registerEcho = false,
): TranscriptState {
  const blockId = newBlockId();
  return {
    ...state,
    blocks: [
      ...state.blocks,
      { id: blockId, type: "user", data: { role: "user", content, images } },
    ],
    pendingEchoes: registerEcho ? [...state.pendingEchoes, content] : state.pendingEchoes,
  };
}

// User sends a bash command
export function addBashBlock(state: TranscriptState, command: string): TranscriptState {
  const blockId = newBlockId();
  return {
    ...state,
    blocks: [
      ...state.blocks,
      { id: blockId, type: "bash", data: { command, outputText: "", isStreaming: true } },
    ],
    activeBashId: blockId,
  };
}

// Append a custom_message block. Used by /session (TUI parity — the TUI
// renders session info inside the chat, not as a toast) and by any future
// renderer-initiated info block.
export function addCustomMessageBlock(state: TranscriptState, content: string): TranscriptState {
  const blockId = newBlockId();
  return {
    ...state,
    blocks: [...state.blocks, { id: blockId, type: "custom_message", data: { content } }],
  };
}

// Bash command finished — the output arrives in the RPC response, not as events
export function finishBashBlock(
  state: TranscriptState,
  output: string,
  exitCode?: number,
): TranscriptState {
  const id = state.activeBashId;
  if (!id) return state;
  return {
    ...state,
    blocks: state.blocks.map((b) =>
      b.id === id && b.type === "bash"
        ? { ...b, data: { ...b.data, outputText: output, isStreaming: false, exitCode } }
        : b,
    ),
    activeBashId: null,
  };
}
