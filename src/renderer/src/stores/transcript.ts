import type { TranscriptBlock } from "@shared/ipc-contract.js";
import type { KnownPiEvent } from "@shared/pi-protocol/events.js";
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

export type TypedTranscriptBlock =
  | { id: string; type: "user"; data: UserBlockData }
  | { id: string; type: "assistant"; data: AssistantBlockData }
  | { id: string; type: "tool_call"; data: ToolCallBlockData }
  | { id: string; type: "bash"; data: BashBlockData }
  | { id: string; type: "compaction"; data: CompactionBlockData }
  | { id: string; type: "custom_message"; data: CustomMessageBlockData };

let blockCounter = 0;
function newBlockId(): string {
  return `blk-${++blockCounter}`;
}

export interface TranscriptState {
  blocks: TypedTranscriptBlock[];
  // active ids for streaming
  activeAssistantId: string | null;
  activeToolCallIds: Map<string, string>; // toolCallId → blockId
  activeBashId: string | null;
}

export function createTranscriptState(): TranscriptState {
  return {
    blocks: [],
    activeAssistantId: null,
    activeToolCallIds: new Map(),
    activeBashId: null,
  };
}

export function seedFromHistory(
  state: TranscriptState,
  history: TranscriptBlock[],
): TranscriptState {
  const blocks: TypedTranscriptBlock[] = history.map((b) => {
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
    // fallback
    return { id: b.id, type: "user", data: { role: "user", content: "" } };
  });
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
  const { blocks, activeAssistantId, activeToolCallIds, activeBashId } = state;

  // Helper: immutably update a block by id
  function updateBlock(
    id: string,
    updater: (b: TypedTranscriptBlock) => TypedTranscriptBlock,
  ): TypedTranscriptBlock[] {
    return blocks.map((b) => (b.id === id ? updater(b) : b));
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
            blocks: updateBlock(activeAssistantId, (b) => {
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
            blocks: updateBlock(activeAssistantId, (b) => {
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
        blocks: updateBlock(blockId, (b) => {
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
      return {
        ...state,
        blocks: [
          ...blocks,
          { id: blockId, type: "compaction", data: { summary: event.result?.summary } },
        ],
      };
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

// User sends a prompt — add user block immediately
export function addUserBlock(
  state: TranscriptState,
  content: string,
  images?: string[],
): TranscriptState {
  const blockId = newBlockId();
  return {
    ...state,
    blocks: [
      ...state.blocks,
      { id: blockId, type: "user", data: { role: "user", content, images } },
    ],
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
