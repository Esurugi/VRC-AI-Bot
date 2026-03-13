import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  BotApplication,
  findAdminControlWatchLocation
} from "../src/app/bot-app.js";
import { buildSanctionStateChangeReply } from "../src/app/replies.js";
import { RUNTIME_CONTRACT_VERSION } from "../src/codex/session-policy.js";
import type { AppConfig, MessageEnvelope, WatchLocationConfig } from "../src/domain/types.js";

test("findAdminControlWatchLocation resolves the guild-specific admin control location", () => {
  const watchLocations: WatchLocationConfig[] = [
    {
      guildId: "guild-1",
      channelId: "chat-1",
      mode: "chat",
      defaultScope: "server_public"
    },
    {
      guildId: "guild-1",
      channelId: "admin-1",
      mode: "admin_control",
      defaultScope: "conversation_only"
    },
    {
      guildId: "guild-2",
      channelId: "admin-2",
      mode: "admin_control",
      defaultScope: "conversation_only"
    }
  ];

  assert.deepEqual(findAdminControlWatchLocation(watchLocations, "guild-1"), watchLocations[1]);
  assert.equal(findAdminControlWatchLocation(watchLocations, "guild-missing"), null);
});

test("buildSanctionStateChangeReply formats admin_control JSON payload", () => {
  const reply = buildSanctionStateChangeReply({
    guild_id: "guild-1",
    user_id: "user-1",
    message_id: "message-1",
    violation_category: "dangerous",
    control_request_class: "unsafe_self_mod",
    action: "timeout",
    delivery_status: "applied",
    duration: "24h",
    reason: "threshold reached"
  });

  assert.match(reply, /"type": "sanction_state_change"/);
  assert.match(reply, /"guild_id": "guild-1"/);
  assert.match(reply, /"action": "timeout"/);
});

test("BotApplication soft-block preflight short-circuits before harness dispatch", async () => {
  const app = createTestApplication({
    moderationIntegration: {
      async checkSoftBlock() {
        return {
          blocked: true,
          notice_text: "現在このサーバーでは一定期間 bot を利用できません。"
        };
      }
    }
  });

  const replies: string[] = [];
  (app as any).replyInSamePlace = async (_item: unknown, content: string) => {
    replies.push(content);
  };

  const blocked = await (app as any).runSoftBlockPreflight(createQueuedMessage());

  assert.equal(blocked, true);
  assert.deepEqual(replies, ["現在このサーバーでは一定期間 bot を利用できません。"]);

  (app as any).store.close();
  cleanupApp(app);
});

test("BotApplication sends sanction state changes to admin_control", async () => {
  const app = createTestApplication();
  const sent: string[] = [];
  (app as any).fetchWatchBaseChannel = async () =>
    ({
      send: async ({ content }: { content: string }) => {
        sent.push(content);
      }
    });

  await (app as any).notifySanctionStateChange("guild-1", {
    guild_id: "guild-1",
    user_id: "user-1",
    message_id: "message-1",
    violation_category: "prohibited",
    control_request_class: null,
    action: "soft_block",
    delivery_status: "fallback",
    duration: "24h",
    reason: "timeout failed"
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /"type": "sanction_state_change"/);
  assert.match(sent[0] ?? "", /"delivery_status": "fallback"/);

  (app as any).store.close();
  cleanupApp(app);
});

test("BotApplication forwards moderation signal and suspension state after response", async () => {
  const received: Array<Record<string, unknown>> = [];
  const app = createTestApplication({
    moderationIntegration: {
      async checkSoftBlock() {
        return {
          blocked: false,
          notice_text: null
        };
      },
      async afterResponse(input) {
        received.push({
          moderation_signal: input.moderation_signal,
          violation_counter_suspended: input.violation_counter_suspended,
          threadId: input.session.threadId,
          outcome: input.response.outcome
        });
      }
    }
  });

  await (app as any).runPostResponseModeration(createQueuedMessage(), {
    response: {
      outcome: "chat_reply",
      repo_write_intent: false,
      public_text: "通常応答",
      reply_mode: "same_place",
      target_thread_id: null,
      selected_source_ids: [],
      sources_used: [],
      knowledge_writes: [],
      diagnostics: {
        notes: null
      },
      sensitivity_raise: "none"
    },
    session: {
      threadId: "thread-1",
      startedFresh: true,
      identity: {
        sessionIdentity: "identity-1",
        workloadKind: "conversation",
        bindingKind: "place",
        bindingId: "chat-1",
        actorId: null,
        sandboxMode: "read-only",
        modelProfile: "default:gpt-5.4",
        runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
        lifecyclePolicy: "reusable"
      }
    },
    moderationSignal: {
      violation_category: "dangerous",
      control_request_class: "dangerous-advice",
      notes: null
    },
    violationCounterSuspended: true
  });

  assert.deepEqual(received, [
    {
      moderation_signal: {
        violation_category: "dangerous",
        control_request_class: "dangerous-advice",
        notes: null
      },
      violation_counter_suspended: true,
      threadId: "thread-1",
      outcome: "chat_reply"
    }
  ]);

  (app as any).store.close();
  cleanupApp(app);
});

function createTestApplication(overrides?: {
  moderationIntegration?: NonNullable<
    ConstructorParameters<typeof BotApplication>[1]
  >["moderationIntegration"];
}): BotApplication {
  const tempDir = mkdtempSync(join(tmpdir(), "vrc-ai-bot-botapp-"));
  const config: AppConfig = {
    discordBotToken: "token",
    discordApplicationId: "app-id",
    discordOwnerUserIds: ["owner-1"],
    botDbPath: join(tempDir, "bot.sqlite"),
    botLogLevel: "fatal",
    codexAppServerCommand: "codex app-server",
    codexHomePath: null,
    watchLocations: [
      {
        guildId: "guild-1",
        channelId: "chat-1",
        mode: "chat",
        defaultScope: "server_public"
      },
      {
        guildId: "guild-1",
        channelId: "admin-1",
        mode: "admin_control",
        defaultScope: "conversation_only"
      }
    ],
    weeklyMeetupAnnouncement: null
  };

  const app = new BotApplication(config, {
    ...(overrides?.moderationIntegration
      ? { moderationIntegration: overrides.moderationIntegration }
      : {})
  });
  (app as any).__tempDir = tempDir;
  return app;
}

function cleanupApp(app: BotApplication): void {
  const tempDir = (app as any).__tempDir as string | undefined;
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function createQueuedMessage(): {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: "user";
  scope: "server_public";
} {
  return {
    envelope: {
      guildId: "guild-1",
      channelId: "chat-1",
      messageId: "message-1",
      authorId: "user-1",
      placeType: "chat_channel",
      rawPlaceType: "chat_channel",
      content: "hello",
      urls: [],
      receivedAt: new Date().toISOString()
    },
    watchLocation: {
      guildId: "guild-1",
      channelId: "chat-1",
      mode: "chat",
      defaultScope: "server_public"
    },
    actorRole: "user",
    scope: "server_public"
  };
}
