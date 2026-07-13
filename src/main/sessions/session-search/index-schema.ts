export const SESSION_SEARCH_SCHEMA_VERSION = 3;

export const SESSION_SEARCH_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  source_key INTEGER PRIMARY KEY,
  canonical_path TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  worktree_name TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  session_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  device INTEGER,
  inode INTEGER,
  prefix_fingerprint TEXT NOT NULL,
  committed_offset INTEGER NOT NULL DEFAULT 0,
  committed_ordinal INTEGER NOT NULL DEFAULT 0,
  committed_tail_hash TEXT NOT NULL DEFAULT '',
  source_generation INTEGER NOT NULL DEFAULT 1,
  health TEXT NOT NULL DEFAULT 'indexed',
  source_revision TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sources_workspace_idx
  ON sources(workspace_path, archived, health);

CREATE TABLE IF NOT EXISTS entries (
  source_key INTEGER NOT NULL REFERENCES sources(source_key) ON DELETE CASCADE,
  entry_ordinal INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  parent_id TEXT,
  timestamp_ms REAL,
  byte_start INTEGER NOT NULL,
  byte_end INTEGER NOT NULL,
  latest_persisted_path INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(source_key, entry_ordinal)
);
CREATE UNIQUE INDEX IF NOT EXISTS entries_identity_idx
  ON entries(source_key, entry_id);
CREATE INDEX IF NOT EXISTS entries_parent_idx
  ON entries(source_key, parent_id);

CREATE TABLE IF NOT EXISTS segments (
  segment_id INTEGER PRIMARY KEY,
  source_key INTEGER NOT NULL REFERENCES sources(source_key) ON DELETE CASCADE,
  entry_ordinal INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  content_part_key TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  role TEXT NOT NULL,
  timestamp_ms REAL,
  original_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  derived_text TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  FOREIGN KEY(source_key, entry_ordinal)
    REFERENCES entries(source_key, entry_ordinal) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS segments_source_idx
  ON segments(source_key, entry_ordinal);

CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  normalized_text,
  derived_text,
  content='segments',
  content_rowid='segment_id',
  tokenize='unicode61 remove_diacritics 0'
);
CREATE VIRTUAL TABLE IF NOT EXISTS segments_vocab USING fts5vocab(segments_fts, 'row');
CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, normalized_text, derived_text)
  VALUES (new.segment_id, new.normalized_text, new.derived_text);
END;
CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, normalized_text, derived_text)
  VALUES ('delete', old.segment_id, old.normalized_text, old.derived_text);
END;
CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, normalized_text, derived_text)
  VALUES ('delete', old.segment_id, old.normalized_text, old.derived_text);
  INSERT INTO segments_fts(rowid, normalized_text, derived_text)
  VALUES (new.segment_id, new.normalized_text, new.derived_text);
END;
`;
