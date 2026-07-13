import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_SEARCH_SCHEMA_SQL } from "./index-schema.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: typeof import("node:sqlite").DatabaseSync;
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("session search SQLite schema", () => {
  it("creates an FTS5 content index with cascade cleanup", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pivis-search-schema-"));
    roots.push(root);
    const db: DatabaseSyncType = new DatabaseSync(path.join(root, "index.sqlite"));
    db.exec(SESSION_SEARCH_SCHEMA_SQL);
    db.prepare(
      `INSERT INTO sources(canonical_path, session_id, workspace_path, archived,
        session_name, size, mtime_ms, prefix_fingerprint, source_revision)
       VALUES (?, ?, ?, 0, ?, 1, 1, ?, ?)`,
    ).run("/sessions/a.jsonl", "session-a", "/workspace", "Alpha", "hash", "rev");
    db.prepare(
      `INSERT INTO entries(source_key, entry_ordinal, entry_id, byte_start, byte_end)
       VALUES (1, 0, 'entry-a', 0, 10)`,
    ).run();
    db.prepare(
      `INSERT INTO segments(source_key, entry_ordinal, entry_id, content_part_key,
        occurrence, role, original_text, normalized_text, derived_text, content_digest)
       VALUES (1, 0, 'entry-a', 'text:0', 0, 'user', 'Lifecycle check',
        'lifecycle check', 'life cycle check', 'digest')`,
    ).run();
    expect(
      db
        .prepare("SELECT count(*) AS count FROM segments_fts WHERE segments_fts MATCH ?")
        .get("lifecycle"),
    ).toMatchObject({ count: 1 });
    db.prepare("DELETE FROM sources WHERE source_key = 1").run();
    expect(db.prepare("SELECT count(*) AS count FROM segments").get()).toMatchObject({ count: 0 });
    db.close();
  });
});
