DROP INDEX IF EXISTS idx_forum_research_state_thread_id;
ALTER TABLE forum_research_state RENAME TO forum_research_state_legacy_v1;

CREATE TABLE forum_research_state (
  session_identity TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  last_message_id TEXT NOT NULL,
  evidence_items_json TEXT NOT NULL,
  source_catalog_json TEXT NOT NULL,
  distinct_sources_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_forum_research_state_thread_id
  ON forum_research_state(thread_id);

INSERT INTO forum_research_state (
  session_identity,
  thread_id,
  last_message_id,
  evidence_items_json,
  source_catalog_json,
  distinct_sources_json,
  created_at,
  updated_at
)
SELECT
  session_identity,
  thread_id,
  last_message_id,
  CASE
    WHEN COALESCE(
      json_extract(source_catalog_json, '$[0].url'),
      json_extract(distinct_sources_json, '$[0]')
    ) IS NOT NULL THEN json_array(json_object(
      'claim',
      COALESCE(NULLIF(planner_brief, ''), 'Legacy forum research progress'),
      'source_urls',
      json_array(COALESCE(
        json_extract(source_catalog_json, '$[0].url'),
        json_extract(distinct_sources_json, '$[0]')
      ))
    ))
    ELSE json_array()
  END,
  CASE
    WHEN COALESCE(
      json_extract(source_catalog_json, '$[0].url'),
      json_extract(distinct_sources_json, '$[0]')
    ) IS NOT NULL THEN json_array(json_object(
      'index',
      1,
      'url',
      COALESCE(
        json_extract(source_catalog_json, '$[0].url'),
        json_extract(distinct_sources_json, '$[0]')
      ),
      'claims',
      json_array(COALESCE(NULLIF(planner_brief, ''), 'Legacy forum research progress'))
    ))
    ELSE json_array()
  END,
  CASE
    WHEN json_array_length(distinct_sources_json) > 0 THEN distinct_sources_json
    WHEN json_extract(source_catalog_json, '$[0].url') IS NOT NULL THEN
      json_array(json_extract(source_catalog_json, '$[0].url'))
    ELSE json_array()
  END,
  created_at,
  updated_at
FROM forum_research_state_legacy_v1;

DROP TABLE forum_research_state_legacy_v1;
