import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OutputSafetyGuard } from "../../src/harness/output-safety-guard.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import type { HarnessRequest, HarnessResponse } from "../../src/harness/contracts.js";

test("R5/AE-E2E-04 supporting: forum mode does not authorize unobserved public URLs by itself", () => {
  withSafetyGuard(({ guard }) => {
    const request = createRequest({
      mode: "forum_longform",
      allowExternalFetch: true,
      fetchablePublicUrls: ["https://example.com/forum-post"]
    });
    const response = createResponse({
      sourcesUsed: ["https://unobserved.example/research-note"]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: []
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /source url is not visible in current scope/);
    assert.deepEqual(evaluation.disallowedSources, [
      "https://unobserved.example/research-note"
    ]);
  });
});

test("R5 supporting: public reconfirmation must be a structured observed URL, not a pseudo-source marker", () => {
  withSafetyGuard(({ guard }) => {
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: ["https://example.com/original"]
    });
    const response = createResponse({
      sourcesUsed: ["public-source-fetch:https://example.com/reconfirmed"]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: ["https://example.com/reconfirmed"]
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /blocked or non-public source url/);
    assert.deepEqual(evaluation.disallowedSources, [
      "public-source-fetch:https://example.com/reconfirmed"
    ]);
  });
});

test("R5 supporting: observed public URLs are usable as same-turn public grounding", () => {
  withSafetyGuard(({ guard }) => {
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: ["https://example.com/original"]
    });
    const response = createResponse({
      sourcesUsed: ["https://example.com/reconfirmed"]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: ["https://example.com/reconfirmed"]
    });

    assert.equal(evaluation.decision, "allow");
    assert.deepEqual(evaluation.disallowedSources, []);
    assert.ok(evaluation.allowedSources.includes("https://example.com/reconfirmed"));
  });
});

test("R5 supporting: knowledge_writes cannot persist unobserved public URLs", () => {
  withSafetyGuard(({ guard }) => {
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: ["https://example.com/original"]
    });
    const response = createResponse({
      sourcesUsed: ["https://example.com/original"],
      knowledgeWrites: [
        {
          source_url: "https://not-observed.example/source",
          canonical_url: "https://not-observed.example/source",
          title: "Unobserved",
          summary: "This write must not be persisted.",
          tags: [],
          content_hash: null,
          normalized_text: null,
          source_kind: "webpage"
        }
      ]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: []
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /source url is not visible in current scope/);
    assert.deepEqual(evaluation.disallowedSources, [
      "https://not-observed.example/source"
    ]);
  });
});

function withSafetyGuard(
  callback: (input: { guard: OutputSafetyGuard; store: SqliteStore }) => void
): void {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-source-safety-"));
  const store = new SqliteStore(join(tempDir, "bot.sqlite"), process.cwd());
  store.migrate();

  try {
    callback({ guard: new OutputSafetyGuard(store), store });
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function createRequest(input: {
  mode: HarnessRequest["place"]["mode"];
  allowExternalFetch: boolean;
  fetchablePublicUrls: string[];
}): HarnessRequest {
  return {
    request_id: "request-1",
    source: {
      adapter: "discord",
      event: "message_create"
    },
    actor: {
      user_id: "user-1",
      role: "user"
    },
    place: {
      guild_id: "guild-1",
      channel_id: "channel-1",
      root_channel_id: "channel-1",
      thread_id: input.mode === "forum_longform" ? "forum-thread-1" : null,
      mode: input.mode,
      place_type: input.mode === "forum_longform" ? "forum_post_thread" : "guild_text",
      scope: "server_public"
    },
    message: {
      id: "message-1",
      content: "shared source",
      urls: input.fetchablePublicUrls,
      created_at: "2026-05-21T00:00:00.000Z"
    },
    capabilities: {
      allow_external_fetch: input.allowExternalFetch,
      allow_knowledge_write: input.mode !== "chat",
      allow_moderation: false
    },
    override_context: {
      active: false,
      same_actor: false,
      started_by: null,
      started_at: null,
      flags: {
        allow_playwright_headed: false,
        allow_playwright_persistent: false,
        allow_prompt_injection_test: false,
        suspend_violation_counter_for_current_thread: false,
        allow_external_fetch_in_private_context_without_private_terms: false
      }
    },
    available_context: {
      thread_context: {
        kind: input.mode === "forum_longform" ? "plain_thread" : "root_channel",
        source_message_id: null,
        known_source_urls: [],
        reply_thread_id: input.mode === "forum_longform" ? "forum-thread-1" : null,
        root_channel_id: "channel-1"
      },
      place_context: {
        features:
          input.mode === "forum_longform"
            ? ["forum_research", "conversation"]
            : ["knowledge_ingest", "conversation"],
        is_knowledge_place: input.mode !== "chat"
      },
      delivery_context: {
        is_bot_directed: false,
        bot_directed_trigger_kind: null
      },
      discord_runtime_facts_path: null,
      fetchable_public_urls: input.fetchablePublicUrls,
      blocked_urls: [],
      chat_behavior: null,
      chat_engagement: null,
      recent_room_events: []
    },
    task: {
      kind: "route_message",
      phase: "answer",
      retry_context: null
    }
  };
}

function createResponse(input: {
  sourcesUsed: string[];
  knowledgeWrites?: HarnessResponse["knowledge_writes"];
}): HarnessResponse {
  return {
    outcome: "chat_reply",
    repo_write_intent: false,
    public_text: "公開根拠に基づく返信です。",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: input.sourcesUsed,
    knowledge_writes: input.knowledgeWrites ?? [],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none"
  };
}
