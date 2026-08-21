import type { SessionId } from "@shared/ids.js";
import {
  MARKDOWN_TRANSFORM_MAX_INPUT_BYTES,
  MARKDOWN_TRANSFORM_MAX_ITEMS,
  MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES,
  type MarkdownTransformItem,
  MarkdownTransformResultDataSchema,
  markdownTransformJsonBytes,
  markdownTransformUtf8Bytes,
} from "@shared/pi-protocol/markdown-transform.js";
import type { RuntimeIdentity } from "@shared/pi-protocol/runtime-state.js";
import { querySession } from "./session-intent.js";

type TransformRequest = Omit<MarkdownTransformItem, "requestId">;

interface PendingTransform {
  item: MarkdownTransformItem;
  resolve: (markdown: string) => void;
}

interface TransformQueue {
  sessionId: SessionId;
  owner: RuntimeIdentity;
  pending: PendingTransform[];
  running: boolean;
  scheduled: boolean;
}

const queues = new Map<string, TransformQueue>();

function queueKey(sessionId: SessionId, owner: RuntimeIdentity): string {
  return `${sessionId}\0${owner.hostInstanceId}\0${owner.sessionEpoch}`;
}

function schedule(key: string, queue: TransformQueue): void {
  if (queue.running || queue.scheduled) return;
  queue.scheduled = true;
  queueMicrotask(() => void flush(key, queue));
}

async function flush(key: string, queue: TransformQueue): Promise<void> {
  queue.scheduled = false;
  if (queue.running) return;
  // A prior flush can remove its now-empty queue while promises it resolved
  // are already scheduling more work. Ignore that detached generation.
  if (queues.get(key) !== queue) return;
  const pending: PendingTransform[] = [];
  let batchBytes = 2; // JSON array brackets.
  while (pending.length < MARKDOWN_TRANSFORM_MAX_ITEMS && queue.pending.length > 0) {
    const next = queue.pending[0];
    if (!next) break;
    const nextBytes = markdownTransformJsonBytes(next.item);
    const candidateBytes = batchBytes + nextBytes + (pending.length > 0 ? 1 : 0);
    if (pending.length > 0 && candidateBytes > MARKDOWN_TRANSFORM_MAX_REQUEST_BATCH_BYTES) {
      break;
    }
    queue.pending.shift();
    pending.push(next);
    batchBytes = candidateBytes;
  }
  if (pending.length === 0) {
    queues.delete(key);
    return;
  }
  queue.running = true;
  try {
    const result = await querySession(
      queue.sessionId,
      { type: "transform_markdown", items: pending.map(({ item }) => item) },
      { owner: queue.owner },
    );
    const parsed =
      result.status === "ok" &&
      result.owner.hostInstanceId === queue.owner.hostInstanceId &&
      result.owner.sessionEpoch === queue.owner.sessionEpoch &&
      result.response.success
        ? MarkdownTransformResultDataSchema.safeParse(result.response.data)
        : undefined;
    const transformed = parsed?.success
      ? new Map(parsed.data.items.map((item) => [item.requestId, item.markdown]))
      : new Map<string, string>();
    for (const request of pending) {
      request.resolve(transformed.get(request.item.requestId) ?? request.item.markdown);
    }
  } catch {
    for (const request of pending) request.resolve(request.item.markdown);
  } finally {
    queue.running = false;
    if (queues.get(key) === queue) {
      if (queue.pending.length > 0) {
        schedule(key, queue);
      } else {
        // Promise continuations from the resolved batch run in later
        // microtasks. Defer deletion so a same-owner request they enqueue can
        // reuse this queue instead of racing this flush's cleanup.
        queueMicrotask(() => {
          if (queues.get(key) === queue && !queue.running && queue.pending.length === 0) {
            queues.delete(key);
          }
        });
      }
    }
  }
}

/** Batches display-only extension transforms by exact SDK-host owner. */
export function requestExtensionMarkdownTransform(
  sessionId: SessionId,
  owner: RuntimeIdentity,
  request: TransformRequest,
): Promise<string> {
  if (markdownTransformUtf8Bytes(request.markdown) > MARKDOWN_TRANSFORM_MAX_INPUT_BYTES) {
    return Promise.resolve(request.markdown);
  }
  const key = queueKey(sessionId, owner);
  let queue = queues.get(key);
  if (!queue) {
    queue = { sessionId, owner, pending: [], running: false, scheduled: false };
    queues.set(key, queue);
  }
  return new Promise((resolve) => {
    queue.pending.push({ item: { ...request, requestId: crypto.randomUUID() }, resolve });
    schedule(key, queue);
  });
}
