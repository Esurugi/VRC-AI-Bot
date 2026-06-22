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
          source_kind: "webpage",
          evidence_fact_ids: []
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

test("R5 X/Twitter: observed FxTwitter API URL can ground sources_used and knowledge_writes", () => {
  withSafetyGuard(({ guard }) => {
    const fxtwitterApiUrl =
      "https://api.fxtwitter.com/2/status/2033636701848174967";
    const canonicalItemUrl =
      "https://x.com/openaidevs/status/2033636701848174967";
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: [canonicalItemUrl],
      typedEvidenceContext: {
        approved_public_urls: [
          {
            original_url: canonicalItemUrl,
            canonical_url: canonicalItemUrl
          }
        ],
        public_source_resources: [
          {
            resource_id: "x-status:2033636701848174967",
            provider: "x_status",
            original_url: canonicalItemUrl,
            canonical_item_url: canonicalItemUrl
          }
        ],
        readable_public_url_candidates: [
          {
            candidate_id: "x-status:2033636701848174967:fxtwitter",
            resource_id: "x-status:2033636701848174967",
            provider: "x_twitter_fxtwitter",
            original_url: canonicalItemUrl,
            canonical_item_url: canonicalItemUrl,
            retrieval_url: fxtwitterApiUrl
          }
        ],
        public_source_facts: [
          {
            fact_id: "fact:x-status:2033636701848174967:fxtwitter",
            resource_id: "x-status:2033636701848174967",
            candidate_id: "x-status:2033636701848174967:fxtwitter",
            provider: "x_twitter_fxtwitter",
            original_url: canonicalItemUrl,
            canonical_item_url: canonicalItemUrl,
            retrieval_url: fxtwitterApiUrl,
            observed_url: fxtwitterApiUrl,
            status: 200,
            content_type: "application/json",
            title: "FxTwitter evidence",
            text: "The same X/Twitter status was observed through a public API."
          }
        ],
        public_source_failures: []
      }
    });
    const response = createResponse({
      sourcesUsed: [fxtwitterApiUrl],
      knowledgeWrites: [
        {
          source_url: fxtwitterApiUrl,
          canonical_url: canonicalItemUrl,
          title: "FxTwitter evidence",
          summary: "The same X/Twitter status was observed through a public API.",
          tags: ["x-twitter"],
          content_hash: null,
          normalized_text: null,
          source_kind: "webpage",
          evidence_fact_ids: ["fact:x-status:2033636701848174967:fxtwitter"]
        }
      ]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: [fxtwitterApiUrl]
    });

    assert.equal(evaluation.decision, "allow");
    assert.deepEqual(evaluation.disallowedSources, []);
    assert.ok(evaluation.allowedSources.includes(fxtwitterApiUrl));
  });
});

test("R5 X/Twitter: unobserved FxTwitter API URL cannot ground sources_used or knowledge_writes", () => {
  withSafetyGuard(({ guard }) => {
    const fxtwitterApiUrl =
      "https://api.fxtwitter.com/2/status/2033636701848174967";
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: [
        "https://twitter.com/openaidevs/status/2033636701848174967"
      ],
      publicFetchCandidates: [fxtwitterApiUrl]
    });
    const response = createResponse({
      sourcesUsed: [fxtwitterApiUrl],
      knowledgeWrites: [
        {
          source_url: fxtwitterApiUrl,
          canonical_url: fxtwitterApiUrl,
          title: "Unobserved FxTwitter evidence",
          summary: "This write must wait for same-turn public reconfirmation.",
          tags: ["x-twitter"],
          content_hash: null,
          normalized_text: null,
          source_kind: "webpage",
          evidence_fact_ids: []
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
    assert.deepEqual(evaluation.disallowedSources, [fxtwitterApiUrl]);
  });
});

test("R5 X/Twitter: public fetch candidate alone is not observed evidence", () => {
  withSafetyGuard(({ guard }) => {
    const fxtwitterApiUrl =
      "https://api.fxtwitter.com/2/status/2033636701848174967";
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: [
        "https://x.com/openaidevs/status/2033636701848174967"
      ],
      publicFetchCandidates: [fxtwitterApiUrl]
    });
    const response = createResponse({
      sourcesUsed: [fxtwitterApiUrl]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: []
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /source url is not visible in current scope/);
    assert.deepEqual(evaluation.disallowedSources, [fxtwitterApiUrl]);
    assert.equal(evaluation.allowedSources.includes(fxtwitterApiUrl), false);
  });
});

test("typed evidence: knowledge_writes cannot persist from candidate URLs without non-empty evidence facts", () => {
  withSafetyGuard(({ guard }) => {
    const canonicalItemUrl =
      "https://x.com/openaidevs/status/2033636701848174967";
    const jinaReaderUrl =
      "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967";
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: [],
      typedEvidenceContext: {
        approved_public_urls: [
          {
            original_url:
              "https://x.com/openaidevs/status/2033636701848174967?s=46",
            canonical_url: canonicalItemUrl
          }
        ],
        public_source_resources: [
          {
            resource_id: "x-status:2033636701848174967",
            provider: "x_status",
            original_url:
              "https://x.com/openaidevs/status/2033636701848174967?s=46",
            canonical_item_url: canonicalItemUrl
          }
        ],
        readable_public_url_candidates: [
          {
            candidate_id: "x-status:2033636701848174967:jina",
            resource_id: "x-status:2033636701848174967",
            provider: "x_twitter_jina",
            original_url:
              "https://x.com/openaidevs/status/2033636701848174967?s=46",
            canonical_item_url: canonicalItemUrl,
            retrieval_url: jinaReaderUrl
          }
        ],
        public_source_facts: [],
        public_source_failures: []
      }
    });
    const response = createResponse({
      sourcesUsed: [canonicalItemUrl],
      knowledgeWrites: [
        {
          source_url: jinaReaderUrl,
          canonical_url: canonicalItemUrl,
          title: "Candidate only",
          summary: "This write has only a candidate URL, not evidence text.",
          tags: ["x-twitter"],
          content_hash: null,
          normalized_text: "This write has only a candidate URL.",
          source_kind: "x_status",
          evidence_fact_ids: ["public-source:x-status:2033636701848174967"]
        }
      ]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: [canonicalItemUrl, jinaReaderUrl]
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(
      evaluation.reason ?? "",
      /knowledge write evidence fact is missing or empty/
    );
    assert.deepEqual(evaluation.disallowedSources, []);
  });
});

test("typed evidence: knowledge_writes cannot persist summary text from empty public_source_facts", () => {
  withSafetyGuard(({ guard }) => {
    const canonicalItemUrl =
      "https://x.com/openaidevs/status/2033636701848174967";
    const jinaReaderUrl =
      "https://r.jina.ai/https://x.com/openaidevs/status/2033636701848174967";
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: [],
      typedEvidenceContext: {
        approved_public_urls: [
          {
            original_url: canonicalItemUrl,
            canonical_url: canonicalItemUrl
          }
        ],
        public_source_resources: [
          {
            resource_id: "x-status:2033636701848174967",
            provider: "x_status",
            original_url: canonicalItemUrl,
            canonical_item_url: canonicalItemUrl
          }
        ],
        readable_public_url_candidates: [],
        public_source_facts: [
          {
            fact_id: "public-source:x-status:2033636701848174967",
            resource_id: "x-status:2033636701848174967",
            candidate_id: "x-status:2033636701848174967:jina",
            provider: "x_twitter_jina",
            original_url: canonicalItemUrl,
            canonical_item_url: canonicalItemUrl,
            retrieval_url: jinaReaderUrl,
            observed_url: jinaReaderUrl,
            status: 200,
            content_type: "text/markdown",
            title: "OpenAI Developers",
            text: ""
          }
        ],
        public_source_failures: []
      }
    });
    const response = createResponse({
      sourcesUsed: [canonicalItemUrl],
      knowledgeWrites: [
        {
          source_url: jinaReaderUrl,
          canonical_url: canonicalItemUrl,
          title: "Empty fact",
          summary: "This summary must not be saved from an empty fetched body.",
          tags: ["x-twitter"],
          content_hash: null,
          normalized_text:
            "This summary must not be saved from an empty fetched body.",
          source_kind: "x_status",
          evidence_fact_ids: ["public-source:x-status:2033636701848174967"]
        }
      ]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: [canonicalItemUrl, jinaReaderUrl]
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(
      evaluation.reason ?? "",
      /knowledge write evidence fact is missing or empty/
    );
    assert.deepEqual(evaluation.disallowedSources, []);
  });
});

test("R5 X/Twitter: blocked FxTwitter API URL stays disallowed even when observed", () => {
  withSafetyGuard(({ guard }) => {
    const fxtwitterApiUrl =
      "https://api.fxtwitter.com/2/status/2033636701848174967";
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: ["https://x.com/openaidevs/status/2033636701848174967"],
      blockedPublicUrls: [fxtwitterApiUrl]
    });
    const response = createResponse({
      sourcesUsed: [fxtwitterApiUrl]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: [fxtwitterApiUrl]
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /blocked or non-public source url/);
    assert.deepEqual(evaluation.disallowedSources, [fxtwitterApiUrl]);
  });
});

test("R5 X/Twitter: private transformed URL stays disallowed even when observed", () => {
  withSafetyGuard(({ guard }) => {
    const privateUrl = "http://127.0.0.1/status/2033636701848174967";
    const request = createRequest({
      mode: "url_watch",
      allowExternalFetch: true,
      fetchablePublicUrls: ["https://x.com/openaidevs/status/2033636701848174967"]
    });
    const response = createResponse({
      sourcesUsed: [privateUrl]
    });

    const evaluation = guard.evaluate({
      request,
      response,
      linkedKnowledgeSources: [],
      observedPublicUrls: [privateUrl]
    });

    assert.equal(evaluation.decision, "retry");
    assert.match(evaluation.reason ?? "", /blocked or non-public source url/);
    assert.deepEqual(evaluation.disallowedSources, [privateUrl]);
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
  publicFetchCandidates?: string[];
  blockedPublicUrls?: string[];
  typedEvidenceContext?: Record<string, unknown>;
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
      ...(input.typedEvidenceContext ?? {}),
      approved_public_urls:
        (input.typedEvidenceContext?.approved_public_urls as unknown[] | undefined) ??
        input.fetchablePublicUrls.map((url) => ({
          original_url: url,
          canonical_url: url
        })),
      public_source_resources:
        (input.typedEvidenceContext?.public_source_resources as unknown[] | undefined) ??
        [],
      readable_public_url_candidates:
        (input.typedEvidenceContext
          ?.readable_public_url_candidates as unknown[] | undefined) ??
        (input.publicFetchCandidates ?? []).map((url) => ({
          candidate_id: url,
          resource_id: url,
          provider: "generic_web",
          original_url: url,
          canonical_item_url: url,
          retrieval_url: url
        })),
      public_source_facts:
        (input.typedEvidenceContext?.public_source_facts as unknown[] | undefined) ??
        [],
      public_source_failures:
        (input.typedEvidenceContext
          ?.public_source_failures as unknown[] | undefined) ?? [],
      blocked_urls: input.blockedPublicUrls ?? [],
      chat_behavior: null,
      chat_engagement: null,
      recent_room_events: []
    },
    task: {
      kind: "route_message",
      phase: "answer",
      retry_context: null
    }
  } as unknown as HarnessRequest;
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
