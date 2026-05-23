import test from "node:test";
import assert from "node:assert/strict";

import type { GeneratedImageArtifact } from "../../src/codex/app-server-client.js";
import type { MessageEnvelope, WatchLocationConfig } from "../../src/domain/types.js";
import type { HarnessResponse } from "../../src/harness/contracts.js";
import type { HarnessResolvedSession } from "../../src/harness/harness-runner.js";
import {
  findAdminControlWatchLocation,
  ReplyDispatchService,
  resolveKnowledgeIngestRouting
} from "../../src/runtime/message/reply-dispatch-service.js";
import {
  FakeDiscordWorld,
  type FakeDiscordChannel
} from "../support/fake-discord-sink.js";

test("knowledge ingest routing stays in place when reply mode is same_place", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      hasKnowledgeIngestFeature: true,
      replyMode: "same_place",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "same_place"
    }
  );
});

test("knowledge ingest routing creates a public thread for knowledge feature root shares", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      hasKnowledgeIngestFeature: true,
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "create_public_thread"
    }
  );
});

test("knowledge ingest routing follows knowledge feature instead of legacy mode", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      hasKnowledgeIngestFeature: true,
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "create_public_thread"
    }
  );
});

test("knowledge ingest routing ignores shared evidence without knowledge feature", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: false,
      hasKnowledgeIngestFeature: false,
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "same_place"
    }
  );
});

test("knowledge ingest routing stays in place for thread messages", () => {
  assert.deepEqual(
    resolveKnowledgeIngestRouting({
      isThreadMessage: true,
      hasKnowledgeIngestFeature: true,
      replyMode: "create_public_thread",
      hasSharedSourceEvidence: true
    }),
    {
      kind: "same_place"
    }
  );
});

test("admin diagnostics target resolves from admin override feature", () => {
  const location = findAdminControlWatchLocation(
    [
      {
        guildId: "guild",
        channelId: "general",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "ambient_room_chat"
      },
      {
        guildId: "guild",
        channelId: "ops-root",
        mode: "chat",
        features: ["admin_override", "conversation"],
        defaultScope: "conversation_only",
        chatBehavior: "directed_help_chat"
      }
    ],
    "guild"
  );

  assert.equal(location?.channelId, "ops-root");
});

test("dispatchHarnessResponseToChannel sends long chat replies as Discord-safe channel chunks", async () => {
  const { service, world } = createDispatchHarness();
  const root = world.createTextChannel({ id: "chat-root" });
  const thread = world.createThread({ id: "chat-thread", parent: root });
  const longText = "a".repeat(4300);

  const target = await service.dispatchHarnessResponseToChannel({
    channel: thread as never,
    messageContext: messageContext({
      channel: thread,
      watchLocation: chatWatchLocation(thread.id)
    }),
    response: harnessResponse({
      outcome: "chat_reply",
      public_text: longText
    }),
    session: harnessSession(),
    knowledgePersistenceScope: null
  });

  assert.deepEqual(target, {
    channelId: "chat-thread",
    threadId: "chat-thread"
  });
  const sends = world.sink.events.filter((event) => event.type === "send");
  assert.equal(sends.length, 3);
  assert.deepEqual(
    sends.map((event) => event.channelId),
    ["chat-thread", "chat-thread", "chat-thread"]
  );
  assert.ok(sends.every((event) => event.content.length <= 1900));
  assert.equal(
    sends.map((event) => event.content).join(""),
    longText
  );
});

test("dispatchHarnessResponseToChannel sends generated image artifacts as files", async () => {
  const { service, world } = createDispatchHarness();
  const root = world.createTextChannel({ id: "chat-root" });
  const thread = world.createThread({ id: "image-thread", parent: root });

  await service.dispatchHarnessResponseToChannel({
    channel: thread as never,
    messageContext: messageContext({
      channel: thread,
      watchLocation: chatWatchLocation(thread.id)
    }),
    response: harnessResponse({
      outcome: "chat_reply",
      public_text: "画像を添付します。"
    }),
    session: harnessSession(),
    knowledgePersistenceScope: null,
    generatedImages: [
      generatedImage({
        id: "image-1",
        filename: "diagram.png",
        data_base64: Buffer.from("fake image bytes").toString("base64")
      })
    ]
  });

  assert.equal(world.sink.sentTexts().filter((text) => text.length > 0)[0], "画像を添付します。");
  assert.deepEqual(
    world.sink.sentFiles().map((file) => file.name),
    ["diagram.png"]
  );
});

test("dispatchHarnessResponseToChannel blocks admin diagnostics without admin feature", async () => {
  const { service, world } = createDispatchHarness();
  const root = world.createTextChannel({ id: "chat-root" });
  const thread = world.createThread({ id: "public-thread", parent: root });

  await service.dispatchHarnessResponseToChannel({
    channel: thread as never,
    messageContext: messageContext({
      channel: thread,
      actorRole: "admin",
      watchLocation: chatWatchLocation(thread.id)
    }),
    response: harnessResponse({
      outcome: "admin_diagnostics",
      public_text: null,
      diagnostics: {
        notes: "private diagnostic note"
      }
    }),
    session: harnessSession(),
    knowledgePersistenceScope: null
  });

  assert.deepEqual(world.sink.sentTexts(), [
    "この場所では管理診断を表示できません。"
  ]);
  assert.equal(
    world.sink.sentTexts().some((text) => text.includes("private diagnostic note")),
    false
  );
  assert.equal(
    world.sink.sentTexts().some((text) => text.includes("codex_thread_id")),
    false
  );
});

function createDispatchHarness(): {
  service: ReplyDispatchService;
  world: FakeDiscordWorld;
} {
  const world = new FakeDiscordWorld();
  const logger = {
    debug: () => {},
    warn: () => {}
  };
  const service = new ReplyDispatchService({
    store: {} as never,
    harnessRunner: {
      persistKnowledgeResult: () => {}
    } as never,
    sessionManager: {
      bindSession: () => {}
    } as never,
    sessionPolicyResolver: {
      resolveKnowledgeThreadConversation: () => ({})
    } as never,
    watchLocations: [],
    logger,
    fetchChannel: async (channelId) => world.getChannel(channelId) as never
  });
  return { service, world };
}

function messageContext(input: {
  channel: FakeDiscordChannel;
  watchLocation: WatchLocationConfig;
  actorRole?: "owner" | "admin" | "user";
}): {
  envelope: MessageEnvelope;
  watchLocation: WatchLocationConfig;
  actorRole: "owner" | "admin" | "user";
  scope: "server_public";
} {
  return {
    envelope: {
      guildId: "guild-1",
      channelId: input.channel.id,
      messageId: "message-1",
      authorId: "user-1",
      placeType: input.channel.isThread() ? "public_thread" : "guild_text",
      rawPlaceType: input.channel.isThread() ? "PublicThread" : "GuildText",
      content: "hello",
      urls: [],
      receivedAt: "2026-05-21T00:00:00.000Z"
    },
    watchLocation: input.watchLocation,
    actorRole: input.actorRole ?? "user",
    scope: "server_public"
  };
}

function chatWatchLocation(channelId: string): WatchLocationConfig {
  return {
    guildId: "guild-1",
    channelId,
    mode: "chat",
    defaultScope: "server_public",
    features: ["conversation"],
    chatBehavior: "directed_help_chat"
  };
}

function harnessSession(): HarnessResolvedSession {
  return {
    threadId: "codex-thread-1",
    startedFresh: false,
    identity: {
      sessionIdentity: "session-1",
      workloadKind: "conversation",
      bindingKind: "thread",
      bindingId: "chat-thread",
      actorId: "user-1",
      sandboxMode: "read-only",
      modelProfile: "test:model",
      runtimeContractVersion: "test-contract",
      lifecyclePolicy: "thread_lifetime"
    }
  };
}

function harnessResponse(
  overrides: Partial<HarnessResponse> & Pick<HarnessResponse, "outcome">
): HarnessResponse {
  const { outcome, ...rest } = overrides;
  return {
    outcome,
    repo_write_intent: false,
    public_text: null,
    reply_mode: "same_place",
    target_thread_id: null,
    selected_source_ids: [],
    sources_used: [],
    knowledge_writes: [],
    diagnostics: {
      notes: null
    },
    sensitivity_raise: "none",
    ...rest
  };
}

function generatedImage(
  overrides: Partial<GeneratedImageArtifact> & Pick<GeneratedImageArtifact, "id">
): GeneratedImageArtifact {
  const { id, ...rest } = overrides;
  return {
    origin: "imageGeneration",
    id,
    status: "completed",
    mime_type: "image/png",
    filename: "image.png",
    data_base64: Buffer.from("image").toString("base64"),
    ...rest
  };
}
