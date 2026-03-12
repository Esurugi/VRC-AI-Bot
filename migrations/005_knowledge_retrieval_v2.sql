DROP TABLE IF EXISTS source_link;
DROP TABLE IF EXISTS knowledge_artifact;
DROP TABLE IF EXISTS knowledge_source_text;
DROP TABLE IF EXISTS knowledge_record_fts;
DROP TABLE IF EXISTS knowledge_record;

CREATE TABLE IF NOT EXISTS knowledge_record (
  record_id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  scope TEXT NOT NULL,
  visibility_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_record_dedupe
ON knowledge_record (canonical_url, content_hash, scope, visibility_key);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_record_fts
USING fts5(
  record_id UNINDEXED,
  canonical_url,
  domain,
  title,
  summary,
  tags,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS knowledge_artifact (
  record_id TEXT PRIMARY KEY,
  final_url TEXT NOT NULL,
  snapshot_path TEXT NOT NULL,
  screenshot_path TEXT,
  network_log_path TEXT,
  FOREIGN KEY (record_id) REFERENCES knowledge_record(record_id)
);

CREATE TABLE IF NOT EXISTS knowledge_source_text (
  record_id TEXT PRIMARY KEY,
  normalized_text TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES knowledge_record(record_id)
);

CREATE TABLE IF NOT EXISTS source_link (
  link_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  reply_thread_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (record_id) REFERENCES knowledge_record(record_id)
);
