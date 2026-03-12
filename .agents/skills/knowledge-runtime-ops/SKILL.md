---
name: knowledge-runtime-ops
description: Operate shared knowledge DB reads and DB write handoff for VRC-AI-Bot without reading implementation code. Use whenever you need to search shared knowledge, inspect one knowledge source, or save external public information by returning runtime contract fields such as knowledge_ingest and knowledge_writes.
---

# Knowledge Runtime Ops

Use this skill when you need shared knowledge from the bot runtime and the current turn did not already include enough source context.

This skill gives you two read-only scripts:

- `search-knowledge.ts`: search shared knowledge visible from the current guild/place/scope
- `get-knowledge-source.ts`: inspect one source in detail, including hydrated text and artifact URLs

Both scripts are read-only. Do not write to the DB directly.

## When to use this skill

Use this skill when any of the following is true:

- You want to answer from previously shared knowledge, not just from the current message
- You need to recover a previously shared URL or title
- You need the normalized text or artifact URL for one source before answering
- You want to save new knowledge and need to remember the runtime handoff format instead of inventing it

Do not use this skill for Discord routing or Discord side effects. Those belong to the runtime system and the Discord harness skill.

## Inputs you need before running a script

You need the current visibility facts:

- `guild_id`
- `root_channel_id`
- `place_id`
- `scope`

Interpret them exactly as the runtime provided them. Do not broaden scope.

You can get them from the current turn's runtime facts. If the turn already included the facts, use those directly. If the turn did not include them, use the Discord harness skill's facts route first and come back with the resolved values.

## Read-only search

Run this from the repo root:

```bash
node --import tsx .agents/skills/knowledge-runtime-ops/scripts/search-knowledge.ts \
  --guild-id <guild_id> \
  --root-channel-id <root_channel_id> \
  --place-id <place_id> \
  --scope <server_public|channel_family|conversation_only> \
  --query "<natural-language query or exact URL>"
```

Optional flags:

- `--limit <n>`: default `10`
- `--db-path <path>`: override the DB path when you know it explicitly. If omitted, the script uses `BOT_DB_PATH` and then `<repo>/bot.sqlite`.

The script prints JSON to stdout:

```json
{
  "query": "harness engineering",
  "context": {
    "guildId": "123",
    "rootChannelId": "456",
    "placeId": "456",
    "scope": "server_public"
  },
  "count": 1,
  "results": [
    {
      "sourceId": "kr_...",
      "title": "Harness Engineering",
      "summary": "....",
      "tags": ["openai", "harness"],
      "scope": "server_public",
      "recency": "2026-03-12T00:00:00.000Z",
      "canonicalUrl": "https://openai.com/index/harness-engineering/"
    }
  ]
}
```

How to use the result:

- If the right source is already obvious, answer directly from the candidate metadata when that is sufficient.
- If you need the full shared text, artifact URL, or want to confirm one exact source, run `get-knowledge-source.ts` with the chosen `sourceId`.
- If there are several plausible sources, prefer the ones whose title, summary, tags, and canonical URL best match the user's request.

## Inspect one source

Run this from the repo root:

```bash
node --import tsx .agents/skills/knowledge-runtime-ops/scripts/get-knowledge-source.ts \
  --guild-id <guild_id> \
  --root-channel-id <root_channel_id> \
  --place-id <place_id> \
  --scope <server_public|channel_family|conversation_only> \
  --source-id <source_id>
```

Optional flag:

- `--db-path <path>`

The script prints JSON to stdout:

```json
{
  "context": {
    "guildId": "123",
    "rootChannelId": "456",
    "placeId": "456",
    "scope": "server_public"
  },
  "source": {
    "sourceId": "kr_...",
    "title": "Harness Engineering",
    "summary": "....",
    "tags": ["openai", "harness"],
    "scope": "server_public",
    "recency": "2026-03-12T00:00:00.000Z",
    "canonicalUrl": "https://openai.com/index/harness-engineering/",
    "normalizedText": "...",
    "sourceKind": "shared_summary",
    "artifact": {
      "record_id": "kr_...",
      "final_url": "https://openai.com/index/harness-engineering/",
      "snapshot_path": "...",
      "screenshot_path": null,
      "network_log_path": null
    }
  }
}
```

How to use the result:

- Prefer `canonicalUrl` when the user asked for the link.
- Use `normalizedText` when the user asked for explanation, translation, or deep follow-up.
- Use `artifact.final_url` if you need the final fetched URL after redirects.

## Save handoff

When you want the runtime to save knowledge, do not write to SQLite and do not call the read-only scripts for writes.

Instead, return the normal runtime response with:

- `outcome: "knowledge_ingest"`
- `public_text`: the shareable response to post in Discord
- `reply_mode`: whatever the runtime facts require for the current place
- `knowledge_writes`: one item per source to persist

Each `knowledge_writes` item should carry the source you want persisted:

```json
{
  "source_url": "https://example.com/article",
  "canonical_url": "https://example.com/article",
  "title": "Article title",
  "summary": "Japanese summary suitable for shared knowledge",
  "tags": ["topic-a", "topic-b"],
  "content_hash": null,
  "normalized_text": "Readable normalized body text or long-form summary",
  "source_kind": "external_public_web"
}
```

Guidance:

- `knowledge_writes` is advisory handoff to the runtime. The runtime owns canonicalization, dedupe, scope enforcement, and DB writes.
- If you are saving multiple researched sources, include one item per source.
- If you can answer successfully but some save fields are incomplete, still answer. Saving is advisory.
- Never claim that you performed the DB write yourself. The system executes persistence.

## Golden path

1. Read the current runtime facts and keep the provided visibility boundary.
2. Search shared knowledge with a natural-language query or exact URL.
3. Inspect one source only if metadata is not enough.
4. Answer from the retrieved source.
5. If the user explicitly wants new knowledge stored, return `knowledge_ingest` plus `knowledge_writes` instead of trying to write the DB yourself.

## Examples

### Recover a previously shared URL

User intent: "前に知見共有されていたハーネスエンジニアリングのリンクを出して"

1. Search:

```bash
node --import tsx .agents/skills/knowledge-runtime-ops/scripts/search-knowledge.ts \
  --guild-id 123 \
  --root-channel-id 456 \
  --place-id 456 \
  --scope server_public \
  --query "ハーネスエンジニアリング"
```

2. If the result includes `https://openai.com/index/harness-engineering/`, answer with that URL.

### Inspect one knowledge source before summarizing

1. Search for the topic.
2. Pick the best `sourceId`.
3. Run:

```bash
node --import tsx .agents/skills/knowledge-runtime-ops/scripts/get-knowledge-source.ts \
  --guild-id 123 \
  --root-channel-id 456 \
  --place-id 456 \
  --scope server_public \
  --source-id kr_abc123
```

4. Use `normalizedText` and `canonicalUrl` in the final answer.

### Save new external public knowledge

If the user says "この記事を知見として残して" or "このテーマを調べて共有知見として保存して", do not write SQLite directly. Return `knowledge_ingest` and populate `knowledge_writes`.
