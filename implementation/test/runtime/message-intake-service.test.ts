import test from "node:test";
import assert from "node:assert/strict";

import { shouldShowProcessingUi } from "../../src/runtime/message/processing-visibility.js";

test("ambient room chat does not add a processing reaction", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "ambient_room_chat"
      },
      chatEngagement: {
        trigger_kind: "ambient_room",
        is_directed_to_bot: false,
        sparse_ordinal: null,
        ordinary_message_count: null
      }
    }),
    false
  );
});

test("sparse chat does not add a processing reaction", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "directed_help_chat"
      },
      chatEngagement: {
        trigger_kind: "sparse_periodic",
        is_directed_to_bot: false,
        sparse_ordinal: 5,
        ordinary_message_count: 5
      }
    }),
    false
  );
});

test("directed chat adds a processing reaction", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        chatBehavior: "ambient_room_chat"
      },
      chatEngagement: {
        trigger_kind: "reply_to_bot",
        is_directed_to_bot: true,
        sparse_ordinal: null,
        ordinary_message_count: null
      }
    }),
    true
  );
});

test("non-chat modes keep the processing reaction", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "forum_longform",
        defaultScope: "server_public",
        chatBehavior: null
      },
      chatEngagement: null
    }),
    true
  );
});
