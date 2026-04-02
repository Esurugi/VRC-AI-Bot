import test from "node:test";
import assert from "node:assert/strict";

import { HARNESS_DEVELOPER_INSTRUCTIONS } from "../../src/codex/app-server-client.js";

test("harness instructions explain ambient room chat handling", () => {
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /available_context\.chat_engagement/);
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /available_context\.place_context/);
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /is_knowledge_place/);
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /available_context\.delivery_context/);
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /is_bot_directed/);
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /chat_behavior/);
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /recent_room_events/);
  assert.doesNotMatch(HARNESS_DEVELOPER_INSTRUCTIONS, /recent_messages/);
  assert.match(HARNESS_DEVELOPER_INSTRUCTIONS, /ambient_room_chat/);
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /do not assume the current message is directed at the bot/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /return ignore when it looks aimed at another participant/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /what the current message is reacting to/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /prefer a short grounded in-room reply over ignore/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /頼まれていない提案や任意の次アクション提案を足しすぎない/
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /内部実装ロジックやランタイム内部事情を自分から説明しない/
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /do not include that URL in sources_used or knowledge_writes unless you established same-turn public reconfirmation/
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /place\.mode is url_watch and the shared item likely cannot be understood from the pasted URL alone/
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /do not stop at the pasted URL when it yields only a shell page, login wall, embed wrapper, or too little text/
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /keep the research tightly anchored to the specific shared post, article, video, release, or announcement/
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /grounding on that URL alone is acceptable when it is sufficient.*narrowly related public research instead of forcing a weak summary/
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /ignore is model-owned/i
  );
  assert.match(
    HARNESS_DEVELOPER_INSTRUCTIONS,
    /knowledge-owned place/i
  );
});
