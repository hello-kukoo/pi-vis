import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionCatalog, type SessionCatalogSettings } from "./session-catalog.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  write: (name: string, cwd: string, rest?: string[]) => Promise<string>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-catalog-"));
  directories.push(root);
  const nested = path.join(root, "nested", "deeper");
  await fs.mkdir(nested, { recursive: true });
  return {
    root,
    async write(name, cwd, rest = []) {
      const file = path.join(nested, name);
      await fs.writeFile(
        file,
        `${[
          JSON.stringify({ type: "session", version: 3, id: name, timestamp: 1, cwd }),
          ...rest,
        ].join("\n")}\n`,
      );
      return file;
    },
  };
}

describe("SessionCatalog", () => {
  it("confines nested sources and classifies direct/worktree/archive ownership deterministically", async () => {
    const { root, write } = await fixture();
    const workspaceA = "/workspace/a";
    const workspaceB = "/workspace/b";
    const worktree = "/workspace/a-feature";
    const direct = await write("z.jsonl", workspaceA, [
      JSON.stringify({ type: "session_info", name: "Zed" }),
    ]);
    const inWorktree = await write("a.jsonl", worktree);
    await write("b.jsonl", workspaceB);
    let settings: SessionCatalogSettings = {
      workspaceOrder: [workspaceA, workspaceB],
      worktrees: {
        [worktree]: { workspacePath: workspaceA, branch: "feature", name: "feature", base: "main" },
      },
      archivedSessions: [await fs.realpath(direct)],
    };
    const catalog = new SessionCatalog({ sessionsRoot: root, getSettings: () => settings });
    await catalog.refresh();
    expect(catalog.list().map((source) => path.basename(source.canonicalPath))).toEqual([
      "a.jsonl",
      "b.jsonl",
      "z.jsonl",
    ]);
    expect(catalog.sourcesForWorkspace(workspaceA).map((source) => source.canonicalPath)).toEqual([
      await fs.realpath(inWorktree),
    ]);
    expect(catalog.list().find((source) => source.sessionId === "a.jsonl")?.worktree?.name).toBe(
      "feature",
    );

    settings = { ...settings, workspaceOrder: [workspaceB] };
    expect(catalog.sourcesForWorkspace(workspaceA)).toEqual([]);
  });

  it("matches registered workspace aliases by canonical filesystem identity", async () => {
    const { root, write } = await fixture();
    const workspace = path.join(root, "workspace-real");
    const workspaceAlias = path.join(root, "workspace-alias");
    await fs.mkdir(workspace);
    await fs.symlink(workspace, workspaceAlias, "dir");
    await write("aliased.jsonl", workspace);
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [workspaceAlias] }),
    });

    await catalog.refresh();

    expect(catalog.sourcesForWorkspace(workspaceAlias)).toHaveLength(1);
    expect(catalog.sourcesForWorkspace(workspaceAlias)[0]?.workspacePath).toBe(workspaceAlias);
  });

  it("rejects bad headers and symlink escapes while retaining archive metadata", async () => {
    const { root, write } = await fixture();
    const workspace = "/workspace/a";
    const valid = await write("valid.jsonl", workspace);
    await fs.writeFile(path.join(root, "nested", "bad.jsonl"), "not json\n");
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.jsonl`);
    await fs.writeFile(
      outside,
      JSON.stringify({ type: "session", version: 3, id: "outside", timestamp: 1, cwd: workspace }),
    );
    await fs.symlink(outside, path.join(root, "nested", "escape.jsonl"));
    const canonicalValid = await fs.realpath(valid);
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [workspace], archivedSessions: [canonicalValid] }),
    });
    await catalog.refresh();
    expect(catalog.list()).toHaveLength(1);
    expect(catalog.list()[0]?.archived).toBe(true);
    expect(catalog.sourcesForWorkspace(workspace)).toEqual([]);
    await fs.rm(outside, { force: true });
  });

  it("tolerates deletion and unreadable candidates without leaking them into queries", async () => {
    const { root, write } = await fixture();
    const workspace = "/workspace/a";
    const file = await write("gone.jsonl", workspace);
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [workspace] }),
    });
    await catalog.refresh();
    await fs.rm(file);
    expect(
      await catalog.revalidate(
        await fs.realpath(root).then((value) => path.join(value, "nested", "deeper", "gone.jsonl")),
        workspace,
      ),
    ).toBeNull();
    // A directory in place of a .jsonl candidate is never a regular source.
    await fs.mkdir(path.join(root, "nested", "unreadable.jsonl"));
    await catalog.refresh();
    expect(catalog.sourcesForWorkspace(workspace)).toEqual([]);
  });

  it("retains the complete warm catalog while publishing bounded refresh batches", async () => {
    const { root, write } = await fixture();
    const workspace = "/workspace/a";
    const files: string[] = [];
    for (let index = 0; index < 34; index++) {
      files.push(await write(`warm-${String(index).padStart(2, "0")}.jsonl`, workspace));
    }
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [workspace] }),
    });
    await catalog.refresh();
    expect(catalog.sourcesForWorkspace(workspace)).toHaveLength(34);
    await fs.appendFile(
      files[1]!,
      `${JSON.stringify({ type: "message", id: "warm-append", message: { role: "user", content: "new" } })}\n`,
    );
    const appendedSize = (await fs.stat(files[1]!)).size;
    const publishedSizes: number[] = [];

    await catalog.refresh({
      priorityWorkspacePaths: [workspace],
      onDiscovered: async (sources) => {
        publishedSizes.push(sources.length);
      },
    });

    expect(publishedSizes).toEqual([]);
    expect(catalog.sourcesForWorkspace(workspace)).toHaveLength(34);
    expect(
      catalog
        .list()
        .find((source) => path.basename(source.canonicalPath) === path.basename(files[1]!))?.size,
    ).toBe(appendedSize);

    const newFile = await write("warm-new.jsonl", workspace);
    const newPublications: string[][] = [];
    await catalog.refresh({
      priorityWorkspacePaths: [workspace],
      onDiscovered: async (sources) => {
        newPublications.push(sources.map((source) => source.sessionId));
      },
    });
    expect(newPublications).toEqual([[path.basename(newFile)]]);
    expect(catalog.sourcesForWorkspace(workspace)).toHaveLength(35);

    await fs.rm(files[0]!);
    await catalog.refresh();
    expect(catalog.sourcesForWorkspace(workspace)).toHaveLength(34);
  });

  it("merges a delayed known-source delta without resurrecting a concurrent full-scan deletion", async () => {
    const { root, write } = await fixture();
    const workspace = "/workspace/a";
    const changedFile = await write("changed.jsonl", workspace);
    const deletedFile = await write("deleted.jsonl", workspace);
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [workspace] }),
    });
    await catalog.refresh();
    await fs.appendFile(
      changedFile,
      `${JSON.stringify({ type: "message", id: "changed", message: { role: "user", content: "delta" } })}\n`,
    );
    const inspectedCatalog = catalog as unknown as {
      inspect(candidate: string): Promise<unknown>;
    };
    const originalInspect = inspectedCatalog.inspect.bind(catalog);
    let releaseKnown!: () => void;
    const knownGate = new Promise<void>((resolve) => {
      releaseKnown = resolve;
    });
    let markKnownEntered!: () => void;
    const knownEntered = new Promise<void>((resolve) => {
      markKnownEntered = resolve;
    });
    let blocked = false;
    const inspectSpy = vi
      .spyOn(inspectedCatalog, "inspect")
      .mockImplementation(async (candidate: string) => {
        if (!blocked && path.basename(candidate) === path.basename(changedFile)) {
          blocked = true;
          markKnownEntered();
          await knownGate;
        }
        return originalInspect(candidate);
      });

    const knownRefresh = catalog.refreshKnownChanges();
    await knownEntered;
    await fs.rm(deletedFile);
    await catalog.refresh();
    releaseKnown();
    await knownRefresh;
    inspectSpy.mockRestore();

    expect(catalog.list().map((source) => source.sessionId)).toEqual(["changed.jsonl"]);
  });

  it("does not let a delayed known-source inspection resurrect its own full-scan tombstone", async () => {
    const { root, write } = await fixture();
    const workspace = "/workspace/a";
    const file = await write("same-path.jsonl", workspace);
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [workspace] }),
    });
    await catalog.refresh();
    await fs.appendFile(
      file,
      `${JSON.stringify({ type: "message", id: "new", message: { role: "user", content: "new" } })}\n`,
    );
    const inspectedCatalog = catalog as unknown as {
      inspect(candidate: string): Promise<unknown>;
    };
    const originalInspect = inspectedCatalog.inspect.bind(catalog);
    let releaseKnown!: () => void;
    const knownGate = new Promise<void>((resolve) => {
      releaseKnown = resolve;
    });
    let markKnownInspected!: () => void;
    const knownInspected = new Promise<void>((resolve) => {
      markKnownInspected = resolve;
    });
    let blocked = false;
    const inspectSpy = vi
      .spyOn(inspectedCatalog, "inspect")
      .mockImplementation(async (candidate: string) => {
        const result = await originalInspect(candidate);
        if (!blocked && path.basename(candidate) === path.basename(file)) {
          blocked = true;
          markKnownInspected();
          await knownGate;
        }
        return result;
      });

    const knownRefresh = catalog.refreshKnownChanges();
    await knownInspected;
    await fs.rm(file);
    await catalog.refresh();
    expect(catalog.list()).toEqual([]);
    releaseKnown();
    await knownRefresh;
    inspectSpy.mockRestore();

    expect(catalog.list()).toEqual([]);
  });

  it("reprioritizes an in-flight cold traversal when search starts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-catalog-live-priority-"));
    directories.push(root);
    const requestedWorkspace = path.join(root, "workspaces", "focus-project");
    await fs.mkdir(requestedWorkspace, { recursive: true });
    for (let index = 0; index < 20; index++) {
      const directory = path.join(root, `unrelated-${String(index).padStart(2, "0")}`);
      await fs.mkdir(directory);
      await fs.writeFile(
        path.join(directory, "session.jsonl"),
        `${JSON.stringify({ type: "session", version: 3, id: `other-${index}`, timestamp: 1, cwd: `/other/${index}` })}\n`,
      );
    }
    const priorityDirectory = path.join(root, "focus-project-sessions");
    await fs.mkdir(priorityDirectory);
    await fs.writeFile(
      path.join(priorityDirectory, "focus.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "focus-live", timestamp: 1, cwd: requestedWorkspace })}\n`,
    );
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [requestedWorkspace] }),
    });
    const published: string[][] = [];

    await catalog.refresh({
      onDiscovered: async (sources) => {
        published.push(sources.map((source) => source.sessionId));
        if (published.length === 1) catalog.prioritize(requestedWorkspace);
      },
    });

    expect(published[1]).toContain("focus-live");
    expect(catalog.list()).toHaveLength(21);
  });

  it("publishes a requested workspace before completing a large cold directory walk", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-catalog-priority-"));
    directories.push(root);
    const requestedWorkspace = path.join(root, "workspaces", "focus-project");
    await fs.mkdir(requestedWorkspace, { recursive: true });
    for (let index = 0; index < 40; index++) {
      const directory = path.join(root, `unrelated-${String(index).padStart(2, "0")}`);
      await fs.mkdir(directory);
      await fs.writeFile(
        path.join(directory, "session.jsonl"),
        `${JSON.stringify({ type: "session", version: 3, id: `other-${index}`, timestamp: 1, cwd: `/other/${index}` })}\n`,
      );
    }
    const priorityDirectory = path.join(root, "focus-project-sessions");
    await fs.mkdir(priorityDirectory);
    await fs.writeFile(
      path.join(priorityDirectory, "focus.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "focus", timestamp: 1, cwd: requestedWorkspace })}\n`,
    );
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [requestedWorkspace] }),
    });
    const published: Array<readonly string[]> = [];

    await catalog.refresh({
      priorityWorkspacePaths: [requestedWorkspace],
      onDiscovered: async (sources) => {
        published.push(sources.map((source) => source.sessionId));
      },
    });

    expect(published[0]).toContain("focus");
    expect(catalog.list()).toHaveLength(41);
  });

  it("visits a priority subtree discovered beneath an ordinary ancestor", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-catalog-nested-priority-"));
    directories.push(root);
    const requestedWorkspace = path.join(root, "workspaces", "focus-project");
    const nestedPriority = path.join(root, "neutral", "focus-project-sessions");
    await fs.mkdir(requestedWorkspace, { recursive: true });
    await fs.mkdir(nestedPriority, { recursive: true });
    await fs.writeFile(
      path.join(nestedPriority, "focus.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "nested-focus", timestamp: 1, cwd: requestedWorkspace })}\n`,
    );
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [requestedWorkspace] }),
    });

    await catalog.refresh({ priorityWorkspacePaths: [requestedWorkspace] });

    expect(
      catalog.sourcesForWorkspace(requestedWorkspace).map((source) => source.sessionId),
    ).toEqual(["nested-focus"]);
  });

  it("reaps stale crashed-process runtime pins but preserves live-owner pins", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-catalog-pins-"));
    directories.push(root);
    let staleOwner = Math.max(100_000, process.pid + 10_000);
    while (true) {
      try {
        process.kill(staleOwner, 0);
        staleOwner += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
        staleOwner += 1;
      }
    }
    const stale = path.join(root, `.pivis-session-${staleOwner}-dead-beef.runtime-pin`);
    const live = path.join(root, `.pivis-session-${process.pid}-cafe-beef.runtime-pin`);
    await fs.writeFile(stale, "stale");
    await fs.writeFile(live, "live");
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [] }),
    });

    await catalog.refresh();

    await expect(fs.stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(live)).resolves.toBeDefined();
  });

  it("detects completed appends through the bounded known-source fast path", async () => {
    const { root, write } = await fixture();
    const workspace = "/workspace/a";
    const file = await write("append.jsonl", workspace);
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: [workspace] }),
    });
    const [before] = await catalog.refresh();
    await fs.appendFile(
      file,
      `${JSON.stringify({ type: "message", id: "appended", message: { role: "user", content: "fresh" } })}\n`,
    );

    const refreshed = await catalog.refreshKnownChanges();

    expect(refreshed.changed).toBe(true);
    expect(refreshed.sources[0]?.size).toBeGreaterThan(before?.size ?? 0);
  });

  it.skipIf(process.platform === "win32")(
    "reports traversal failures as incomplete coverage",
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-catalog-denied-"));
      directories.push(root);
      const denied = path.join(root, "denied");
      await fs.mkdir(denied);
      await fs.writeFile(
        path.join(denied, "hidden.jsonl"),
        `${JSON.stringify({ type: "session", version: 3, id: "hidden", timestamp: 1, cwd: "/workspace/a" })}\n`,
      );
      await fs.chmod(denied, 0);
      try {
        const catalog = new SessionCatalog({
          sessionsRoot: root,
          getSettings: () => ({ workspaceOrder: ["/workspace/a"] }),
        });
        await catalog.refresh();
        expect(catalog.coverage().skippedSources).toBeGreaterThan(0);
      } finally {
        await fs.chmod(denied, 0o700);
      }
    },
  );

  it("records high-resolution revision identity and prefix fingerprint", async () => {
    const { root, write } = await fixture();
    await write("source.jsonl", "/workspace/a");
    const catalog = new SessionCatalog({
      sessionsRoot: root,
      getSettings: () => ({ workspaceOrder: ["/workspace/a"] }),
    });
    const [source] = await catalog.refresh();
    expect(source?.prefixFingerprint).toHaveLength(createHash("sha256").digest("hex").length);
    expect(source?.sourceRevision).toContain(source?.prefixFingerprint ?? "");
    expect(source?.mtimeMs).toBeGreaterThan(0);
  });
});
