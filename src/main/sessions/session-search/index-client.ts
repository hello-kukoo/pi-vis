import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ContextLoadOptions, ResolvedContextTarget } from "./context-loader.js";
import type { CatalogSource } from "./session-catalog.js";
import type {
  SearchWorkerRequest,
  SearchWorkerResponse,
  SearchWorkerSource,
} from "./worker-protocol.js";

interface WorkerLike {
  postMessage(message: SearchWorkerRequest): void;
  on(event: "message", listener: (message: SearchWorkerResponse) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

export type SearchIndexWorkerFactory = () => WorkerLike;

export function resolveSessionSearchWorkerPath(baseUrl: string | URL = import.meta.url): string {
  const basePath = fileURLToPath(baseUrl);
  const relativeWorker =
    path.basename(path.dirname(basePath)) === "chunks"
      ? "../session-search-worker.js"
      : "./session-search-worker.js";
  return fileURLToPath(new URL(relativeWorker, baseUrl)).replace(
    /app\.asar(?=[\\/])/u,
    "app.asar.unpacked",
  );
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(resolveSessionSearchWorkerPath(), {
    name: "pivis-session-search",
    resourceLimits: SESSION_SEARCH_WORKER_RESOURCE_LIMITS,
  }) as WorkerLike;
}

type SearchWorkerRequestWithoutId = SearchWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

interface Pending {
  resolve: (response: SearchWorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 60_000;
const RECONCILE_REQUEST_TIMEOUT_MS = 5 * 60_000;
const MAX_PENDING_REQUESTS = 128;
export const SESSION_SEARCH_WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 96,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,
} as const;

/** Typed owner for the single long-lived SQLite worker. */
export class SessionSearchIndexClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stopped = false;
  private restartRemaining = 1;
  private databaseDirectory: string | null = null;
  private terminalFailure: Error | null = null;

  constructor(private readonly workerFactory: SearchIndexWorkerFactory = defaultWorkerFactory) {}

  async initialize(databaseDirectory: string): Promise<SearchWorkerResponse> {
    this.databaseDirectory = databaseDirectory;
    this.ensureWorker();
    return this.request({ type: "initialize", databaseDirectory });
  }

  reconcile(sources: SearchWorkerSource[], completeCatalog = true): Promise<SearchWorkerResponse> {
    return this.request({ type: "reconcile", sources, completeCatalog });
  }

  query(
    workspacePath: string,
    query: string,
    offset: number,
    limit: number,
    pinnedSourcePaths: string[],
    expandedSourcePaths: string[],
    allowedSourcePaths: string[],
  ): Promise<SearchWorkerResponse> {
    return this.request({
      type: "query",
      workspacePath,
      query,
      offset,
      limit,
      pinnedSourcePaths,
      expandedSourcePaths,
      allowedSourcePaths,
    });
  }

  context(
    source: CatalogSource,
    target: ResolvedContextTarget,
    options: ContextLoadOptions,
    sourceDescriptor?: number,
  ): Promise<SearchWorkerResponse> {
    return this.request({
      type: "context",
      source,
      target,
      options,
      ...(sourceDescriptor === undefined ? {} : { sourceDescriptor }),
    });
  }

  validate(
    source: CatalogSource,
    target: ResolvedContextTarget,
    sourceDescriptor?: number,
  ): Promise<SearchWorkerResponse> {
    return this.request({
      type: "validate",
      source,
      target,
      ...(sourceDescriptor === undefined ? {} : { sourceDescriptor }),
    });
  }

  status(workspacePath?: string): Promise<SearchWorkerResponse> {
    return this.request({ type: "status", ...(workspacePath ? { workspacePath } : {}) });
  }

  rebuild(sources: SearchWorkerSource[]): Promise<SearchWorkerResponse> {
    return this.request({ type: "rebuild", sources });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const worker = this.worker;
    if (!worker) return;
    try {
      await Promise.race([
        this.request({ type: "shutdown" }, true),
        new Promise((resolve) => setTimeout(resolve, 750)),
      ]);
    } catch {
      // Shutdown is best-effort; source history is never owned by the index.
    }
    this.worker = null;
    await worker.terminate().catch(() => 0);
    this.rejectAll(new Error("Session search worker stopped"));
  }

  private request(
    message: SearchWorkerRequestWithoutId,
    allowStopped = false,
  ): Promise<SearchWorkerResponse> {
    if (this.stopped && !allowStopped) {
      return Promise.reject(new Error("Session search index is stopped"));
    }
    if (this.terminalFailure && !allowStopped) return Promise.reject(this.terminalFailure);
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error("Session search worker request queue is full"));
    }
    this.ensureWorker();
    const id = this.nextId++;
    const request = { ...message, id } as SearchWorkerRequest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`Session search worker request timed out: ${request.type}`));
        },
        request.type === "reconcile" || request.type === "rebuild"
          ? RECONCILE_REQUEST_TIMEOUT_MS
          : REQUEST_TIMEOUT_MS,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker?.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureWorker(): void {
    if (this.worker || this.stopped) return;
    const worker = this.workerFactory();
    this.worker = worker;
    worker.on("message", (response) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response);
      else pending.reject(new Error(response.error));
    });
    worker.on("error", (error) => this.handleWorkerFailure(worker, error));
    worker.on("exit", (code) => {
      if (!this.stopped && code !== 0) {
        this.handleWorkerFailure(worker, new Error(`Session search worker exited (${code})`));
      }
    });
  }

  private handleWorkerFailure(failed: WorkerLike, error: Error): void {
    // A crashed worker normally emits both error and exit. The exit from the
    // retired instance must not tear down the replacement created for error.
    if (this.worker !== failed) return;
    this.worker = null;
    void failed.terminate().catch(() => 0);
    this.rejectAll(error);
    if (this.stopped) return;
    if (this.restartRemaining <= 0 || !this.databaseDirectory) {
      this.terminalFailure = error;
      return;
    }
    this.restartRemaining -= 1;
    try {
      this.ensureWorker();
      const replacement = this.worker;
      void this.request({
        type: "initialize",
        databaseDirectory: this.databaseDirectory,
      }).catch((restartError) => {
        if (replacement) {
          this.handleWorkerFailure(
            replacement,
            restartError instanceof Error ? restartError : new Error(String(restartError)),
          );
        }
      });
    } catch (restartError) {
      this.terminalFailure =
        restartError instanceof Error ? restartError : new Error(String(restartError));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
