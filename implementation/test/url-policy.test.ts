import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeUrl,
  isAllowedPublicHttpUrl
} from "../src/playwright/url-policy.js";

test("isAllowedPublicHttpUrl accepts public http and https URLs", () => {
  assert.equal(isAllowedPublicHttpUrl("https://example.com/path?q=1"), true);
  assert.equal(isAllowedPublicHttpUrl("http://93.184.216.34/"), true);
});

test("isAllowedPublicHttpUrl rejects localhost, private addresses, .local hosts, and non-http schemes", () => {
  assert.equal(isAllowedPublicHttpUrl("https://localhost/test"), false);
  assert.equal(isAllowedPublicHttpUrl("https://127.0.0.1/test"), false);
  assert.equal(isAllowedPublicHttpUrl("https://192.168.0.10/test"), false);
  assert.equal(isAllowedPublicHttpUrl("https://printer.local/test"), false);
  assert.equal(isAllowedPublicHttpUrl("mailto:test@example.com"), false);
  assert.equal(isAllowedPublicHttpUrl("file:///tmp/test.txt"), false);
});

test("canonicalizeUrl removes hash while keeping query", () => {
  assert.equal(
    canonicalizeUrl("https://example.com/path?q=1#section"),
    "https://example.com/path?q=1"
  );
});
