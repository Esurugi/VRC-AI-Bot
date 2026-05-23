import test from "node:test";
import assert from "node:assert/strict";

import { ChatRuntimeControlService } from "../../../src/runtime/chat/chat-runtime-control-service.js";

test("chat runtime controls apply to conversation feature even when legacy mode says url watch", () => {
  const service = new ChatRuntimeControlService({
    enabled: false,
    enabledChannelIds: ["chat-root"]
  });

  assert.equal(
    service.isEnabled({
      message: createMessageDouble("chat-root"),
      watchLocation: {
        guildId: "guild",
        channelId: "chat-root",
        mode: "url_watch",
        defaultScope: "conversation_only",
        features: ["conversation"],
        chatBehavior: "ambient_room_chat"
      }
    }),
    false
  );
});

test("chat runtime controls do not disable forum feature when legacy mode says chat", () => {
  const service = new ChatRuntimeControlService({
    enabled: false,
    enabledChannelIds: []
  });

  assert.equal(
    service.isEnabled({
      message: createMessageDouble("forum-root"),
      watchLocation: {
        guildId: "guild",
        channelId: "forum-root",
        mode: "chat",
        defaultScope: "server_public",
        features: ["forum_research", "conversation"],
        chatBehavior: null
      }
    }),
    true
  );
});

function createMessageDouble(channelId: string) {
  return {
    channelId,
    channel: {
      id: channelId,
      isThread: () => false
    }
  } as never;
}
