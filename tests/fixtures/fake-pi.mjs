#!/usr/bin/env node
/**
 * Scripted stand-in for `pi --mode rpc`.
 * Reads JSONL on stdin; responds on stdout.
 * Behaviors keyed by prompt content:
 *   "hello"    → streamed text response
 *   "use-tool" → tool_execution sequence
 *   "ask-me"   → select dialog roundtrip
 * Everything else → simple echo response
 */

import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, terminal: false });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handleHello(id) {
  send({ type: "agent_start" });
  send({ type: "turn_start" });
  send({ type: "message_start", messageId: "msg-1" });

  const deltas = ["Hello! ", "I'm ", "your pi ", "coding agent."];
  for (const delta of deltas) {
    send({ type: "message_update", messageId: "msg-1", event: { type: "text_delta", delta } });
    await sleep(50);
  }

  send({ type: "message_end", messageId: "msg-1" });
  send({ type: "turn_end" });
  send({ type: "agent_end" });
  send({ type: "response", command: "prompt", success: true, id });
}

async function handleUseTool(id) {
  send({ type: "agent_start" });
  send({ type: "turn_start" });
  send({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read_file", input: { path: "test.txt" } });

  await sleep(100);
  send({ type: "tool_execution_update", toolCallId: "tool-1", delta: "reading...\n" });
  await sleep(100);
  send({
    type: "tool_execution_end",
    toolCallId: "tool-1",
    output: "file contents here",
    details: { diff: "--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n-old\n+new\n" },
    isError: false,
  });

  send({ type: "message_start", messageId: "msg-2" });
  send({ type: "message_update", messageId: "msg-2", event: { type: "text_delta", delta: "Done reading." } });
  send({ type: "message_end", messageId: "msg-2" });
  send({ type: "turn_end" });
  send({ type: "agent_end" });
  send({ type: "response", command: "prompt", success: true, id });
}

async function handleAskMe(id) {
  send({ type: "response", command: "prompt", success: true, id });
  send({ type: "agent_start" });

  // Emit select dialog
  const reqId = "ui-req-1";
  send({
    type: "extension_ui_request",
    id: reqId,
    method: "select",
    title: "Pick an option",
    options: ["Option A", "Option B", "Option C"],
  });

  // Wait for response on stdin — we collect it in the rl loop
  uiPending.set(reqId, async (response) => {
    const chosen = response.value ?? "(cancelled)";
    send({ type: "message_start", messageId: "msg-3" });
    send({ type: "message_update", messageId: "msg-3", event: { type: "text_delta", delta: `You chose: ${chosen}` } });
    send({ type: "message_end", messageId: "msg-3" });
    send({ type: "turn_end" });
    send({ type: "agent_end" });
  });
}

const uiPending = new Map();

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const { type, id } = msg;

  // UI responses
  if (type === "extension_ui_response") {
    const handler = uiPending.get(msg.id);
    if (handler) {
      uiPending.delete(msg.id);
      await handler(msg);
    }
    return;
  }

  switch (type) {
    case "prompt": {
      const content = (msg.content ?? "").toLowerCase();
      if (content.includes("hello")) {
        await handleHello(id);
      } else if (content.includes("use-tool")) {
        await handleUseTool(id);
      } else if (content.includes("ask-me")) {
        await handleAskMe(id);
      } else {
        send({ type: "agent_start" });
        send({ type: "message_start", messageId: "echo-msg" });
        send({ type: "message_update", messageId: "echo-msg", event: { type: "text_delta", delta: `Echo: ${msg.content}` } });
        send({ type: "message_end", messageId: "echo-msg" });
        send({ type: "agent_end" });
        send({ type: "response", command: "prompt", success: true, id });
      }
      break;
    }

    case "get_commands":
      send({
        type: "response",
        command: "get_commands",
        success: true,
        id,
        data: [
          { name: "login", description: "Login to a provider" },
          { name: "model", description: "Switch model" },
          { name: "compact", description: "Compact context" },
        ],
      });
      break;

    case "get_state":
      send({ type: "response", command: "get_state", success: true, id, data: { messages: [] } });
      break;

    case "get_session_stats":
      send({
        type: "response",
        command: "get_session_stats",
        success: true,
        id,
        data: { inputTokens: 100, outputTokens: 50, totalTokens: 150, contextUsed: 150, contextLimit: 200000, cost: 0.001 },
      });
      break;

    case "get_available_models":
      send({
        type: "response",
        command: "get_available_models",
        success: true,
        id,
        data: [
          { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", isCurrent: true },
          { id: "claude-3-opus", name: "Claude 3 Opus", isCurrent: false },
        ],
      });
      break;

    case "set_model":
      send({ type: "response", command: "set_model", success: true, id });
      break;

    case "set_thinking_level":
      send({ type: "response", command: "set_thinking_level", success: true, id });
      // Mirror pi's behavior: echo the level back as a thinking_level_changed
      // event so the renderer can reconcile the dropdown. Real pi also
      // silently clamps to a model-supported level, but the fake doesn't.
      send({ type: "thinking_level_changed", level: msg.level });
      break;

    case "set_session_name":
      send({ type: "response", command: "set_session_name", success: true, id });
      break;

    case "abort":
      send({ type: "agent_end" });
      send({ type: "response", command: "abort", success: true, id });
      break;

    case "bash":
      send({ type: "response", command: "bash", success: true, id, data: { output: `$ ${msg.command}\nbash output here\n` } });
      break;

    case "new_session":
      send({ type: "response", command: "new_session", success: true, id });
      break;

    default:
      send({ type: "response", command: type ?? "unknown", success: false, id, error: `Unknown command: ${type}` });
  }
});

process.stdin.resume();
