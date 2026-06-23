import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChannelType } from "discord.js";

import { ThreadWorkflowGateway } from "../../../src/runtime/thread/thread-workflow-gateway.js";
import { SqliteStore } from "../../../src/storage/database.js";
import type { MessageEnvelope, WatchLocationConfig } from "../../../src/domain/types.js";

test("starter route selection saves a workflow route and returns the decision", async () => {
  await withGateway({ workflow: "clear_explanation", reason: "bounded concept" }, async ({ gateway, store, codex }) => {
    const resolution = await gateway.resolve({
      message: createThreadMessage({
        messageId: "starter-message",
        threadId: "question-thread-1"
      }) as never,
      envelope: createEnvelope({
        messageId: "starter-message",
        channelId: "question-thread-1"
      }),
      watchLocation: questionGatewayLocation()
    });

    assert.deepEqual(resolution, {
      decision: "route",
      workflow: "clear_explanation"
    });
    assert.equal(codex.runJsonTurnCount, 1);
    assert.equal(codex.closedThreadIds.length, 1);

    const route = store.threadWorkflowRoutes.get("question-thread-1");
    assert.ok(route);
    assert.equal(route.root_channel_id, "question-root");
    assert.equal(route.first_message_id, "starter-message");
    assert.equal(route.workflow, "clear_explanation");
    assert.equal(route.selected_by, "starter_gateway");
    assert.equal(route.selected_by_actor_id, null);
    assert.equal(route.reason, "bounded concept");
  });
});

test("existing route is reused for follow-ups without calling route-selection Codex", async () => {
  await withGateway({ workflow: "forum_research", reason: "must not be used" }, async ({ gateway, store, codex }) => {
    store.threadWorkflowRoutes.mark({
      threadId: "question-thread-1",
      rootChannelId: "question-root",
      firstMessageId: "starter-message",
      workflow: "forum_research",
      selectedBy: "starter_gateway",
      selectedByActorId: null,
      reason: "saved route"
    });

    const resolution = await gateway.resolve({
      message: createThreadMessage({
        messageId: "follow-up-message",
        threadId: "question-thread-1",
        starterMessageId: "starter-message"
      }) as never,
      envelope: createEnvelope({
        messageId: "follow-up-message",
        channelId: "question-thread-1"
      }),
      watchLocation: questionGatewayLocation()
    });

    assert.deepEqual(resolution, {
      decision: "route",
      workflow: "forum_research"
    });
    assert.equal(codex.runJsonTurnCount, 0);
    assert.equal(store.threadWorkflowRoutes.get("question-thread-1")?.reason, "saved route");
  });
});

test("Codex route-selection rejects invalid workflows without persisting a fallback route", async (t) => {
  for (const workflow of ["", "unsupported", "redirect_to_forum_research", "normal_chat"] as const) {
    await t.test(`workflow=${workflow || "<empty>"}`, async () => {
      await withGateway({ workflow, reason: "invalid" }, async ({ gateway, store, codex }) => {
        const resolution = await gateway.resolve({
          message: createThreadMessage({
            messageId: "starter-message",
            threadId: "question-thread-1"
          }) as never,
          envelope: createEnvelope({
            messageId: "starter-message",
            channelId: "question-thread-1"
          }),
          watchLocation: questionGatewayLocation()
        });

        assert.equal(resolution.decision, "fail");
        assert.match(
          resolution.decision === "fail" ? resolution.notice : "",
          /処理フローを決められませんでした/
        );
        assert.equal(codex.runJsonTurnCount, 1);
        assert.equal(store.threadWorkflowRoutes.get("question-thread-1"), null);
      });
    });
  }
});

test("internal workflow switch rejects redirect and non-workflow outcomes", async () => {
  await withGateway({ workflow: "clear_explanation", reason: null }, async ({ gateway, store }) => {
    for (const workflow of ["redirect_to_forum_research", "normal_chat", "unsupported"] as const) {
      assert.deepEqual(
        gateway.switchWorkflow({
          threadId: `thread-${workflow}`,
          rootChannelId: "question-root",
          firstMessageId: "starter-message",
          workflow,
          actorId: "admin-1",
          reason: "manual switch"
        }),
        {
          ok: false,
          reason: "forbidden_workflow"
        }
      );
      assert.equal(store.threadWorkflowRoutes.get(`thread-${workflow}`), null);
    }
  });
});

test("gateway passes through non-question-gateway places without Codex selection", async () => {
  await withGateway({ workflow: "forum_research", reason: null }, async ({ gateway, codex }) => {
    const resolution = await gateway.resolve({
      message: createThreadMessage({
        messageId: "starter-message",
        threadId: "plain-thread-1"
      }) as never,
      envelope: createEnvelope({
        messageId: "starter-message",
        channelId: "plain-thread-1"
      }),
      watchLocation: {
        guildId: "guild-1",
        channelId: "plain-root",
        mode: "chat",
        defaultScope: "conversation_only",
        features: ["conversation"],
        chatBehavior: "directed_help_chat"
      }
    });

    assert.deepEqual(resolution, { decision: "pass" });
    assert.equal(codex.runJsonTurnCount, 0);
  });
});

async function withGateway(
  codexResponse: { workflow: string; reason: string | null },
  run: (context: {
    gateway: ThreadWorkflowGateway;
    store: SqliteStore;
    codex: ReturnType<typeof createCodexDouble>;
  }) => Promise<void>
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), "vrc-ai-bot-thread-workflow-"));
  let store: SqliteStore | null = null;
  try {
    store = new SqliteStore(join(workspace, "bot.sqlite"));
    store.migrate();
    const codex = createCodexDouble(codexResponse);
    const gateway = new ThreadWorkflowGateway(store, codex as never, createLogger() as never);
    await run({ gateway, store, codex });
  } finally {
    store?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
}

function createCodexDouble(response: { workflow: string; reason: string | null }) {
  const codex = {
    runJsonTurnCount: 0,
    closedThreadIds: [] as string[],
    startEphemeralThread: async () => "ephemeral-thread-1",
    runJsonTurn: async (input: { parser: (value: unknown) => unknown }) => {
      codex.runJsonTurnCount += 1;
      return {
        response: input.parser(response),
        observations: {
          observed_public_urls: [],
          generated_images: []
        },
        turnId: null
      };
    },
    closeEphemeralThread: async (threadId: string) => {
      codex.closedThreadIds.push(threadId);
    }
  };
  return codex;
}

function createThreadMessage(input: {
  messageId: string;
  threadId: string;
  starterMessageId?: string;
}) {
  const starterMessageId = input.starterMessageId ?? input.messageId;
  const channel = {
    id: input.threadId,
    type: ChannelType.PublicThread,
    isThread: () => true,
    fetchStarterMessage: async () => ({
      id: starterMessageId
    })
  };

  return {
    id: input.messageId,
    channelId: input.threadId,
    channel
  };
}

function createEnvelope(input: {
  messageId: string;
  channelId: string;
}): MessageEnvelope {
  return {
    guildId: "guild-1",
    channelId: input.channelId,
    messageId: input.messageId,
    authorId: "user-1",
    placeType: "public_thread",
    rawPlaceType: "PublicThread",
    content: "この内容を説明してください",
    urls: [],
    receivedAt: "2026-05-21T00:00:00.000Z"
  };
}

function questionGatewayLocation(): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId: "question-root",
    mode: "chat",
    defaultScope: "conversation_only",
    features: ["question_gateway", "conversation"],
    chatBehavior: null
  };
}

function createLogger() {
  return {
    warn: () => {}
  };
}
