#!/usr/bin/env node
/**
 * fake-unified-host — a deterministic stand-in for the SessionHost subprocess
 * (resources/pi-session-host/host.mjs) that drives the factory-`setWidget`
 * unified-TUI panel flow, WITHOUT a real pi install or SDK.
 *
 * Installed via the `PIVIS_TEST_HOST_SCRIPT` env override in SessionHost
 * (src/main/pi/session-host.ts). It speaks the SAME wire protocol host.mjs
 * does (process.send / process.on("message")), so the real app exercises the
 * full path: SessionHost → registry → IPC → store reducer → UnifiedTuiHost →
 * xterm.js.
 *
 * What it simulates (the pi-subagents "FleetView" roster flow):
 *   - on `init`: emit `spawned` → `ready {piVersion}`, then shortly after open
 *     a persistent unified panel (`panel_open {unified:true}`) and stream
 *     `panel_data` ANSI frames — exactly what host.mjs's ensureUnifiedTui()
 *     produces when an extension calls `setWidget(key, factory)`.
 *   - answers the renderer's startup commands (get_available_models / get_state
 *     / get_commands / get_session_stats) with the same shapes fake-pi uses.
 *   - forwards `prompt`/`bash` as a response + a few agent events so the
 *     transcript shows life.
 *   - records `panel_input` keystrokes to PIVIS_TEST_HOST_INPUT_FILE so the
 *     Playwright test can assert input routing via a side channel.
 *
 * Wire protocol (host → main), mirrored from host.mjs / fake-host-process.mjs:
 *   { type:"spawned" } / { type:"ready", piVersion } / { type:"response", id, success, data? }
 *   { type:"event", event } / { type:"panel_open", panelId, overlay, unified? }
 *   { type:"panel_data", panelId, data } / { type:"panel_close", panelId }
 */
import * as fs from "node:fs";

const INPUT_FILE = process.env.PIVIS_TEST_HOST_INPUT_FILE;
const PANEL_ID = 1;

const MODELS = [
  { id: "fake-model", name: "Fake Model", api: "fake", provider: "fake", reasoning: false },
  { id: "fake-model-2", name: "Fake Model Two", api: "fake", provider: "fake", reasoning: true },
];

let panelOpen = false;
let panelTimer = null;

function send(msg) {
  if (typeof process.send === "function") process.send(msg);
}

function recordInput(data) {
  if (!INPUT_FILE) return;
  try {
    fs.appendFileSync(INPUT_FILE, data, { flag: "a" });
  } catch {
    /* best effort — input routing is asserted on a best-effort basis */
  }
}

function reply(id, success, data = {}) {
  send({ type: "response", id, success, data });
}

function handleCommand(id, command) {
  const t = command?.type;
  switch (t) {
    case "get_available_models":
      reply(id, true, { models: MODELS, currentModelId: "fake-model" });
      break;
    case "get_state":
      reply(id, true, {
        model: MODELS[0],
        thinkingLevel: "medium",
        isStreaming: false,
        isCompacting: false,
        sessionId: "fake-unified",
        messageCount: 0,
      });
      break;
    case "get_commands":
      reply(id, true, { commands: [] });
      break;
    case "get_session_stats":
      reply(id, true, {
        sessionId: "fake-unified",
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
        contextUsage: { tokens: 0, contextWindow: 200000, percent: 0 },
      });
      break;
    case "set_model":
    case "set_thinking_level":
      reply(id, true, {});
      break;
    case "prompt":
    case "steer":
      reply(id, true, {});
      // A whisper of agent activity so the transcript isn't empty.
      send({ type: "event", event: { type: "agent_start" } });
      send({
        type: "event",
        event: { type: "message_start", role: "assistant" },
      });
      send({
        type: "event",
        event: { type: "message_update", delta: { text_delta: "Working on it…" } },
      });
      send({ type: "event", event: { type: "message_end" } });
      send({ type: "event", event: { type: "agent_end" } });
      break;
    case "bash":
      reply(id, true, {});
      break;
    default:
      // Be permissive: any other command gets a generic success so a new
      // renderer startup command can't wedge the session.
      reply(id, true, {});
      break;
  }
}

// ─── Unified panel (the factory setWidget flow) ────────────────────────────

function renderRoster() {
  // Clear-screen + home + a recognizable fleet roster. UnifiedTuiHost renders
  // this into xterm.js; the test greps for "Fleet" and an agent name.
  return `\x1b[2J\x1b[H${[
    "▸ Fleet (2 agents)        ↓/↑ navigate · Enter open",
    "  ● swift-otter    running   3 turns",
    "  ○ brave-falcon   queued    —",
    "",
    "  (unified TUI · type a prompt + Enter)",
  ].join("\n")}\n`;
}

function renderFrame() {
  send({ type: "panel_data", panelId: PANEL_ID, data: renderRoster() });
}

function openUnifiedPanel() {
  if (panelOpen) return;
  panelOpen = true;
  send({ type: "panel_open", panelId: PANEL_ID, overlay: false, unified: true });
  renderFrame();
  // Keep streaming so a remount (e.g. session switch) re-seeds from the buffer.
  panelTimer = setInterval(renderFrame, 1000);
  if (panelTimer?.unref) panelTimer.unref();
}

function closeUnifiedPanel() {
  if (!panelOpen) return;
  panelOpen = false;
  if (panelTimer) {
    clearInterval(panelTimer);
    panelTimer = null;
  }
  send({ type: "panel_close", panelId: PANEL_ID });
}

// ─── Wire protocol handling ────────────────────────────────────────────────

process.on("message", (msg) => {
  try {
    switch (msg?.type) {
      case "init":
        send({ type: "spawned" });
        send({ type: "ready", piVersion: "99.0.0" });
        // Open the unified panel shortly after ready, mirroring an extension
        // registering a factory setWidget during its first tool call.
        setTimeout(openUnifiedPanel, 300);
        break;
      case "command":
        handleCommand(msg.id, msg.command);
        break;
      case "panel_input":
        // Keystrokes from UnifiedTuiHost's xterm → record for the input-routing
        // assertion. (The real host would feed these to the TUI's editor.)
        if (typeof msg?.data === "string") recordInput(msg.data);
        break;
      case "panel_resize":
      case "panel_close_request":
        if (msg?.type === "panel_close_request") closeUnifiedPanel();
        break;
      case "unified_submit_response":
      case "clipboard_read_image_response":
      case "dialog_response":
        // Renderer replies we don't need to act on for the render/input test.
        break;
      default:
        break;
    }
  } catch (err) {
    process.stderr.write(`fake-unified-host: ${err?.stack ?? err}\n`);
  }
});

process.on("disconnect", () => {
  if (panelTimer) clearInterval(panelTimer);
  process.exit(0);
});
