import { PiEventSchema } from "@shared/pi-protocol/events.js";
import type { PiEvent } from "@shared/pi-protocol/events.js";
import { ExtensionUiRequestSchema } from "@shared/pi-protocol/extension-ui.js";
import type { ExtensionUiRequest } from "@shared/pi-protocol/extension-ui.js";
import { PiRpcResponseSchema } from "@shared/pi-protocol/responses.js";
import type { PiRpcResponse } from "@shared/pi-protocol/responses.js";

export type PiOutbound =
  | { kind: "response"; data: PiRpcResponse }
  | { kind: "event"; data: PiEvent }
  | { kind: "extension_ui_request"; data: ExtensionUiRequest }
  | { kind: "unknown"; raw: unknown };

function parseOutbound(raw: unknown): PiOutbound {
  if (typeof raw !== "object" || raw === null) {
    return { kind: "unknown", raw };
  }

  const obj = raw as Record<string, unknown>;

  if (obj["type"] === "response") {
    const result = PiRpcResponseSchema.safeParse(raw);
    if (result.success) return { kind: "response", data: result.data };
    return { kind: "unknown", raw };
  }

  if (obj["type"] === "extension_ui_request") {
    const result = ExtensionUiRequestSchema.safeParse(raw);
    if (result.success) return { kind: "extension_ui_request", data: result.data };
    return { kind: "unknown", raw };
  }

  // Everything else is an event
  const result = PiEventSchema.safeParse(raw);
  if (result.success) return { kind: "event", data: result.data };
  return { kind: "unknown", raw };
}

export class JsonlStream {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private onLine: (parsed: PiOutbound) => void;
  private onError: (err: Error) => void;

  private static readonly MAX_BUFFER_BYTES = 64 * 1024 * 1024;

  constructor(onLine: (parsed: PiOutbound) => void, onError: (err: Error) => void) {
    this.onLine = onLine;
    this.onError = onError;
  }

  // Byte-level splitter — split ONLY on 0x0A (\n), never on Unicode separators.
  // Scans each incoming chunk exactly once; partial lines are retained as a
  // list of slices so a multi-MB line fed in tiny chunks does not repeatedly
  // concatenate and rescan old bytes.
  feed(chunk: Buffer): void {
    let start = 0;

    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 0x0a) continue;

      const segment = chunk.subarray(start, i);
      const line =
        this.pending.length === 0
          ? segment
          : Buffer.concat([...this.pending, segment], this.pendingBytes + segment.length);
      this.pending = [];
      this.pendingBytes = 0;
      start = i + 1;

      const stripped =
        line.length > 0 && line[line.length - 1] === 0x0d ? line.subarray(0, -1) : line;
      if (stripped.length === 0) continue;

      const lineStr = stripped.toString("utf8");
      try {
        const raw = JSON.parse(lineStr) as unknown;
        this.onLine(parseOutbound(raw));
      } catch (e) {
        this.onError(
          new Error(
            `JSONL parse error: ${e instanceof Error ? e.message : String(e)} on line: ${lineStr.slice(0, 200)}`,
          ),
        );
      }
    }

    if (start < chunk.length) {
      const tail = chunk.subarray(start);
      this.pending.push(tail);
      this.pendingBytes += tail.length;
      if (this.pendingBytes > JsonlStream.MAX_BUFFER_BYTES) {
        this.onError(
          new Error(
            `JSONL line exceeded ${JsonlStream.MAX_BUFFER_BYTES} bytes; dropping partial buffer`,
          ),
        );
        this.pending = [];
        this.pendingBytes = 0;
      }
    }
  }
}
