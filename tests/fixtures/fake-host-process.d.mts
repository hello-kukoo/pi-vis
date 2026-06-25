import type { EventEmitter } from "node:events";

export interface HostWireMessage {
  type: string;
  [key: string]: unknown;
}

export class FakeHostProcess extends EventEmitter {
  sent: HostWireMessage[];
  killed: boolean;
  exitCode: number | null;
  killSignal?: NodeJS.Signals;
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter;
  connected: boolean;
  send(msg: HostWireMessage, _cb?: (err: Error | null) => void): boolean;
  emitMessage(msg: HostWireMessage): void;
  emitStderr(text: string): void;
  emitSpawned(): void;
  emitReady(piVersion?: string): void;
  emitError(message: string, opts?: { versionTooLow?: boolean }): void;
  emitExit(code: number | null): void;
  kill(signal?: NodeJS.Signals): boolean;
}
