import type { SessionId } from "@shared/ids.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBatcher } from "./event-batcher.js";

const A = "a" as SessionId;
const B = "b" as SessionId;

describe("createEventBatcher", () => {
  afterEach(() => vi.useRealTimers());

  it("sends the leading event immediately and coalesces trailing events", () => {
    vi.useFakeTimers();
    const sends: unknown[] = [];
    const b = createEventBatcher((payload) => sends.push(payload), 16);
    b.push(A, { type: "agent_start" });
    b.push(A, { type: "agent_end" });
    expect(sends).toEqual([{ sessionId: A, events: [{ type: "agent_start" }] }]);
    vi.advanceTimersByTime(16);
    expect(sends).toEqual([
      { sessionId: A, events: [{ type: "agent_start" }] },
      { sessionId: A, events: [{ type: "agent_end" }] },
    ]);
  });

  it("keeps sessions isolated", () => {
    vi.useFakeTimers();
    const sends: unknown[] = [];
    const b = createEventBatcher((payload) => sends.push(payload), 16);
    b.push(A, { type: "agent_start" });
    b.push(B, { type: "agent_end" });
    expect(sends).toEqual([
      { sessionId: A, events: [{ type: "agent_start" }] },
      { sessionId: B, events: [{ type: "agent_end" }] },
    ]);
  });

  it("flushes before non-event sends", () => {
    vi.useFakeTimers();
    const sends: unknown[] = [];
    const b = createEventBatcher((payload) => sends.push(payload), 16);
    b.push(A, { type: "agent_start" });
    b.push(A, { type: "agent_end" });
    b.flush(A);
    expect(sends).toEqual([
      { sessionId: A, events: [{ type: "agent_start" }] },
      { sessionId: A, events: [{ type: "agent_end" }] },
    ]);
  });

  it("dispose drops pending trailing events", () => {
    vi.useFakeTimers();
    const sends: unknown[] = [];
    const b = createEventBatcher((payload) => sends.push(payload), 16);
    b.push(A, { type: "agent_start" });
    b.push(A, { type: "agent_end" });
    b.dispose();
    vi.advanceTimersByTime(16);
    expect(sends).toEqual([{ sessionId: A, events: [{ type: "agent_start" }] }]);
  });
});
