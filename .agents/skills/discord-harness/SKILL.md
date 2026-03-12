---
name: discord-harness
description: Operational contract for Discord runtime facts in VRC-AI-Bot. Use whenever you are handling Discord-originated messages, deciding how to interpret place/thread/guild context, or need more Discord facts from repo-local runtime artifacts without searching Discord docs or the codebase. Prefer this skill every time Discord runtime behavior, reply routing, thread lineage, admin_control, URL ingest, knowledge thread follow-up, or guild/channel state is relevant.
---

# Discord Harness

Use this skill as the runtime contract for Discord facts in this repository. It is not a Discord API guide and it is not a prompt for searching the codebase. The point is to let you operate from the authoritative facts already injected by System, and to pull any extra Discord facts from repo-local runtime artifacts when needed.

## Operating model
- Treat the request payload as the primary authority.
- Treat repo-local facts files as the only on-demand source for extra Discord runtime facts.
- Do not assume MCP.
- Do not browse Discord docs or grep the repository just to rediscover runtime behavior that this skill already defines.

## What is already authoritative
These fields are System-owned facts. Use them directly when present.
- `place`: guild, channel, root channel, thread, place mode, place type, scope.
- `message`: message id, content, URLs, timestamp.
- `actor`: user id and role.
- `capabilities`: turn-local policy gates such as `allow_external_fetch`, `allow_knowledge_write`, `allow_moderation`.
- `override_context`: whether the current place is an active override context and whether the actor matches it.
- `available_context.thread_context`: whether this is a root channel, knowledge thread, or plain thread; the reply thread id; known source URLs; root channel id.
- `available_context.fetchable_public_urls`: already-approved direct public URLs from the current message.
- `available_context.blocked_urls`: visible but never fetchable URLs.

- `available_context.discord_runtime_facts_path`: optional path to a repo-local JSON facts artifact for deeper Discord inspection.

If the information you need is already in those fields, do not run any script.

## Boundary: System vs LLM
System owns:
- Discord side effects: sending messages, creating threads, archiving threads, adding reactions, mutating guild state.
- Authority facts: place, scope, reply target rules, capabilities, override gating, blocked URL policy.
- Persistence integrity and database writes.
- The existence and file path of runtime artifacts.

You own:
- Interpretation of user intent.
- Deciding whether the turn is chat, knowledge ingest, admin diagnostics, ignore, or failure.
- Deciding whether extra Discord facts are needed for interpretation.
- Wording, summarization, translation, and source selection.

Never talk as if you already executed a Discord side effect yourself. System executes side effects.

## When to use the scripts
Use a script only when both are true:
1. `available_context.discord_runtime_facts_path` is present.
2. You need a Discord fact that is not already explicit in the request fields.

Typical cases:
- You need to restate the current thread lineage without re-reading code.
- You need channel/root/thread ids in one normalized view.
- You need actor/message context from the facts artifact.
- You need to confirm whether a runtime facts file is a full harness request or a smaller snapshot.

Do not use scripts for:
- Deciding reply routing when `place` and `thread_context` already tell you enough.
- Looking up Discord API behavior.
- Searching the implementation to infer what the runtime probably meant.

## Script entry points
All scripts are read-only and operate on repo-local JSON artifacts.

### 1. Inspect the whole facts artifact
Use when you need a normalized summary of everything available in the facts file.

```powershell
node --import tsx .agents/skills/discord-harness/scripts/read-discord-facts.ts --facts <path>
```

Returns a compact JSON object with `request_id`, `place`, `actor`, `message`, `thread_context`, `channel_lineage`, `capabilities`, and `available_context` slices when present.

### 2. Get current thread facts
Use when thread/root/reply-thread understanding is the only missing piece.

```powershell
node --import tsx .agents/skills/discord-harness/scripts/get-current-thread.ts --facts <path>
```

Returns only the normalized thread view.

### 3. Get channel lineage facts
Use when you need channel/root/thread lineage in one place.

```powershell
node --import tsx .agents/skills/discord-harness/scripts/get-channel-lineage.ts --facts <path>
```

Returns channel lineage only.

### 4. Get message and actor context
Use when you need the human/message envelope without extra noise.

```powershell
node --import tsx .agents/skills/discord-harness/scripts/get-message-context.ts --facts <path>
```

Returns actor, message, and high-signal capabilities.

## Facts-file contract
The scripts accept either:
- a full harness request JSON, or
- a smaller Discord facts snapshot JSON.

They normalize common field shapes so you do not need to inspect implementation files to use them.

If `available_context.discord_runtime_facts_path` is null or missing, do not guess another source. Work from the authoritative request facts already given.

## Golden path
1. Read `place`, `message`, `capabilities`, and `available_context.thread_context` first.
2. Decide whether they already answer the interpretation problem.
3. If yes, continue without any script.
4. If no, and `available_context.discord_runtime_facts_path` exists, run the smallest script that answers the missing fact.
5. Use the returned JSON as read-only supplemental context.
6. Produce the normal harness response. Do not ask System to perform Discord side effects by describing procedural steps.

## Examples
**Example: knowledge thread follow-up**
- `thread_context.kind=knowledge_thread` is already authoritative.
- Usually no script is needed.
- Use a script only if you need to inspect the exact reply-thread/root-channel lineage from the facts artifact.

**Example: admin_control diagnostics**
- If the operator asks about current place, scope, or thread lineage and those fields are already in the request, answer directly.
- If they ask for a more exact normalized lineage view and a facts artifact path exists, run `get-channel-lineage.ts`.

**Example: avoiding codebase re-search**
- Do not search `implementation/src/app/bot-app.ts` just to rediscover thread/root behavior.
- Use the request facts first, then the local facts-file scripts if a deeper read is actually needed.

## Never
- Never assume MCP or external Discord tooling.
- Never browse Discord docs for runtime routing decisions covered by the request facts or these scripts.
- Never mutate Discord state from a script.
- Never treat repo code as the runtime source of truth for the current turn when a facts artifact exists.
- Never broaden scope or override System-owned reply-target rules.

