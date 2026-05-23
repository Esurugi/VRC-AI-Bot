import test from "node:test";
import assert from "node:assert/strict";

import { resolveScope } from "../../src/discord/facts.js";

test("admin override feature forces conversation-only scope independent of mode", () => {
  assert.equal(
    resolveScope(
      createMessage({
        privateThread: false
      }) as never,
      {
        guildId: "guild",
        channelId: "ops-root",
        mode: "chat",
        features: ["admin_override", "conversation"],
        defaultScope: "server_public",
        chatBehavior: "directed_help_chat"
      }
    ),
    "conversation_only"
  );
});

test("private threads stay conversation-only without admin override", () => {
  assert.equal(
    resolveScope(
      createMessage({
        privateThread: true
      }) as never,
      {
        guildId: "guild",
        channelId: "root",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "ambient_room_chat"
      }
    ),
    "conversation_only"
  );
});

function createMessage(input: { privateThread: boolean }) {
  return {
    channel: {
      type: input.privateThread ? 12 : 0
    }
  };
}
