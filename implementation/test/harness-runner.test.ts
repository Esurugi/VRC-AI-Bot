import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import pino from "pino";

import type {
  HarnessIntentResponse,
  HarnessRequest,
  HarnessResponse
} from "../src/harness/contracts.js";
import { HarnessRunner } from "../src/harness/harness-runner.js";
import type { ForumResearchPlan } from "../src/forum-research/types.js";
import type { CodexSandboxMode } from "../src/domain/types.js";
import {
  SessionPolicyResolver,
  resolveScopedPlaceId
} from "../src/codex/session-policy.js";
import { SessionManager } from "../src/codex/session-manager.js";
import {
  __testOnly as appServerClientTestOnly,
  type HarnessTurnSessionMetadata,
  type TurnObservations
} from "../src/codex/app-server-client.js";
import type { CodexExecutionProfile } from "../src/codex/execution-profile.js";
import { SqliteStore } from "../src/storage/database.js";

test("resolveScopedPlaceId uses thread id inside threads", () => {
  assert.equal(
    resolveScopedPlaceId({
      envelope: {
        guildId: "guild-1",
        channelId: "thread-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "public_thread",
        rawPlaceType: "PublicThread",
        content: "もっと詳しく",
        urls: [],
        receivedAt: "2026-03-10T00:00:00.000Z"
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      }
    }),
    "thread-1"
  );
});

test("resolveScopedPlaceId isolates url_watch root URL messages by source message id", () => {
  assert.equal(
    resolveScopedPlaceId({
      envelope: {
        guildId: "guild-1",
        channelId: "channel-1",
        messageId: "message-1",
        authorId: "user-1",
        placeType: "guild_text",
        rawPlaceType: "GuildText",
        content: "https://example.com",
        urls: ["https://example.com"],
        receivedAt: "2026-03-10T00:00:00.000Z"
      },
      watchLocation: {
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "url_watch",
        defaultScope: "server_public"
      }
    }),
    "channel-1:message:message-1"
  );
});

test("HarnessRunner uses two-phase turns and keeps plain chat capabilities narrow", async () => {
  const fixture = createFixture({
    answerResponses: [
      createHarnessResponse({
        public_text: "了解しました。"
      })
    ]
  });

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        discordRuntimeFactsPath: ".tmp/discord-runtime/message-1.json"
      })
    );

    assert.equal(result.response.public_text, "了解しました。");
    assert.equal(result.session.threadId, "thread-1");
    assert.equal(result.session.startedFresh, true);
    assert.deepEqual(fixture.codexClient.startCalls, [
      {
        sandbox: "read-only",
        profile: {
          model: "gpt-5.4",
          reasoningEffort: null
        }
      }
    ]);
    assert.equal(fixture.codexClient.intentCalls.length, 1);
    assert.equal(fixture.codexClient.answerCalls.length, 1);
    assert.equal(fixture.codexClient.intentCalls[0]?.request.task.phase, "intent");
    assert.equal(fixture.codexClient.answerCalls[0]?.request.task.phase, "answer");
    assert.deepEqual(fixture.codexClient.intentCalls[0]?.request.capabilities, {
      allow_external_fetch: false,
      allow_knowledge_write: false,
      allow_moderation: false
    });
    assert.deepEqual(fixture.codexClient.answerCalls[0]?.request.capabilities, {
      allow_external_fetch: false,
      allow_knowledge_write: false,
      allow_moderation: false
    });
    assert.equal(
      fixture.codexClient.intentCalls[0]?.request.available_context
        .discord_runtime_facts_path,
      ".tmp/discord-runtime/message-1.json"
    );
    assert.equal(
      fixture.codexClient.answerCalls[0]?.request.available_context
        .discord_runtime_facts_path,
      ".tmp/discord-runtime/message-1.json"
    );
    assert.deepEqual(
      fixture.codexClient.intentCalls[0]?.request.available_context.recent_messages,
      [
        {
          message_id: "message-0",
          author_id: "user-2",
          content: "直前の文脈",
          created_at: "2026-03-10T00:00:00.000Z"
        }
      ]
    );
    assert.deepEqual(
      fixture.codexClient.answerCalls[0]?.request.available_context.recent_messages,
      [
        {
          message_id: "message-0",
          author_id: "user-2",
          content: "直前の文脈",
          created_at: "2026-03-10T00:00:00.000Z"
        }
      ]
    );
  } finally {
    fixture.close();
  }
});

test("HarnessRunner grants full capabilities on answer turn inside active override thread", async () => {
  const fixture = createFixture({
    answerResponses: [
      createHarnessResponse({
        public_text: "この thread では write context で会話しています。"
      })
    ]
  });
  fixture.store.overrideSessions.start({
    sessionId: "override-1",
    guildId: "guild-1",
    actorId: "admin-1",
    grantedBy: "admin-1",
    scopePlaceId: "thread-1",
    flags: {
      allowPlaywrightHeaded: true,
      allowPlaywrightPersistent: false,
      allowPromptInjectionTest: false,
      suspendViolationCounterForCurrentThread: false,
      allowExternalFetchInPrivateContextWithoutPrivateTerms: false
    },
    sandboxMode: "workspace-write",
    startedAt: "2026-03-10T00:00:00.000Z"
  });

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        actorRole: "admin",
        scope: "conversation_only",
        watchLocation: {
          guildId: "guild-1",
          channelId: "channel-1",
          mode: "admin_control",
          defaultScope: "server_public"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-1",
          authorId: "admin-1",
          placeType: "public_thread",
          rawPlaceType: "PublicThread",
          content: "今の実装方針を確認したい",
          urls: [],
          receivedAt: "2026-03-10T00:00:01.000Z"
        }
      })
    );

    assert.equal(
      result.response.public_text,
      "この thread では write context で会話しています。"
    );
    assert.equal(result.session.identity.workloadKind, "admin_override");
    assert.equal(result.session.identity.sandboxMode, "workspace-write");
    assert.equal(result.session.identity.actorId, "admin-1");
    assert.deepEqual(fixture.codexClient.startCalls, [
      {
        sandbox: "workspace-write",
        profile: {
          model: "gpt-5.4",
          reasoningEffort: null
        }
      }
    ]);
    assert.deepEqual(fixture.codexClient.intentCalls[0]?.request.capabilities, {
      allow_external_fetch: false,
      allow_knowledge_write: false,
      allow_moderation: true
    });
    assert.deepEqual(fixture.codexClient.answerCalls[0]?.request.capabilities, {
      allow_external_fetch: true,
      allow_knowledge_write: true,
      allow_moderation: true
    });
  } finally {
    fixture.close();
  }
});

test("HarnessRunner denies repo-write intent without active override before answer turn", async () => {
  const fixture = createFixture({
    intentResponses: [
      createIntentResponse({
        repo_write_intent: true
      })
    ],
    answerResponses: []
  });

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        actorRole: "admin",
        scope: "conversation_only",
        watchLocation: {
          guildId: "guild-1",
          channelId: "channel-1",
          mode: "admin_control",
          defaultScope: "server_public"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-1",
          authorId: "admin-1",
          placeType: "admin_control_channel",
          rawPlaceType: "GuildText",
          content: "この repo を修正して",
          urls: [],
          receivedAt: "2026-03-10T00:00:01.000Z"
        }
      })
    );

    assert.match(result.response.public_text ?? "", /override-start/);
    assert.equal(fixture.codexClient.intentCalls.length, 1);
    assert.equal(fixture.codexClient.answerCalls.length, 0);
  } finally {
    fixture.close();
  }
});

test("HarnessRunner grants public research and knowledge write only on answer turn for natural-language save", async () => {
  const fixture = createFixture({
    intentResponses: [
      createIntentResponse({
        outcome_candidate: "knowledge_ingest",
        requested_external_fetch: "public_research",
        requested_knowledge_write: true
      })
    ],
    answerResponses: [
      createHarnessResponse({
        outcome: "knowledge_ingest",
        public_text: "調査結果を共有知見として保存します。",
        reply_mode: "same_place",
        knowledge_writes: [
          createKnowledgeWrite({
            source_url: "https://example.com/article",
            canonical_url: "https://example.com/article",
            title: "Example Article",
            summary: "summary"
          })
        ]
      })
    ]
  });

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-10",
          authorId: "user-1",
          placeType: "chat_channel",
          rawPlaceType: "GuildText",
          content: "Claude Code hooks を調べて知見として保存して",
          urls: [],
          receivedAt: "2026-03-10T00:00:10.000Z"
        }
      })
    );

    assert.equal(result.response.outcome, "knowledge_ingest");
    assert.equal(result.knowledgePersistenceScope, "server_public");
    assert.deepEqual(fixture.codexClient.intentCalls[0]?.request.capabilities, {
      allow_external_fetch: false,
      allow_knowledge_write: false,
      allow_moderation: false
    });
    assert.deepEqual(fixture.codexClient.answerCalls[0]?.request.capabilities, {
      allow_external_fetch: true,
      allow_knowledge_write: true,
      allow_moderation: false
    });
  } finally {
    fixture.close();
  }
});

test.skip("HarnessRunner uses exploration loop on forum_longform answer turns", async () => {
  const fixture = createFixture({
    forumTextResponses: [
      {
        response: "acquire note",
        observations: {
          observed_public_urls: ["https://example.com/news"]
        }
      }
    ],
    forumJsonResponses: [
      {
        response: {
          phase_result: "acquired",
          resolved_items: ["latest facts"],
          open_items: ["synthesis"],
          material_gaps: [],
          contradictions: [],
          evidence_digest: "facts gathered",
          provisional_outline: "outline",
          next_phase: "finalize",
          stop_judgement: {
            done: true,
            reason: "enough evidence",
            marginal_value: "low"
          }
        }
      },
      {
        response: createHarnessResponse({
          public_text: "公開情報を確認して答えます。[1]",
          sources_used: ["https://example.com/news"]
        }),
        observations: {
          observed_public_urls: ["https://example.com/news"]
        }
      }
    ]
  });

  try {
    await fixture.runner.routeMessage(
      createHarnessInput({
        watchLocation: {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        scope: "conversation_only",
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-40",
          authorId: "user-1",
          placeType: "forum_post_thread",
          rawPlaceType: "PublicThread",
          content: "この話題を論じて",
          urls: [],
          receivedAt: "2026-03-10T00:00:40.000Z"
        }
      })
    );

    assert.deepEqual(fixture.codexClient.intentCalls[0]?.request.capabilities, {
      allow_external_fetch: false,
      allow_knowledge_write: false,
      allow_moderation: false
    });
    assert.equal(fixture.codexClient.answerCalls.length, 0);
    assert.equal(fixture.codexClient.textTurnCalls.length, 1);
    assert.equal(fixture.codexClient.jsonTurnCalls.length, 2);
    const workPayload = fixture.codexClient.textTurnCalls[0]?.payload as Record<
      string,
      unknown
    >;
    const finalizePayload = fixture.codexClient.jsonTurnCalls[1]?.payload as Record<
      string,
      unknown
    >;
    assert.equal(
      (workPayload.forum_loop as { kind?: string } | undefined)?.kind,
      "exploration_work"
    );
    assert.equal(
      (finalizePayload.forum_loop as { kind?: string } | undefined)?.kind,
      "finalize"
    );
    assert.deepEqual(
      (finalizePayload.forum_loop as {
        research_observed?: boolean;
        longform_target?: unknown;
        instruction?: string;
      } | undefined)?.longform_target,
      {
        min_body_chars: 6000,
        basis: "public_text_only",
        applies: true
      }
    );
    assert.equal(
      (finalizePayload.forum_loop as { research_observed?: boolean } | undefined)
        ?.research_observed,
      true
    );
    assert.match(
      String(
        (finalizePayload.forum_loop as { instruction?: string } | undefined)
          ?.instruction
      ),
      /at least 6000 Japanese characters in the public_text body alone/i
    );
    assert.equal(fixture.codexClient.textTurnCalls[0]?.timeoutMs, 240000);
    assert.deepEqual(fixture.codexClient.textTurnCalls[0]?.controlPolicy, {
      idleSteer: {
        afterMs: 30000,
        prompt:
          "Focus only on the unresolved material gaps already listed in forum_loop.prior_state. Do not broaden the search space. Prefer opening specific pages or extracting passages over issuing new broad searches."
      },
      broadeningSearchSteer: {
        searchActionThreshold: 6,
        prompt:
          "Shift from issuing new broad searches to opening the strongest candidate pages and extracting the exact passages needed for a fuller longform answer. Use the existing material gaps and the evidence already gathered to deepen the current line of work."
      }
    });
  } finally {
    fixture.close();
  }
});

test.skip("HarnessRunner omits forum longform target when no public research was observed", async () => {
  const fixture = createFixture({
    forumTextResponses: [
      {
        response: "acquire note"
      }
    ],
    forumJsonResponses: [
      {
        response: {
          phase_result: "acquired",
          resolved_items: ["local reasoning"],
          open_items: [],
          material_gaps: [],
          contradictions: [],
          evidence_digest: "digest",
          provisional_outline: "outline",
          next_phase: "finalize",
          stop_judgement: {
            done: true,
            reason: "ready",
            marginal_value: "low"
          }
        }
      },
      {
        response: createHarnessResponse({
          public_text: "説明です。"
        })
      }
    ]
  });

  try {
    await fixture.runner.routeMessage(
      createHarnessInput({
        watchLocation: {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        scope: "conversation_only",
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-forum-no-research",
          authorId: "user-1",
          placeType: "forum_post_thread",
          rawPlaceType: "PublicThread",
          content: "説明して",
          urls: [],
          receivedAt: "2026-03-10T00:00:40.250Z"
        }
      })
    );

    const finalizePayload = fixture.codexClient.jsonTurnCalls[1]?.payload as {
      forum_loop?: {
        research_observed?: boolean;
        longform_target?: unknown;
      };
    };
    assert.equal(finalizePayload.forum_loop?.research_observed, false);
    assert.equal(finalizePayload.forum_loop?.longform_target, undefined);
  } finally {
    fixture.close();
  }
});

test.skip("HarnessRunner honors forum checkpoint next_phase over stop_judgement.done", async () => {
  const fixture = createFixture({
    forumTextResponses: [
      {
        response: "acquire note"
      },
      {
        response: "integrate note"
      }
    ],
    forumJsonResponses: [
      {
        response: {
          phase_result: "acquired",
          resolved_items: ["fact 1"],
          open_items: ["turn into explanation"],
          material_gaps: [
            {
              gap: "no more external observation needed",
              needs_observation: false,
              suggested_operator: "none"
            }
          ],
          contradictions: [],
          evidence_digest: "facts gathered",
          provisional_outline: "outline 1",
          next_phase: "integrate",
          stop_judgement: {
            done: true,
            reason: "research is sufficient; move to integration",
            marginal_value: "low"
          }
        }
      },
      {
        response: {
          phase_result: "integrated",
          resolved_items: ["fact 1", "explanation"],
          open_items: [],
          material_gaps: [],
          contradictions: [],
          evidence_digest: "integrated digest",
          provisional_outline: "integrated outline",
          next_phase: "finalize",
          stop_judgement: {
            done: true,
            reason: "ready to answer",
            marginal_value: "low"
          }
        }
      },
      {
        response: createHarnessResponse({
          public_text: "十分な厚みのある回答です。[1]",
          sources_used: ["https://example.com/news"]
        })
      }
    ]
  });

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        watchLocation: {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        scope: "conversation_only",
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-forum-next-phase",
          authorId: "user-1",
          placeType: "forum_post_thread",
          rawPlaceType: "PublicThread",
          content: "詳しく論じて",
          urls: [],
          receivedAt: "2026-03-10T00:00:40.500Z"
        }
      })
    );

    assert.equal(result.response.public_text, "十分な厚みのある回答です。[1]");
    assert.equal(fixture.codexClient.textTurnCalls.length, 2);
    assert.equal(fixture.codexClient.jsonTurnCalls.length, 3);
    const integratePayload = fixture.codexClient.textTurnCalls[1]?.payload as {
      forum_loop?: { phase?: string; iteration?: number };
    };
    assert.equal(integratePayload.forum_loop?.phase, "integrate");
    assert.equal(integratePayload.forum_loop?.iteration, 2);
  } finally {
    fixture.close();
  }
});

test("HarnessRunner keeps knowledge write disabled for message_urls when no fetchable public URLs exist", async () => {
  const fixture = createFixture({
    intentResponses: [
      createIntentResponse({
        outcome_candidate: "knowledge_ingest",
        requested_external_fetch: "message_urls",
        requested_knowledge_write: true
      })
    ],
    answerResponses: [
      createHarnessResponse({
        outcome: "chat_reply",
        public_text: "この URL は公開取得の対象にできません。"
      })
    ]
  });

  try {
    await fixture.runner.routeMessage(
      createHarnessInput({
        watchLocation: {
          guildId: "guild-1",
          channelId: "channel-1",
          mode: "url_watch",
          defaultScope: "server_public"
        },
        envelope: {
          guildId: "guild-1",
          channelId: "channel-1",
          messageId: "message-11",
          authorId: "user-1",
          placeType: "guild_text",
          rawPlaceType: "GuildText",
          content: "https://localhost/test",
          urls: ["https://localhost/test"],
          receivedAt: "2026-03-10T00:00:11.000Z"
        }
      })
    );

    assert.deepEqual(fixture.codexClient.intentCalls[0]?.request.capabilities, {
      allow_external_fetch: false,
      allow_knowledge_write: false,
      allow_moderation: false
    });
    assert.deepEqual(fixture.codexClient.answerCalls[0]?.request.capabilities, {
      allow_external_fetch: false,
      allow_knowledge_write: false,
      allow_moderation: false
    });
  } finally {
    fixture.close();
  }
});

test("HarnessRunner retries output safety with task.retry_context and allows observed public URLs", async () => {
  const retryFixture = createFixture({
    answerResponses: [
      createHarnessResponse({
        public_text: "private source を使った回答です。",
        selected_source_ids: ["src-private"],
        sources_used: ["src-private"]
      }),
      createHarnessResponse({
        public_text: "公開範囲で確認できる根拠だけに絞って答え直します。",
        sources_used: []
      })
    ]
  });
  seedKnowledgeRecord(retryFixture.store, {
    recordId: "src-private",
    canonicalUrl: "https://example.com/private-note",
    scope: "conversation_only",
    visibilityKey: "conversation_only:thread-private"
  });

  try {
    const result = await retryFixture.runner.routeMessage(createHarnessInput());

    assert.equal(
      result.response.public_text,
      "公開範囲で確認できる根拠だけに絞って答え直します。"
    );
    assert.equal(retryFixture.codexClient.answerCalls.length, 2);
    assert.deepEqual(
      retryFixture.codexClient.answerCalls[1]?.request.task.retry_context,
      {
        kind: "output_safety",
        retry_count: 1,
        reason: "knowledge source id is outside current scope",
        allowed_sources: [],
        disallowed_sources: ["src-private"]
      }
    );
  } finally {
    retryFixture.close();
  }

  const reconfirmFixture = createFixture({
    answerResponses: [
      createHarnessResponse({
        public_text: "これです。\nhttps://openai.com/index/harness-engineering/",
        sources_used: ["https://openai.com/index/harness-engineering/"]
      })
    ],
    answerObservations: [
      {
        observed_public_urls: ["https://openai.com/index/harness-engineering/"]
      }
    ]
  });

  try {
    const result = await reconfirmFixture.runner.routeMessage(createHarnessInput());
    assert.match(
      result.response.public_text ?? "",
      /https:\/\/openai\.com\/index\/harness-engineering\//
    );
    assert.equal(reconfirmFixture.codexClient.answerCalls.length, 1);
  } finally {
    reconfirmFixture.close();
  }
});

test.skip("HarnessRunner allows forum public URLs without retry when observed URLs are partial", async () => {
  const fixture = createFixture({
    forumTextResponses: [
      {
        response: "acquire note",
        observations: {
          observed_public_urls: ["https://www.britannica.com/topic/Sunni"]
        }
      },
      {
        response: "integrate note"
      }
    ],
    forumJsonResponses: [
      {
        response: {
          phase_result: "acquired",
          resolved_items: ["fact 1"],
          open_items: ["fact 2"],
          material_gaps: [
            {
              gap: "fact 2 synthesis",
              needs_observation: false,
              suggested_operator: "none"
            }
          ],
          contradictions: [],
          evidence_digest: "first digest",
          provisional_outline: "first outline",
          next_phase: "integrate",
          stop_judgement: {
            done: false,
            reason: "need integration",
            marginal_value: "medium"
          }
        }
      },
      {
        response: {
          phase_result: "integrated",
          resolved_items: ["fact 1", "fact 2"],
          open_items: [],
          material_gaps: [],
          contradictions: [],
          evidence_digest: "final digest",
          provisional_outline: "final outline",
          next_phase: "finalize",
          stop_judgement: {
            done: true,
            reason: "ready",
            marginal_value: "low"
          }
        }
      },
      {
        response: createHarnessResponse({
          public_text: "調査結果です。[1][2]",
          sources_used: [
            "https://www.britannica.com/topic/Sunni",
            "https://www.cfr.org/conference-calls/tensions-between-saudi-arabia-and-iran"
          ]
        })
      }
    ]
  });

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        watchLocation: {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        scope: "conversation_only",
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-forum-allow",
          authorId: "user-1",
          placeType: "forum_post_thread",
          rawPlaceType: "PublicThread",
          content: "論じて",
          urls: [],
          receivedAt: "2026-03-10T00:00:41.000Z"
        }
      })
    );

    assert.equal(result.response.public_text, "調査結果です。[1][2]");
    assert.equal(fixture.codexClient.answerCalls.length, 0);
    assert.equal(fixture.codexClient.compactionCalls.length, 1);
  } finally {
    fixture.close();
  }
});

test.skip("HarnessRunner keeps forum output-safety retry free of source allowlists", async () => {
  const fixture = createFixture({
    forumTextResponses: [
      {
        response: "acquire note",
        observations: {
          observed_public_urls: ["https://example.com/research"]
        }
      }
    ],
    forumJsonResponses: [
      {
        response: {
          phase_result: "acquired",
          resolved_items: ["unsafe cite"],
          open_items: [],
          material_gaps: [],
          contradictions: [],
          evidence_digest: "digest",
          provisional_outline: "outline",
          next_phase: "finalize",
          stop_judgement: {
            done: true,
            reason: "ready",
            marginal_value: "low"
          }
        }
      },
      {
        response: createHarnessResponse({
          public_text: "bad",
          sources_used: ["file:///tmp/private.txt"]
        })
      },
      {
        response: createHarnessResponse({
          public_text: "公開根拠だけで答え直します。",
          sources_used: []
        })
      }
    ]
  });

  try {
    await fixture.runner.routeMessage(
      createHarnessInput({
        watchLocation: {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        scope: "conversation_only",
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-forum-retry",
          authorId: "user-1",
          placeType: "forum_post_thread",
          rawPlaceType: "PublicThread",
          content: "論じて",
          urls: [],
          receivedAt: "2026-03-10T00:00:42.000Z"
        }
      })
    );

    const retryFinalizePayload = fixture.codexClient.jsonTurnCalls[2]?.payload as {
      task?: { retry_context?: unknown };
      forum_loop?: {
        kind?: string;
        research_observed?: boolean;
        longform_target?: unknown;
        instruction?: string;
      };
    };
    assert.equal(retryFinalizePayload.forum_loop?.kind, "finalize");
    assert.equal(retryFinalizePayload.forum_loop?.research_observed, true);
    assert.deepEqual(retryFinalizePayload.forum_loop?.longform_target, {
      min_body_chars: 6000,
      basis: "public_text_only",
      applies: true
    });
    assert.match(
      String(retryFinalizePayload.forum_loop?.instruction),
      /at least 6000 Japanese characters in the public_text body alone/i
    );
    assert.deepEqual(retryFinalizePayload.task?.retry_context, {
      kind: "output_safety",
      retry_count: 1,
      reason: "blocked or non-public source url",
      allowed_sources: [],
      disallowed_sources: ["file:///tmp/private.txt"]
    });
  } finally {
    fixture.close();
  }
});

test.skip("HarnessRunner carries termination facts into forum finalize without synthetic semantic stop labels", async () => {
  const fixture = createFixture({
    forumTextResponses: [
      {
        error: "work turn timed out"
      }
    ],
    forumJsonResponses: [
      {
        response: createHarnessResponse({
          public_text: "最終回答です。"
        })
      }
    ]
  });

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        watchLocation: {
          guildId: "guild-1",
          channelId: "forum-parent-1",
          mode: "forum_longform",
          defaultScope: "conversation_only"
        },
        scope: "conversation_only",
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-forum-failure",
          authorId: "user-1",
          placeType: "forum_post_thread",
          rawPlaceType: "PublicThread",
          content: "論じて",
          urls: [],
          receivedAt: "2026-03-10T00:00:43.000Z"
        }
      })
    );

    assert.equal(result.response.public_text, "最終回答です。");
    const finalizePayload = fixture.codexClient.jsonTurnCalls[0]?.payload as {
      forum_loop?: {
        kind?: string;
        prior_state?: {
          termination?: { reason?: string; detail?: string };
          stop_judgement?: { marginal_value?: string };
        };
      };
    };
    assert.equal(finalizePayload.forum_loop?.kind, "finalize");
    assert.deepEqual(finalizePayload.forum_loop?.prior_state?.termination, {
      reason: "interrupt_timeout",
      detail: "work turn timed out"
    });
    assert.equal(
      finalizePayload.forum_loop?.prior_state?.stop_judgement?.marginal_value,
      "high"
    );
  } finally {
    fixture.close();
  }
});

test("app-server current-turn reconfirmation ignores delayed completion from older turn", () => {
  const snapshot = appServerClientTestOnly.findLatestTurnSnapshot(
    {
      thread: {
        turns: [
          {
            id: "turn-older",
            items: [
              {
                type: "commandExecution",
                command:
                  'node --import tsx .agents/skills/public-source-fetch/scripts/fetch-public-source.ts --url "https://old.example.com"',
                exitCode: 0,
                aggregatedOutput: JSON.stringify({
                  requestedUrl: "https://old.example.com",
                  finalUrl: "https://old.example.com/",
                  canonicalUrl: "https://old.example.com/",
                  public: true,
                  status: 200
                })
              },
              {
                type: "agentMessage",
                text: "{\"outcome\":\"chat_reply\"}"
              }
            ]
          },
          {
            id: "turn-current",
            items: [
              {
                type: "agentMessage",
                text: "{\"outcome\":\"chat_reply\",\"public_text\":\"current\"}"
              }
            ]
          }
        ]
      }
    },
    "turn-current",
    true
  );

  assert.equal(
    snapshot.lastAgentMessage,
    "{\"outcome\":\"chat_reply\",\"public_text\":\"current\"}"
  );
  assert.deepEqual(snapshot.observedPublicUrls, []);
});

test("app-server current-turn reconfirmation requires exact successful public-source-fetch execution", () => {
  const response = {
    thread: {
      turns: [
        {
          id: "turn-current",
          items: [
            {
              type: "commandExecution",
              command:
                'node --import tsx .agents/skills/public-source-fetch/scripts/fetch-public-source.ts --url "https://openai.com/index/harness-engineering/"',
              cwd: "D:/project/VRC-AI-Bot",
              exitCode: 0,
              aggregatedOutput: JSON.stringify({
                requestedUrl: "https://openai.com/index/harness-engineering/",
                finalUrl: "https://openai.com/index/harness-engineering/",
                canonicalUrl: "https://openai.com/index/harness-engineering/",
                public: true,
                status: 200
              })
            },
            {
              type: "commandExecution",
              command:
                'node --import tsx .agents/skills/public-source-fetch/scripts/fetch-public-source.ts --url "https://example.com/bad"',
              cwd: "D:/project/VRC-AI-Bot",
              exitCode: 0,
              aggregatedOutput: "{\"canonicalUrl\":\"https://example.com/bad\"}"
            },
            {
              type: "commandExecution",
              command:
                'echo node --import tsx .agents/skills/public-source-fetch/scripts/fetch-public-source.ts --url "https://example.com/not-authoritative"',
              cwd: "D:/project/VRC-AI-Bot",
              exitCode: 0,
              aggregatedOutput: JSON.stringify({
                requestedUrl: "https://example.com/not-authoritative",
                finalUrl: "https://example.com/not-authoritative",
                canonicalUrl: "https://example.com/not-authoritative",
                public: true,
                status: 200
              })
            }
          ]
        }
      ]
    }
  };

  const allowedSnapshot = appServerClientTestOnly.findLatestTurnSnapshot(
    response,
    "turn-current",
    true
  );
  assert.deepEqual(allowedSnapshot.observedPublicUrls, [
    "https://openai.com/index/harness-engineering/"
  ]);

  const blockedSnapshot = appServerClientTestOnly.findLatestTurnSnapshot(
    response,
    "turn-current",
    false
  );
  assert.deepEqual(blockedSnapshot.observedPublicUrls, []);
});

test("HarnessRunner retries non-silent knowledge follow-up once and then returns generic failure", async () => {
  const fixture = createFixture({
    answerResponses: [
      createHarnessResponse({
        outcome: "ignore",
        public_text: null,
        reply_mode: "no_reply"
      }),
      createHarnessResponse({
        outcome: "ignore",
        public_text: null,
        reply_mode: "no_reply"
      })
    ]
  });
  seedKnowledgeContext(fixture.store, "thread-1", "src-thread");

  try {
    const result = await fixture.runner.routeMessage(
      createHarnessInput({
        scope: "conversation_only",
        envelope: {
          guildId: "guild-1",
          channelId: "thread-1",
          messageId: "message-30",
          authorId: "user-1",
          placeType: "public_thread",
          rawPlaceType: "PublicThread",
          content: "日本語にして",
          urls: [],
          receivedAt: "2026-03-10T00:00:30.000Z"
        }
      })
    );

    assert.equal(result.response.outcome, "failure");
    assert.match(result.response.public_text ?? "", /追撃応答を生成できませんでした/);
    assert.equal(fixture.codexClient.answerCalls.length, 2);
    assert.deepEqual(
      fixture.codexClient.answerCalls[1]?.request.task.retry_context,
      {
        kind: "knowledge_followup_non_silent",
        retry_count: 1
      }
    );
  } finally {
    fixture.close();
  }
});

function createFixture(input?: {
  intentResponses?: HarnessIntentResponse[];
  answerResponses?: HarnessResponse[];
  answerObservations?: TurnObservations[];
  plannerResponse?: ForumResearchPlan;
  forumTextResponses?: Array<{
    response?: string | null;
    observations?: TurnObservations;
    error?: string;
  }>;
  forumJsonResponses?: Array<{
    response: unknown;
    observations?: TurnObservations;
    error?: string;
  }>;
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-harness-"));
  const dbPath = join(tempDir, "bot.sqlite");
  const store = new SqliteStore(dbPath, process.cwd());
  store.migrate();
  const codexClient = new FakeCodexClient(input);
  const sessionPolicyResolver = new SessionPolicyResolver();
  const sessionManager = new SessionManager(
    store,
    codexClient as never,
    pino({ level: "silent" })
  );
  const forumResearchPlanner = {
    async plan() {
      return (
        input?.plannerResponse ?? {
          progress_notice: "調査方針を組み立てています。",
          effective_user_text: "調査を開始します。",
          worker_tasks: [
            {
              worker_id: "worker-1",
              question: "調査項目",
              search_focus: "焦点",
              must_cover: ["要点"],
              min_sources: 2,
              max_sources: 3
            }
          ],
          synthesis_brief: "統合方針"
        }
      );
    }
  };
  const runner = new HarnessRunner(
    store,
    codexClient as never,
    sessionPolicyResolver,
    sessionManager,
    forumResearchPlanner as never,
    pino({ level: "silent" })
  );

  return {
    store,
    codexClient,
    runner,
    close() {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function seedKnowledgeRecord(
  store: SqliteStore,
  input: {
    recordId: string;
    canonicalUrl: string;
    scope: "server_public" | "channel_family" | "conversation_only";
    visibilityKey: string;
  }
): void {
  const createdAt = "2026-03-10T00:00:00.000Z";
  store.knowledgeRecords.insert({
    recordId: input.recordId,
    canonicalUrl: input.canonicalUrl,
    domain: new URL(input.canonicalUrl).hostname,
    title: "seed title",
    summary: "seed summary",
    tags: ["seed"],
    scope: input.scope,
    visibilityKey: input.visibilityKey,
    contentHash: `hash-${input.recordId}`,
    createdAt
  });
  store.knowledgeArtifacts.upsert({
    recordId: input.recordId,
    finalUrl: input.canonicalUrl,
    snapshotPath: "artifacts/snapshot.md",
    screenshotPath: null,
    networkLogPath: null
  });
  store.knowledgeSourceTexts.upsert({
    recordId: input.recordId,
    normalizedText: "seed normalized text",
    sourceKind: "summary",
    capturedAt: createdAt
  });
}

function seedKnowledgeContext(
  store: SqliteStore,
  replyThreadId: string,
  sourceId: string
): void {
  const canonicalUrl = "https://openai.com/index/harness-engineering/";
  seedKnowledgeRecord(store, {
    recordId: sourceId,
    canonicalUrl,
    scope: "conversation_only",
    visibilityKey: `conversation_only:${replyThreadId}`
  });
  store.sourceLinks.insert({
    linkId: `link-${sourceId}`,
    recordId: sourceId,
    sourceMessageId: "source-message-1",
    replyThreadId,
    createdAt: "2026-03-10T00:00:00.000Z"
  });
}

function createHarnessInput(
  overrides: Partial<Parameters<HarnessRunner["routeMessage"]>[0]> = {}
): Parameters<HarnessRunner["routeMessage"]>[0] {
  return {
    actorRole: "user",
    scope: "channel_family",
    watchLocation: {
      guildId: "guild-1",
      channelId: "channel-1",
      mode: "chat",
      defaultScope: "channel_family"
    },
    envelope: {
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "GuildText",
      content: "こんにちは",
      urls: [],
      receivedAt: "2026-03-10T00:00:00.000Z"
    },
    recentMessages: [
      {
        message_id: "message-0",
        author_id: "user-2",
        content: "直前の文脈",
        created_at: "2026-03-10T00:00:00.000Z"
      }
    ],
    ...overrides
  };
}

function createKnowledgeWrite(
  overrides: Partial<HarnessResponse["knowledge_writes"][number]> = {}
): HarnessResponse["knowledge_writes"][number] {
  return {
    source_url: null,
    canonical_url: null,
    title: null,
    summary: null,
    tags: [],
    content_hash: null,
    normalized_text: null,
    source_kind: null,
    ...overrides
  };
}

function createHarnessResponse(
  overrides: Partial<HarnessResponse> = {}
): HarnessResponse {
  return {
    outcome: "chat_reply",
    repo_write_intent: false,
    public_text: "ok",
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none",
    ...overrides
  };
}

function createIntentResponse(
  overrides: Partial<HarnessIntentResponse> = {}
): HarnessIntentResponse {
  return {
    outcome_candidate: "chat_reply",
    repo_write_intent: false,
    requested_external_fetch: "none",
    requested_knowledge_write: false,
    moderation_signal: {
      violation_category: "none",
      control_request_class: null,
      notes: null
    },
    diagnostics: {
      notes: null
    },
    ...overrides
  };
}

class FakeCodexClient {
  readonly startCalls: Array<{
    sandbox: CodexSandboxMode;
    profile: CodexExecutionProfile;
  }> = [];
  readonly resumeCalls: Array<{ threadId: string; sandbox: CodexSandboxMode }> = [];
  readonly archiveCalls: string[] = [];
  readonly unsubscribeCalls: string[] = [];
  readonly intentCalls: Array<{
    threadId: string;
    request: HarnessRequest;
    sessionMetadata?: HarnessTurnSessionMetadata;
  }> = [];
  readonly answerCalls: Array<{
    threadId: string;
    request: HarnessRequest;
    sessionMetadata?: HarnessTurnSessionMetadata;
  }> = [];
  readonly textTurnCalls: Array<{
    threadId: string;
    payload: unknown;
    sessionMetadata?: HarnessTurnSessionMetadata;
    timeoutMs?: number;
    controlPolicy?: unknown;
  }> = [];
  readonly jsonTurnCalls: Array<{
    threadId: string;
    payload: unknown;
    sessionMetadata?: HarnessTurnSessionMetadata;
    timeoutMs?: number;
  }> = [];
  readonly compactionCalls: string[] = [];
  readonly interruptCalls: Array<{ threadId: string; turnId: string }> = [];
  readonly steerCalls: Array<{ threadId: string; turnId: string; prompt: string }> = [];
  readonly streamingTextTurnCalls: Array<{
    threadId: string;
    payload: unknown;
    sessionMetadata?: HarnessTurnSessionMetadata;
    timeoutMs?: number;
  }> = [];
  private threadCount = 0;
  private sessionInvalidationGeneration = 0;
  private readonly intentResponses: HarnessIntentResponse[];
  private readonly answerResponses: HarnessResponse[];
  private readonly answerObservations: TurnObservations[];
  private readonly forumTextResponses: Array<{
    response?: string | null;
    observations?: TurnObservations;
    error?: string;
  }>;
  private readonly forumJsonResponses: Array<{
    response: unknown;
    observations?: TurnObservations;
    error?: string;
  }>;

  constructor(input?: {
    intentResponses?: HarnessIntentResponse[];
    answerResponses?: HarnessResponse[];
    answerObservations?: TurnObservations[];
    forumTextResponses?: Array<{
      response?: string | null;
      observations?: TurnObservations;
      error?: string;
    }>;
    forumJsonResponses?: Array<{
      response: unknown;
      observations?: TurnObservations;
      error?: string;
    }>;
  }) {
    this.intentResponses = [...(input?.intentResponses ?? [createIntentResponse()])];
    this.answerResponses = [...(input?.answerResponses ?? [])];
    this.answerObservations = [...(input?.answerObservations ?? [])];
    this.forumTextResponses = [...(input?.forumTextResponses ?? [])];
    this.forumJsonResponses = [...(input?.forumJsonResponses ?? [])];
  }

  async startThread(
    sandbox: CodexSandboxMode,
    profile: CodexExecutionProfile
  ): Promise<string> {
    this.startCalls.push({ sandbox, profile });
    this.threadCount += 1;
    return `thread-${this.threadCount}`;
  }

  async resumeThread(threadId: string, sandbox: CodexSandboxMode): Promise<void> {
    this.resumeCalls.push({ threadId, sandbox });
  }

  async archiveThread(threadId: string): Promise<void> {
    this.archiveCalls.push(threadId);
  }

  async unsubscribeThread(threadId: string): Promise<void> {
    this.unsubscribeCalls.push(threadId);
  }

  async startEphemeralThread(
    sandbox: CodexSandboxMode,
    profile: CodexExecutionProfile
  ): Promise<string> {
    return this.startThread(sandbox, profile);
  }

  async closeEphemeralThread(threadId: string): Promise<void> {
    await this.archiveThread(threadId);
    await this.unsubscribeThread(threadId);
  }

  getSessionInvalidationGeneration(): number {
    return this.sessionInvalidationGeneration;
  }

  setSessionInvalidationGeneration(generation: number): void {
    this.sessionInvalidationGeneration = generation;
  }

  async runHarnessIntentRequest(
    threadId: string,
    request: HarnessRequest,
    sessionMetadata?: HarnessTurnSessionMetadata
  ): Promise<HarnessIntentResponse> {
    this.intentCalls.push(
      sessionMetadata
        ? { threadId, request, sessionMetadata }
        : { threadId, request }
    );
    const response = this.intentResponses.shift();
    if (!response) {
      throw new Error("missing fake intent response");
    }
    return response;
  }

  async runHarnessRequest(
    threadId: string,
    request: HarnessRequest,
    sessionMetadata?: HarnessTurnSessionMetadata
  ): Promise<{
    response: HarnessResponse;
    observations: TurnObservations;
  }> {
    this.answerCalls.push(
      sessionMetadata
        ? { threadId, request, sessionMetadata }
        : { threadId, request }
    );
    const response = this.answerResponses.shift();
    if (!response) {
      throw new Error("missing fake answer response");
    }
    return {
      response,
      observations: this.answerObservations.shift() ?? {
        observed_public_urls: []
      }
    };
  }

  async runTextTurn(input: {
    threadId: string;
    inputPayload: unknown;
    allowExternalFetch: boolean;
    sessionMetadata?: HarnessTurnSessionMetadata;
    timeoutMs?: number;
    controlPolicy?: unknown;
  }): Promise<{
    response: string | null;
    observations: TurnObservations;
  }> {
    this.textTurnCalls.push({
      threadId: input.threadId,
      payload: input.inputPayload,
      ...(input.sessionMetadata === undefined
        ? {}
        : { sessionMetadata: input.sessionMetadata }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.controlPolicy === undefined
        ? {}
        : { controlPolicy: input.controlPolicy })
    });
    const response = this.forumTextResponses.shift() ?? {
      response: "internal note",
      observations: { observed_public_urls: [] }
    };
    if (response.error) {
      throw new Error(response.error);
    }
    return {
      response: response.response ?? null,
      observations: response.observations ?? {
        observed_public_urls: []
      }
    };
  }

  async runStreamingTextTurn(input: {
    threadId: string;
    inputPayload: unknown;
    allowExternalFetch: boolean;
    sessionMetadata?: HarnessTurnSessionMetadata;
    timeoutMs?: number;
    callbacks?: {
      onAgentMessageDelta?: (delta: string) => Promise<void> | void;
      onReasoningSummaryDelta?: (delta: string) => Promise<void> | void;
    };
  }): Promise<{
    response: string | null;
    observations: TurnObservations;
  }> {
    this.streamingTextTurnCalls.push({
      threadId: input.threadId,
      payload: input.inputPayload,
      ...(input.sessionMetadata === undefined
        ? {}
        : { sessionMetadata: input.sessionMetadata }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });
    const response = this.forumTextResponses.shift() ?? {
      response: "streamed answer",
      observations: { observed_public_urls: [] }
    };
    if (response.error) {
      throw new Error(response.error);
    }
    if (response.response) {
      await input.callbacks?.onAgentMessageDelta?.(response.response);
    }
    return {
      response: response.response ?? null,
      observations: response.observations ?? {
        observed_public_urls: []
      }
    };
  }

  async runJsonTurn<T>(input: {
    threadId: string;
    inputPayload: unknown;
    allowExternalFetch: boolean;
    outputSchema: object;
    parser: (value: unknown) => T;
    sessionMetadata?: HarnessTurnSessionMetadata;
    timeoutMs?: number;
  }): Promise<{
    response: T;
    observations: TurnObservations;
  }> {
    this.jsonTurnCalls.push({
      threadId: input.threadId,
      payload: input.inputPayload,
      ...(input.sessionMetadata === undefined
        ? {}
        : { sessionMetadata: input.sessionMetadata }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });
    const response = this.forumJsonResponses.shift();
    if (!response) {
      throw new Error("missing fake forum json response");
    }
    if (response.error) {
      throw new Error(response.error);
    }
    return {
      response: input.parser(response.response),
      observations: response.observations ?? {
        observed_public_urls: []
      }
    };
  }

  async startCompaction(threadId: string): Promise<void> {
    this.compactionCalls.push(threadId);
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    this.interruptCalls.push({ threadId, turnId });
  }

  async steerTurn(threadId: string, turnId: string, prompt: string): Promise<void> {
    this.steerCalls.push({ threadId, turnId, prompt });
  }
}
