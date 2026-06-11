import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { newRpcRequestId } from "@shared/ids.js";
import type { RpcRequestId } from "@shared/ids.js";
import type { PiRpcCommand } from "@shared/pi-protocol/commands.js";
import type { PiRpcResponse } from "@shared/pi-protocol/responses.js";
import type { PiEvent } from "@shared/pi-protocol/events.js";
import type { ExtensionUiRequest } from "@shared/pi-protocol/extension-ui.js";
import { JsonlStream } from "./jsonl-stream.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const PROMPT_COMMANDS = new Set(["prompt", "bash", "steer", "follow_up", "compact"]);

interface PendingRequest {
  resolve: (res: PiRpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PiProcessEvents {
  event: (event: PiEvent) => void;
  uiRequest: (req: ExtensionUiRequest) => void;
  exit: (code: number | null, signal: string | null) => void;
  error: (err: Error) => void;
}

export class PiProcess extends EventEmitter {
  private proc: ChildProcess;
  private stream: JsonlStream;
  private pending = new Map<string, PendingRequest>();
  public stderrLog: string[] = [];
  public readonly sessionFile?: string | undefined;

  constructor(
    piPath: string,
    workspacePath: string,
    sessionFile?: string,
  ) {
    super();
    this.sessionFile = sessionFile;
    const args = ["--mode", "rpc"];
    if (sessionFile) args.push("--session", sessionFile);

    this.proc = spawn(piPath, args, {
      cwd: workspacePath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.stream = new JsonlStream(
      (parsed) => {
        if (parsed.kind === "response") {
          const id = parsed.data.id;
          if (id) {
            const pending = this.pending.get(id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(id);
              pending.resolve(parsed.data);
              return;
            }
          }
          // Response with no pending request — log and ignore
          console.warn("[pi-process] unmatched response", parsed.data);
        } else if (parsed.kind === "event") {
          this.emit("event", parsed.data);
        } else if (parsed.kind === "extension_ui_request") {
          this.emit("uiRequest", parsed.data);
        } else {
          console.debug("[pi-process] unknown outbound", parsed.raw);
        }
      },
      (err) => {
        console.error("[pi-process] jsonl error", err);
      },
    );

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.stream.feed(chunk);
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8");
      this.stderrLog.push(line);
      if (this.stderrLog.length > 500) this.stderrLog.shift();
    });

    this.proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.rejectAllPending(new Error(`pi process exited with code ${code}`));
      this.emit("exit", code, signal);
    });

    this.proc.on("error", (err) => {
      this.rejectAllPending(err);
      this.emit("error", err);
    });
  }

  async sendCommand(
    command: PiRpcCommand,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<PiRpcResponse> {
    const id = newRpcRequestId() as string;
    const msg = JSON.stringify({ ...command, id }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout for command ${command.type} (id=${id})`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      if (!this.proc.stdin?.writable) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("pi process stdin is not writable"));
        return;
      }

      this.proc.stdin.write(msg, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  sendUiResponse(responseJson: string): void {
    if (this.proc.stdin?.writable) {
      this.proc.stdin.write(responseJson + "\n");
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }

  isPromptCommand(type: string): boolean {
    return PROMPT_COMMANDS.has(type);
  }

  private killTimer: ReturnType<typeof setTimeout> | null = null;

  stop(): void {
    if (this.killTimer) return; // already stopping
    this.proc.kill("SIGTERM");
    this.killTimer = setTimeout(() => {
      if (this.proc.exitCode === null && !this.proc.killed) {
        this.proc.kill("SIGKILL");
      }
    }, 3000);
    // Don't let the escalation timer hold the app open during quit
    this.killTimer.unref?.();
    this.proc.once("exit", () => {
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
    });
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  get killed(): boolean {
    return this.proc.killed;
  }
}

// Typed overloads for EventEmitter
export interface PiProcess {
  on(event: "event", listener: (event: PiEvent) => void): this;
  on(event: "uiRequest", listener: (req: ExtensionUiRequest) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  emit(event: "event", data: PiEvent): boolean;
  emit(event: "uiRequest", data: ExtensionUiRequest): boolean;
  emit(event: "exit", code: number | null, signal: NodeJS.Signals | null): boolean;
  emit(event: "error", err: Error): boolean;
}
