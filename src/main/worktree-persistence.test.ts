import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSessionsForWorkspace } from "./sessions/session-discovery.js";
import { getSettings, loadSettings, saveSettings } from "./settings-store.js";
import {
  persistRecoverableWorktree,
  respawnAndPersistWorkspace,
  respawnAndPersistWorktree,
} from "./worktree-persistence.js";

let dir: string;
let sessionsDir: string;
let settingsEnvBackup: string | undefined;
let sessionsEnvBackup: string | undefined;

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function writePersistedSession(fileName: string, id: string, cwd: string): string {
  const sessionDir = path.join(sessionsDir, "saved");
  fs.mkdirSync(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, fileName);
  const lines = [
    {
      type: "session",
      version: 3,
      id,
      timestamp: "2026-07-12T00:00:00Z",
      cwd,
    },
    {
      id: `${id}-message`,
      parentId: id,
      timestamp: "2026-07-12T00:00:01Z",
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: `prompt for ${id}` }],
        timestamp: 1_783_814_401_000,
      },
    },
  ];
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return filePath;
}

beforeEach(() => {
  settingsEnvBackup = process.env["PIVIS_SETTINGS_DIR"];
  sessionsEnvBackup = process.env["PIVIS_SESSIONS_DIR"];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pivis-worktree-persistence-"));
  sessionsDir = path.join(dir, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  process.env["PIVIS_SETTINGS_DIR"] = dir;
  process.env["PIVIS_SESSIONS_DIR"] = sessionsDir;
  loadSettings();
});

afterEach(() => {
  if (settingsEnvBackup === undefined) delete process.env["PIVIS_SETTINGS_DIR"];
  else process.env["PIVIS_SETTINGS_DIR"] = settingsEnvBackup;
  if (sessionsEnvBackup === undefined) delete process.env["PIVIS_SESSIONS_DIR"];
  else process.env["PIVIS_SESSIONS_DIR"] = sessionsEnvBackup;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("respawnAndPersistWorktree", () => {
  it.each(["first", "second"] as const)(
    "retains both discoverable sessions when the %s respawn settles last",
    async (lastToSettle) => {
      const workspacePath = path.join(dir, "repo");
      const firstPath = path.join(dir, "worktrees", "first");
      const secondPath = path.join(dir, "worktrees", "second");
      fs.mkdirSync(workspacePath, { recursive: true });
      fs.mkdirSync(firstPath, { recursive: true });
      fs.mkdirSync(secondPath, { recursive: true });

      const firstRespawn = deferred();
      const secondRespawn = deferred();
      const firstSessionFile = path.join(sessionsDir, "saved", "first.jsonl");
      const secondSessionFile = path.join(sessionsDir, "saved", "second.jsonl");
      const firstAssociation = {
        workspacePath,
        branch: "pi-vis-first",
        name: "first",
        base: "main",
      };
      const secondAssociation = {
        workspacePath,
        branch: "feature/second",
        name: "second",
        base: "feature/second",
      };

      const first = respawnAndPersistWorktree({
        worktreePath: firstPath,
        association: firstAssociation,
        sessionFile: firstSessionFile,
        respawn: () => firstRespawn.promise,
      });
      const second = respawnAndPersistWorktree({
        worktreePath: secondPath,
        association: secondAssociation,
        sessionFile: secondSessionFile,
        respawn: () => secondRespawn.promise,
      });

      expect(getSettings().worktrees).toEqual({});

      if (lastToSettle === "first") {
        secondRespawn.resolve();
        await second;
        firstRespawn.resolve();
        await first;
      } else {
        firstRespawn.resolve();
        await first;
        secondRespawn.resolve();
        await second;
      }

      // Reload from disk to model the next app launch, not just the in-memory map.
      const persisted = loadSettings();
      expect(persisted.worktrees).toEqual({
        [firstPath]: firstAssociation,
        [secondPath]: secondAssociation,
      });
      expect(persisted.sessionWorktrees).toEqual({
        [path.resolve(firstSessionFile)]: firstPath,
        [path.resolve(secondSessionFile)]: secondPath,
      });

      const firstFile = writePersistedSession("first.jsonl", "first-session", firstPath);
      const secondFile = writePersistedSession("second.jsonl", "second-session", secondPath);
      const discovered = await listSessionsForWorkspace(workspacePath);

      expect(discovered.map((session) => session.filePath).sort()).toEqual(
        [firstFile, secondFile].sort(),
      );
      expect(discovered.every((session) => session.messageCount === 1)).toBe(true);
    },
  );

  it("records a recoverable worktree without moving a session override", async () => {
    saveSettings({
      sessionWorktrees: { [path.resolve("/sessions/current.jsonl")]: "/worktrees/old" },
    });

    await expect(
      persistRecoverableWorktree({
        worktreePath: "/worktrees/recovery",
        association: {
          workspacePath: "/repos/workspace",
          branch: "pi-vis-recovery",
          name: "recovery",
          base: "main",
        },
      }),
    ).resolves.toEqual({ persisted: true });

    expect(loadSettings()).toMatchObject({
      worktrees: {
        "/worktrees/recovery": {
          workspacePath: "/repos/workspace",
          branch: "pi-vis-recovery",
          name: "recovery",
          base: "main",
        },
      },
      sessionWorktrees: { [path.resolve("/sessions/current.jsonl")]: "/worktrees/old" },
    });
  });

  it("persists an explicit Workspace override when returning", async () => {
    const sessionFile = "/sessions/returning.jsonl";
    saveSettings({
      worktrees: {
        "/worktrees/shared": {
          workspacePath: "/repos/workspace",
          branch: "feature/shared",
          name: "shared",
          base: "main",
        },
      },
      sessionWorktrees: {
        [path.resolve(sessionFile)]: "/worktrees/shared",
        [path.resolve("/sessions/other.jsonl")]: "/worktrees/shared",
      },
    });

    await expect(
      respawnAndPersistWorkspace({
        sessionFile,
        workspacePath: "/repos/workspace",
        respawn: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ persisted: true });

    expect(loadSettings()).toMatchObject({
      worktrees: {
        "/worktrees/shared": {
          workspacePath: "/repos/workspace",
          branch: "feature/shared",
          name: "shared",
          base: "main",
        },
      },
      sessionWorktrees: {
        [path.resolve(sessionFile)]: path.resolve("/repos/workspace"),
        [path.resolve("/sessions/other.jsonl")]: "/worktrees/shared",
      },
    });
  });

  it("reports persistence failure without turning a completed respawn into switch failure", async () => {
    const blockedSettingsDir = path.join(dir, "settings-blocker");
    fs.writeFileSync(blockedSettingsDir, "not a directory");
    process.env["PIVIS_SETTINGS_DIR"] = blockedSettingsDir;

    const result = await respawnAndPersistWorktree({
      worktreePath: "/worktrees/moved",
      association: {
        workspacePath: "/repos/workspace",
        branch: "pi-vis-moved",
        name: "moved",
        base: "main",
      },
      sessionFile: "/sessions/moved.jsonl",
      respawn: () => Promise.resolve(),
    });

    expect(result.persisted).toBe(false);
    if (!result.persisted) expect(result.error).toMatch(/not a directory|ENOTDIR/i);
  });

  it("does not persist an association when respawn fails", async () => {
    saveSettings({
      worktrees: {
        "/worktrees/existing": {
          workspacePath: "/repos/existing",
          branch: "existing",
          name: "existing",
          base: "main",
        },
      },
      sessionWorktrees: {
        [path.resolve("/sessions/existing.jsonl")]: "/worktrees/existing",
      },
    });

    await expect(
      respawnAndPersistWorktree({
        worktreePath: "/worktrees/failed",
        association: {
          workspacePath: "/repos/failed",
          branch: "failed",
          name: "failed",
          base: "main",
        },
        sessionFile: "/sessions/failed.jsonl",
        respawn: () => Promise.reject(new Error("replacement host failed")),
      }),
    ).rejects.toThrow("replacement host failed");

    const persisted = loadSettings();
    expect(persisted.worktrees).toEqual({
      "/worktrees/existing": {
        workspacePath: "/repos/existing",
        branch: "existing",
        name: "existing",
        base: "main",
      },
    });
    expect(persisted.sessionWorktrees).toEqual({
      [path.resolve("/sessions/existing.jsonl")]: "/worktrees/existing",
    });
  });
});
