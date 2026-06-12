import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { extractSessionMeta, listSessionsForWorkspace } from "./session-discovery.js";

let root: string;
let envBackup: string | undefined;

beforeEach(() => {
  envBackup = process.env["PIVIS_SESSIONS_DIR"];
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pivis-discovery-"));
  process.env["PIVIS_SESSIONS_DIR"] = root;
  fs.mkdirSync(path.join(root, "workspace-A"), { recursive: true });
});

afterEach(() => {
  if (envBackup === undefined) {
    delete process.env["PIVIS_SESSIONS_DIR"];
  } else {
    process.env["PIVIS_SESSIONS_DIR"] = envBackup;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function writeSession(workspace: string, fileName: string, lines: object[]): string {
  const dir = path.join(root, workspace);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return filePath;
}

describe("listSessionsForWorkspace", () => {
  it("returns the last session_info name in file order", async () => {
    const cwd = path.join(root, "workspace-A");
    const filePath = writeSession("workspace-A", "session1.jsonl", [
      { type: "session", version: 3, id: "abc", timestamp: "2024-01-01T00:00:00Z", cwd },
      { id: "e1", type: "message", role: "user", content: [{ type: "text", text: "hello" }] },
      { id: "e2", type: "session_info", name: "First" },
      { id: "e3", type: "session_info", name: "Second" },
    ]);

    const summaries = await listSessionsForWorkspace(cwd);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.name).toBe("Second");
    expect(summaries[0]?.preview).toBe("hello");
    expect(summaries[0]?.messageCount).toBe(1);
    expect(summaries[0]?.filePath).toBe(filePath);
  });

  it("returns no name when the file has no session_info entries", async () => {
    const cwd = path.join(root, "workspace-A");
    writeSession("workspace-A", "session1.jsonl", [
      { type: "session", version: 3, id: "abc", timestamp: "2024-01-01T00:00:00Z", cwd },
      { id: "e1", type: "message", role: "user", content: [{ type: "text", text: "hi" }] },
    ]);

    const summaries = await listSessionsForWorkspace(cwd);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.name).toBeUndefined();
  });

  it("invalidates the cache when the file is rewritten with a new name", async () => {
    const cwd = path.join(root, "workspace-A");
    const filePath = writeSession("workspace-A", "session1.jsonl", [
      { type: "session", version: 3, id: "abc", timestamp: "2024-01-01T00:00:00Z", cwd },
      { id: "e1", type: "message", role: "user", content: [{ type: "text", text: "hi" }] },
      { id: "e2", type: "session_info", name: "Initial" },
    ]);

    const first = await listSessionsForWorkspace(cwd);
    expect(first[0]?.name).toBe("Initial");

    // Append a new session_info entry and bump mtime so the cache invalidates.
    fs.appendFileSync(filePath, JSON.stringify({ id: "e3", type: "session_info", name: "Third" }) + "\n");
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(filePath, future, future);

    const second = await listSessionsForWorkspace(cwd);
    expect(second[0]?.name).toBe("Third");
  });

  it("does not return sessions whose header cwd differs from the queried workspace", async () => {
    const otherCwd = path.join(root, "workspace-B");
    fs.mkdirSync(path.join(root, "workspace-B"), { recursive: true });
    writeSession("workspace-B", "session1.jsonl", [
      { type: "session", version: 3, id: "abc", timestamp: "2024-01-01T00:00:00Z", cwd: otherCwd },
      { id: "e1", type: "message", role: "user", content: [{ type: "text", text: "nope" }] },
      { id: "e2", type: "session_info", name: "Other" },
    ]);

    const summaries = await listSessionsForWorkspace(path.join(root, "workspace-A"));
    expect(summaries).toHaveLength(0);
  });

  it("extractSessionMeta ignores empty-string session_info names", () => {
    const cwd = path.join(root, "workspace-A");
    const filePath = writeSession("workspace-A", "session1.jsonl", [
      { type: "session", version: 3, id: "abc", timestamp: "2024-01-01T00:00:00Z", cwd },
      { id: "e1", type: "message", role: "user", content: [{ type: "text", text: "hi" }] },
      { id: "e2", type: "session_info", name: "First" },
      { id: "e3", type: "session_info", name: "" },
    ]);

    const meta = extractSessionMeta(filePath);
    expect(meta.name).toBe("First");
    expect(meta.preview).toBe("hi");
    expect(meta.messageCount).toBe(1);
  });
});
