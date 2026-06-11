import type { SessionId } from "@shared/ids.js";
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionsStore } from "./sessions-store.js";

const SESSION_A = "session-a" as SessionId;
const SESSION_B = "session-b" as SessionId;
const WORKSPACE = "/tmp/test-workspace";

/**
 * These tests pin the invariant that drives the SessionHeader thinking
 * dropdown: whatever pi reports in a `thinking_level_changed` event (or in
 * the response to a `get_state` call, propagated via the same store
 * field) is exactly what the dropdown renders. The UI is a pure function
 * of `state.sessions.get(sessionId).thinkingLevel`.
 */
describe("sessions store - thinking level invariant", () => {
  beforeEach(() => {
    // Reset by replacing the whole store with a fresh one.
    useSessionsStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      workspaces: new Map(),
      activeWorkspacePath: null,
    });
    useSessionsStore.getState().createSession(SESSION_A, WORKSPACE);
    useSessionsStore.getState().createSession(SESSION_B, WORKSPACE);
  });

  it("defaults to no thinking level for a new session", () => {
    const session = useSessionsStore.getState().sessions.get(SESSION_A);
    expect(session?.thinkingLevel).toBeUndefined();
  });

  it("setThinkingLevel updates the session's level (used to seed from get_state)", () => {
    useSessionsStore.getState().setThinkingLevel(SESSION_A, "high");
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.thinkingLevel).toBe("high");
  });

  it("applyEvent reconciles to the value pi reports in thinking_level_changed", () => {
    // User requested "xhigh"; pi silently clamped to "high".
    useSessionsStore.getState().setThinkingLevel(SESSION_A, "xhigh");
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.thinkingLevel).toBe("xhigh");

    useSessionsStore.getState().applyEvent(SESSION_A, {
      type: "thinking_level_changed",
      level: "high",
    });

    // The dropdown must show what pi actually applied, not the requested value.
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.thinkingLevel).toBe("high");
  });

  it("applyEvent is a no-op for sessions it doesn't know about", () => {
    useSessionsStore.getState().applyEvent("unknown" as SessionId, {
      type: "thinking_level_changed",
      level: "low",
    });
    // The known sessions are untouched.
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.thinkingLevel).toBeUndefined();
    expect(useSessionsStore.getState().sessions.get(SESSION_B)?.thinkingLevel).toBeUndefined();
  });

  it("scopes thinking-level changes to a single session", () => {
    useSessionsStore.getState().setThinkingLevel(SESSION_A, "high");
    useSessionsStore.getState().setThinkingLevel(SESSION_B, "off");
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.thinkingLevel).toBe("high");
    expect(useSessionsStore.getState().sessions.get(SESSION_B)?.thinkingLevel).toBe("off");
  });

  it("tolerates coerced-off values (e.g. switching to a non-reasoning model)", () => {
    useSessionsStore.getState().setThinkingLevel(SESSION_A, "xhigh");
    useSessionsStore.getState().applyEvent(SESSION_A, {
      type: "thinking_level_changed",
      level: "off",
    });
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.thinkingLevel).toBe("off");
  });
});

describe("sessions store - session name from pi", () => {
  beforeEach(() => {
    useSessionsStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      workspaces: new Map(),
    });
    useSessionsStore.getState().createSession(SESSION_A, WORKSPACE);
  });

  it("updates sessionName when pi emits session_info_changed", () => {
    useSessionsStore.getState().applyEvent(SESSION_A, {
      type: "session_info_changed",
      name: "Refactor config loader",
    });
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.sessionName).toBe(
      "Refactor config loader",
    );
  });

  it("overwrites a previously-set name with the new one from pi", () => {
    useSessionsStore.getState().setSessionName(SESSION_A, "Old name");
    useSessionsStore.getState().applyEvent(SESSION_A, {
      type: "session_info_changed",
      name: "New name",
    });
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.sessionName).toBe("New name");
  });

  it("scopes session name changes to a single session", () => {
    useSessionsStore.getState().createSession(SESSION_B, WORKSPACE);
    useSessionsStore.getState().applyEvent(SESSION_A, {
      type: "session_info_changed",
      name: "A's name",
    });
    useSessionsStore.getState().applyEvent(SESSION_B, {
      type: "session_info_changed",
      name: "B's name",
    });
    expect(useSessionsStore.getState().sessions.get(SESSION_A)?.sessionName).toBe("A's name");
    expect(useSessionsStore.getState().sessions.get(SESSION_B)?.sessionName).toBe("B's name");
  });
});
