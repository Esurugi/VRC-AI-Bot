import test from "node:test";
import assert from "node:assert/strict";

import { shouldRefreshForumPromptArtifact } from "../../src/harness/forum-research-pipeline.js";
import type { HarnessRequest } from "../../src/harness/contracts.js";

test("forum prompt artifacts refresh only for bot-directed thread follow-ups", () => {
  assert.equal(
    shouldRefreshForumPromptArtifact(
      createRequest({
        mode: "forum_longform",
        threadId: "thread",
        isBotDirected: true
      })
    ),
    true
  );

  assert.equal(
    shouldRefreshForumPromptArtifact(
      createRequest({
        mode: "forum_longform",
        threadId: "thread",
        isBotDirected: false
      })
    ),
    false
  );

  assert.equal(
    shouldRefreshForumPromptArtifact(
      createRequest({
        mode: "chat",
        features: ["forum_research", "conversation"],
        threadId: "thread",
        isBotDirected: true
      })
    ),
    true
  );

  assert.equal(
    shouldRefreshForumPromptArtifact(
      createRequest({
        mode: "forum_longform",
        features: ["conversation"],
        threadId: "thread",
        isBotDirected: true
      })
    ),
    false
  );
});

function createRequest(input: {
  mode: HarnessRequest["place"]["mode"];
  features?: HarnessRequest["available_context"]["place_context"]["features"];
  threadId: string | null;
  isBotDirected: boolean;
}): HarnessRequest {
  return {
    request_id: "request",
    source: {
      adapter: "discord",
      event: "message_create"
    },
    actor: {
      user_id: "user",
      role: "user"
    },
    place: {
      guild_id: "guild",
      channel_id: input.threadId ?? "channel",
      root_channel_id: "root",
      thread_id: input.threadId,
      mode: input.mode,
      place_type: input.threadId ? "forum_post_thread" : "guild_text",
      scope: "server_public"
    },
    message: {
      id: "message",
      content: "<@bot> follow-up",
      urls: [],
      created_at: "2026-03-15T00:00:00.000Z"
    },
    capabilities: {
      allow_external_fetch: true,
      allow_knowledge_write: false,
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
        kind: input.threadId ? "plain_thread" : "root_channel",
        source_message_id: null,
        known_source_urls: [],
        reply_thread_id: input.threadId,
        root_channel_id: "root"
      },
      place_context: {
        features:
          input.features ??
          (input.mode === "forum_longform"
            ? ["forum_research", "conversation"]
            : ["conversation"]),
        is_knowledge_place: false
      },
      delivery_context: {
        is_bot_directed: input.isBotDirected,
        bot_directed_trigger_kind: input.isBotDirected ? "direct_mention" : null
      },
      discord_runtime_facts_path: null,
      fetchable_public_urls: [],
      blocked_urls: [],
      chat_behavior: null,
      chat_engagement: input.isBotDirected
        ? {
            trigger_kind: "direct_mention",
            is_directed_to_bot: true,
            sparse_ordinal: null,
            ordinary_message_count: null
          }
        : null,
      recent_room_events: []
    },
    task: {
      kind: "route_message",
      phase: "answer",
      retry_context: null
    }
  };
}
