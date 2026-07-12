import type { SessionId } from "@shared/ids.js";
import { type PiRpcCommand, commandNeedsIntent } from "@shared/pi-protocol/commands.js";
import type { CommandSettlement, RuntimeIdentity } from "@shared/pi-protocol/runtime-state.js";

export interface SessionCommandOptions {
  uiSurface?: "composer" | "unified";
  sourceText?: string;
  editorRevision?: number;
}

/** Build the only valid renderer→main Pi command request shape. */
export function buildSessionCommandRequest(
  sessionId: SessionId,
  command: PiRpcCommand,
  runtime: RuntimeIdentity,
  options: SessionCommandOptions = {},
) {
  return {
    sessionId,
    command,
    requestId: crypto.randomUUID(),
    expectedHostInstanceId: runtime.hostInstanceId,
    expectedSessionEpoch: runtime.sessionEpoch,
    ...(commandNeedsIntent(command) ? { intentId: crypto.randomUUID() } : {}),
    ...(options.uiSurface ? { uiSurface: options.uiSurface } : {}),
    ...(options.sourceText !== undefined ? { sourceText: options.sourceText } : {}),
    ...(options.editorRevision !== undefined ? { editorRevision: options.editorRevision } : {}),
  };
}

export function invokeSessionCommand(
  sessionId: SessionId,
  command: PiRpcCommand,
  runtime: RuntimeIdentity,
  options: SessionCommandOptions = {},
): Promise<CommandSettlement> {
  return window.pivis.invoke(
    "session.sendCommand",
    buildSessionCommandRequest(sessionId, command, runtime, options),
  );
}
