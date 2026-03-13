import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceReply,
  extractReferenceUrls
} from "../src/runtime/message/reply-dispatch-service.js";

test("extractReferenceUrls keeps public URLs in citation order and drops non-public markers", () => {
  assert.deepEqual(
    extractReferenceUrls([
      "src-public",
      "https://example.com/a",
      "file:///tmp/private.txt",
      "https://example.com/b#section",
      "https://example.com/a"
    ]),
    ["https://example.com/a", "https://example.com/b"]
  );
});

test("buildReferenceReply formats forum references as numbered lines", () => {
  assert.equal(
    buildReferenceReply([
      "https://example.com/a",
      "https://example.com/b"
    ]),
    "[1]: https://example.com/a\n[2]: https://example.com/b"
  );
});
