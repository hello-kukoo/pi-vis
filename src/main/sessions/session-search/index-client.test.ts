import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SessionSearchIndexClient, resolveSessionSearchWorkerPath } from "./index-client.js";
import type { SearchWorkerRequest, SearchWorkerResponse } from "./worker-protocol.js";

class FakeWorker extends EventEmitter {
  readonly requests: SearchWorkerRequest[] = [];
  terminated = false;

  postMessage(request: SearchWorkerRequest): void {
    this.requests.push(request);
    queueMicrotask(() => {
      const base = {
        id: request.id,
        ok: true as const,
        revision: 1,
        coverage: { indexedSources: 0, totalSources: 0, skippedSources: 0 },
      };
      let response: SearchWorkerResponse;
      if (request.type === "query") {
        response = { ...base, type: "query", matches: [], total: 0, truncated: false };
      } else if (request.type === "context") {
        response = {
          id: request.id,
          ok: true,
          type: "context",
          result: { outcome: "unavailable", message: "fixture" },
        };
      } else if (request.type === "validate") {
        response = { id: request.id, ok: true, type: "validate", valid: true };
      } else if (request.type === "status") {
        response = { ...base, type: "status" };
      } else if (request.type === "shutdown") {
        response = { id: request.id, ok: true, type: "shutdown" };
      } else {
        response = {
          ...base,
          type:
            request.type === "initialize"
              ? "initialized"
              : request.type === "rebuild"
                ? "rebuilt"
                : "reconciled",
        };
      }
      this.emit("message", response);
    });
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

describe("SessionSearchIndexClient", () => {
  it("resolves the packaged worker from the asar-unpacked mirror", () => {
    expect(
      resolveSessionSearchWorkerPath(
        "file:///Applications/Pi-Vis.app/Contents/Resources/app.asar/out/main/index.js",
      ),
    ).toBe(
      "/Applications/Pi-Vis.app/Contents/Resources/app.asar.unpacked/out/main/session-search-worker.js",
    );
    expect(
      resolveSessionSearchWorkerPath(
        "file:///Applications/Pi-Vis.app/Contents/Resources/app.asar/out/main/chunks/search.js",
      ),
    ).toBe(
      "/Applications/Pi-Vis.app/Contents/Resources/app.asar.unpacked/out/main/session-search-worker.js",
    );
  });

  it("correlates typed worker requests and shuts down", async () => {
    const worker = new FakeWorker();
    const client = new SessionSearchIndexClient(() => worker);
    const initialized = await client.initialize("/tmp/index");
    expect(initialized.ok && initialized.type).toBe("initialized");

    const queried = await client.query(
      "/workspace",
      "needle",
      0,
      20,
      [],
      [],
      ["/sessions/a.jsonl"],
    );
    expect(queried.ok && queried.type).toBe("query");
    expect(worker.requests.map((request) => request.type)).toEqual(["initialize", "query"]);

    await client.stop();
    expect(worker.terminated).toBe(true);
  });

  it("performs at most one bounded worker restart", async () => {
    const workers = [new FakeWorker(), new FakeWorker(), new FakeWorker()];
    const factory = vi.fn(() => workers[factory.mock.calls.length - 1]!);
    const client = new SessionSearchIndexClient(factory);
    await client.initialize("/tmp/index");

    workers[0]!.emit("error", new Error("first crash"));
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(workers[1]!.requests.some((request) => request.type === "initialize")).toBe(true),
    );
    // Real Worker failures emit error followed by exit. The stale exit must
    // not terminate the initialized replacement.
    workers[0]!.emit("exit", 1);
    await expect(client.query("/workspace", "needle", 0, 20, [], [], [])).resolves.toMatchObject({
      ok: true,
      type: "query",
    });
    expect(workers[1]!.terminated).toBe(false);

    workers[1]!.emit("error", new Error("second crash"));
    await expect(client.query("/workspace", "needle", 0, 20, [], [], [])).rejects.toThrow(
      "second crash",
    );
    expect(factory).toHaveBeenCalledTimes(2);
    await client.stop();
  });
});
