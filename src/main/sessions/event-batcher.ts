import type { SessionId } from "@shared/ids.js";
import type { PiEvent } from "@shared/pi-protocol/events.js";

export interface EventBatcher {
  push(sessionId: SessionId, event: PiEvent): void;
  flush(sessionId: SessionId): void;
  flushAll(): void;
  dispose(): void;
}

interface Bucket {
  events: PiEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

export function createEventBatcher(
  send: (payload: { sessionId: SessionId; events: PiEvent[] }) => void,
  windowMs = 16,
): EventBatcher {
  const buckets = new Map<SessionId, Bucket>();

  const getBucket = (sessionId: SessionId): Bucket => {
    let bucket = buckets.get(sessionId);
    if (!bucket) {
      bucket = { events: [], timer: null };
      buckets.set(sessionId, bucket);
    }
    return bucket;
  };

  const flush = (sessionId: SessionId): void => {
    const bucket = buckets.get(sessionId);
    if (!bucket) return;
    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }
    if (bucket.events.length > 0) {
      const events = bucket.events;
      bucket.events = [];
      send({ sessionId, events });
    }
    buckets.delete(sessionId);
  };

  return {
    push(sessionId, event) {
      const bucket = getBucket(sessionId);
      if (bucket.events.length === 0 && bucket.timer === null) {
        send({ sessionId, events: [event] });
        bucket.timer = setTimeout(() => flush(sessionId), windowMs);
        return;
      }
      bucket.events.push(event);
    },
    flush,
    flushAll() {
      for (const sessionId of Array.from(buckets.keys())) flush(sessionId);
    },
    dispose() {
      for (const bucket of buckets.values()) {
        if (bucket.timer) clearTimeout(bucket.timer);
      }
      buckets.clear();
    },
  };
}
