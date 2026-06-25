/**
 * pi-session-host: Command/event bridge between Electron main and pi SDK.
 *
 * This module:
 * 1. Translates pi-vis commands → AgentSession / AgentSessionRuntime methods
 * 2. Forwards AgentSession events → main process via process.send()
 * 3. Handles session lifecycle (newSession, fork, switchSession) with rebind
 *
 * Response shapes mirror `pi --mode rpc` (modes/rpc/rpc-mode.js) exactly, so
 * the renderer cannot tell the SDK host apart from the RPC subprocess and the
 * `pi --mode rpc` fallback behaves identically. Every command the renderer
 * emits is handled here; method signatures are verified against the installed
 * pi's .d.ts (AgentSession getters/methods, ExtensionRunner.getRegisteredCommands,
 * SessionManager.getLeafId, ModelRegistry.getAvailable).
 */

/**
 * Fail fast if the installed pi is missing any SDK surface this bridge calls.
 *
 * The host is plain .mjs (not type-checked against pi's .d.ts), so a method
 * pi renames in a future release would otherwise surface as a cryptic crash
 * mid-session. Verifying the surface at startup turns that into a clean throw
 * during init → the registry falls back to `pi --mode rpc` with a clear reason.
 * Keep this list in sync with the methods/getters used below + in host.mjs.
 */
export function assertHostCapabilities(session, runtime) {
  const missing = [];
  const fn = (obj, name, label) => {
    if (!obj || typeof obj[name] !== "function") missing.push(label);
  };

  for (const m of [
    "prompt",
    "steer",
    "followUp",
    "abort",
    "setModel",
    "setThinkingLevel",
    "executeBash",
    "compact",
    "getSessionStats",
    "getLastAssistantText",
    "exportToHtml",
    "getUserMessagesForForking",
    "setSessionName",
    "subscribe",
    "bindExtensions",
    "reload",
  ]) {
    fn(session, m, `session.${m}`);
  }
  fn(session?.modelRegistry, "getAvailable", "session.modelRegistry.getAvailable");
  fn(
    session?.extensionRunner,
    "getRegisteredCommands",
    "session.extensionRunner.getRegisteredCommands",
  );
  fn(session?.resourceLoader, "getSkills", "session.resourceLoader.getSkills");
  fn(session?.sessionManager, "getLeafId", "session.sessionManager.getLeafId");

  for (const m of [
    "newSession",
    "fork",
    "switchSession",
    "setRebindSession",
    "setBeforeSessionInvalidate",
    "dispose",
  ]) {
    fn(runtime, m, `runtime.${m}`);
  }

  // Getters read by getState(); presence (not callability) is what matters.
  for (const g of [
    "model",
    "thinkingLevel",
    "isStreaming",
    "isCompacting",
    "steeringMode",
    "followUpMode",
    "sessionFile",
    "sessionId",
    "sessionName",
    "autoCompactionEnabled",
    "messages",
    "pendingMessageCount",
    "promptTemplates",
  ]) {
    if (!(g in session)) missing.push(`session.${g}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Installed pi is missing expected SDK surface (likely an incompatible version): ${missing.join(", ")}`,
    );
  }
}

/**
 * Register the command handler + rebind logic.
 *
 * @param {object} ctx
 * @param {object} ctx.runtime - AgentSessionRuntime
 * @param {object} ctx.session - AgentSession (current)
 * @param {object} ctx.uiContext - the host's ExtensionUIContext (cwd-independent;
 *   reused across rebinds — NOT read from runtime.services, which is replaced
 *   on every session swap and would lose the uiContext reference)
 * @param {object} ctx.send - process.send (IPC to main)
 * @param {object} ctx.panelBridge - the host panel bridge (for closeAll on swap)
 * @returns {{ handleCommand: Function, bindExtensions: Function }}
 */
export function setupCommandBridge({ runtime, session, uiContext, send, panelBridge }) {
  let _session = session;
  let _unsubscribe = null;

  // ─── Event forwarding ──────────────────────────────────────────────────

  function subscribeSession(s) {
    _unsubscribe?.();
    _unsubscribe = s.subscribe((event) => {
      // Forward raw event to main process (structured clone over process.send).
      // AgentSessionEvent is a plain serializable object.
      send({ type: "event", event });
    });
  }

  subscribeSession(_session);

  // ─── Extension binding (shared by initial bind + rebind) ───────────────
  // The SAME uiContext + commandContextActions + shutdown/onError wiring must
  // apply to the initial session and every rebound session (after /new, /fork,
  // /clone, /switch_session). Centralizing it here prevents the old bug where
  // the initial bind passed `commandContextActions: null` + a no-op
  // shutdownHandler while rebind passed real ones — extensions that called
  // ctx.actions.newSession() worked only after the first rebind.

  function bindExtensions(s) {
    return s.bindExtensions({
      uiContext,
      mode: "tui",
      commandContextActions: buildCommandContextActions(runtime),
      // An extension requested app shutdown (e.g. a TUI-style /exit). In a GUI
      // the user — not an extension — owns session lifecycle, so this is a
      // deliberate no-op: we don't tear down the user's session (and its
      // transcript) on an extension's say-so. Present to satisfy bindExtensions.
      shutdownHandler: () => {},
      onError: (error) => {
        // ExtensionError = { extensionPath, event, error, stack? }
        send({
          type: "event",
          event: {
            type: "extension_error",
            extensionPath: error?.extensionPath,
            event: error?.event,
            error: error?.error,
          },
        });
      },
    });
  }

  // ─── Rebind ────────────────────────────────────────────────────────────

  runtime.setRebindSession(async (newSession) => {
    _session = newSession;
    await bindExtensions(newSession);
    subscribeSession(newSession);
  });

  runtime.setBeforeSessionInvalidate(() => {
    // P3-c: tear down any open custom() panels before the session is replaced:
    // closeAll() settles each panel's custom() promise and stops its TUI
    // render loop on the HOST side. Only emit panel_clear_all to the renderer
    // when a panel was actually open — every /new//fork//clone//switch used
    // to spam a no-op event the renderer handled as a no-op.
    const hadPanels = panelBridge.closeAll();
    if (hadPanels) send({ type: "panel_clear_all" });
  });

  // ─── State helpers (mirror RpcSessionState / RPC get_commands) ─────────

  /** Build the get_state response, matching RpcSessionState exactly. */
  function getState() {
    const s = _session;
    return {
      // s.model is a pure-data Model object (id/name/api/provider/baseUrl/...),
      // structured-clone-safe over IPC. `?? null` matches the nullable schema.
      model: s.model ?? null,
      thinkingLevel: s.thinkingLevel,
      isStreaming: s.isStreaming,
      isCompacting: s.isCompacting,
      steeringMode: s.steeringMode,
      followUpMode: s.followUpMode,
      sessionFile: s.sessionFile,
      sessionId: s.sessionId,
      sessionName: s.sessionName,
      autoCompactionEnabled: s.autoCompactionEnabled,
      messageCount: s.messages.length,
      pendingMessageCount: s.pendingMessageCount,
    };
  }

  /** Build the get_commands response, mirroring rpc-mode.js exactly. */
  function getCommands() {
    const commands = [];
    for (const command of _session.extensionRunner.getRegisteredCommands()) {
      commands.push({
        name: command.invocationName,
        description: command.description,
        source: "extension",
        sourceInfo: command.sourceInfo,
      });
    }
    for (const template of _session.promptTemplates) {
      commands.push({
        name: template.name,
        description: template.description,
        source: "prompt",
        sourceInfo: template.sourceInfo,
      });
    }
    for (const skill of _session.resourceLoader.getSkills().skills) {
      commands.push({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: "skill",
        sourceInfo: skill.sourceInfo,
      });
    }
    return commands;
  }

  // ─── Command handler ───────────────────────────────────────────────────

  async function handleCommand(msg) {
    const { id, command } = msg;

    try {
      switch (command.type) {
        // ── Prompting ──────────────────────────────────────────────────
        // prompt() does NOT resolve until the turn completes, so — like
        // rpc-mode — we fire-and-forget it and respond early via the
        // preflightResult callback (success = "prompt accepted by the guards").
        // A `responded` guard ensures exactly one response even if preflight
        // rejects AND the promise later rejects.
        case "prompt": {
          let responded = false;
          const respond = (ok, errMsg) => {
            if (responded) return;
            responded = true;
            send({
              type: "response",
              id,
              success: ok,
              ...(errMsg ? { error: errMsg } : {}),
            });
          };
          void _session
            .prompt(command.message, {
              ...(command.images?.length ? { images: command.images } : {}),
              ...(command.streamingBehavior
                ? { streamingBehavior: command.streamingBehavior }
                : {}),
              source: "rpc",
              preflightResult: (didSucceed) => {
                if (didSucceed) respond(true);
                else respond(false, "Prompt rejected");
              },
            })
            .catch((err) => respond(false, err instanceof Error ? err.message : String(err)));
          break;
        }

        // steer()/followUp() queue a message; they resolve promptly (no full
        // turn), so a plain await + success is correct.
        case "steer": {
          await _session.steer(command.message, command.images);
          send({ type: "response", id, success: true });
          break;
        }

        case "follow_up": {
          await _session.followUp(command.message, command.images);
          send({ type: "response", id, success: true });
          break;
        }

        case "abort": {
          await _session.abort();
          send({ type: "response", id, success: true });
          break;
        }

        // ── Model / thinking ───────────────────────────────────────────
        // setModel takes a Model object, not provider/modelId — resolve via
        // the registry exactly as rpc-mode does.
        case "set_model": {
          const models = await _session.modelRegistry.getAvailable();
          const model = models.find(
            (m) => m.provider === command.provider && m.id === command.modelId,
          );
          if (!model) {
            send({
              type: "response",
              id,
              success: false,
              error: `Model not found: ${command.provider}/${command.modelId}`,
            });
            return;
          }
          await _session.setModel(model);
          send({ type: "response", id, success: true });
          break;
        }

        case "set_thinking_level": {
          _session.setThinkingLevel(command.level);
          send({ type: "response", id, success: true });
          break;
        }

        case "get_available_models": {
          const models = await _session.modelRegistry.getAvailable();
          send({ type: "response", id, success: true, data: { models } });
          break;
        }

        // ── Bash ───────────────────────────────────────────────────────
        // executeBash(command, onChunk?, options?). The renderer reads
        // data.output / data.exitCode; returning the full BashResult (which
        // also carries cancelled/truncated) matches rpc-mode and is a superset.
        case "bash": {
          const result = await _session.executeBash(command.command, undefined, {
            ...(command.excludeFromContext !== undefined
              ? { excludeFromContext: command.excludeFromContext }
              : {}),
          });
          send({ type: "response", id, success: true, data: result });
          break;
        }

        // ── Compaction ─────────────────────────────────────────────────
        // compact(customInstructions?: string) — a STRING, not an options
        // object. The old bridge passed { customInstructions } and pi silently
        // stringified it to "[object Object]".
        case "compact": {
          await _session.compact(command.customInstructions);
          send({ type: "response", id, success: true });
          break;
        }

        // ── Introspection ──────────────────────────────────────────────
        case "get_session_stats": {
          send({ type: "response", id, success: true, data: _session.getSessionStats() });
          break;
        }

        case "get_commands": {
          send({ type: "response", id, success: true, data: { commands: getCommands() } });
          break;
        }

        case "get_state": {
          send({ type: "response", id, success: true, data: getState() });
          break;
        }

        case "get_last_assistant_text": {
          send({
            type: "response",
            id,
            success: true,
            data: { text: _session.getLastAssistantText() },
          });
          break;
        }

        case "export_html": {
          const outPath = await _session.exportToHtml(command.outputPath);
          send({ type: "response", id, success: true, data: { path: outPath } });
          break;
        }

        case "get_fork_messages": {
          send({
            type: "response",
            id,
            success: true,
            data: { messages: _session.getUserMessagesForForking() },
          });
          break;
        }

        case "set_session_name": {
          _session.setSessionName(command.name);
          send({ type: "response", id, success: true });
          break;
        }

        // ── Session lifecycle (runtime) ────────────────────────────────
        // These replace the session; the rebind callback (registered above)
        // re-binds extensions + re-subscribes before the runtime resolves, so
        // _session is already the new session when we send the response. ipc.ts
        // then harvests the new sessionFile via a follow-up get_state.
        case "new_session": {
          const result = await runtime.newSession();
          send({
            type: "response",
            id,
            success: !result.cancelled,
            data: { cancelled: result.cancelled },
          });
          break;
        }

        case "fork": {
          const result = await runtime.fork(command.entryId);
          send({
            type: "response",
            id,
            success: !result.cancelled,
            data: { text: result.selectedText, cancelled: result.cancelled },
          });
          break;
        }

        case "switch_session": {
          const result = await runtime.switchSession(command.sessionPath);
          send({
            type: "response",
            id,
            success: !result.cancelled,
            data: { cancelled: result.cancelled },
          });
          break;
        }

        // clone = fork the leaf entry at-position (mirrors rpc-mode). The old
        // bridge read a nonexistent stats.lastEntryId; the real source of truth
        // is sessionManager.getLeafId().
        case "clone": {
          const leafId = _session.sessionManager.getLeafId();
          if (!leafId) {
            send({
              type: "response",
              id,
              success: false,
              error: "Cannot clone session: no current entry selected",
            });
            return;
          }
          const result = await runtime.fork(leafId, { position: "at" });
          send({
            type: "response",
            id,
            success: !result.cancelled,
            data: { cancelled: result.cancelled },
          });
          break;
        }

        default: {
          send({
            type: "response",
            id,
            success: false,
            error: `Unknown command type: ${command.type}`,
          });
        }
      }
    } catch (err) {
      send({
        type: "response",
        id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { handleCommand, bindExtensions };
}

/**
 * Build ExtensionCommandContextActions for bindExtensions.
 * Mirrors the ExtensionCommandContextActions interface (waitForIdle/newSession/
 * fork/navigateTree/switchSession/reload). navigateTree maps to fork with
 * position "before" (the closest runtime equivalent).
 */
function buildCommandContextActions(runtime) {
  return {
    waitForIdle: async () => {
      // The runtime exposes no public idle-await; pi-vis drives commands
      // serially over the wire, so this is effectively a no-op here. Kept to
      // satisfy the interface so extensions that call it don't throw.
    },
    newSession: async (options) => runtime.newSession(options),
    fork: async (entryId, options) => runtime.fork(entryId, options),
    navigateTree: async (targetId, options) =>
      runtime.fork(targetId, { position: "before", ...options }),
    switchSession: async (sessionPath, options) => runtime.switchSession(sessionPath, options),
    reload: async () => {
      // In-process reload, exactly as pi --mode rpc does (rpc-mode.js calls
      // session.reload()). It swaps the extension runner in place on the SAME
      // session object — so it does NOT trigger setRebindSession, our event
      // subscription stays valid, and our mode:"tui" uiContext binding is
      // preserved. This is what makes extension flows like `/mcp setup` →
      // ctx.actions.reload() actually pick up the new config. (The old code
      // fired a `reload_requested` message that nothing in main consumed, so
      // extension-initiated reload was a silent no-op.)
      await runtime.session.reload();
    },
  };
}
