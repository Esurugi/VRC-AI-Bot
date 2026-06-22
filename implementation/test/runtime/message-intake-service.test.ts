import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldShowProcessingReaction,
  shouldShowProcessingUi
} from "../../src/runtime/message/processing-visibility.js";

test("ambient room chat trigger does not add a processing reaction", () => {
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

test("question marker trigger does not add a processing reaction", () => {
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
        trigger_kind: "question_marker",
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

test("forum feature keeps the processing reaction even when legacy mode says chat", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        features: ["forum_research", "conversation"],
        chatBehavior: null
      },
      chatEngagement: null
    }),
    true
  );
});

test("clear explanation feature keeps the processing reaction in dedicated threads", () => {
  assert.equal(
    shouldShowProcessingReaction({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "chat",
        defaultScope: "server_public",
        features: ["clear_explanation", "conversation"],
        chatBehavior: null
      },
      chatEngagement: null
    }),
    true
  );
});

test("conversation feature uses chat visibility even when legacy mode says url watch", () => {
  assert.equal(
    shouldShowProcessingUi({
      watchLocation: {
        guildId: "g1",
        channelId: "c1",
        mode: "url_watch",
        defaultScope: "conversation_only",
        features: ["conversation"],
        chatBehavior: "ambient_room_chat"
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
