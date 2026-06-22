import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPublicSourceText,
  fetchPublicSource
} from "../../src/knowledge/public-source-fetch.js";

test("public source fetch exposes FxTwitter status text for Harness reading", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: {
          text: "Subagents are now available in Codex.",
          author: {
            name: "OpenAI Developers",
            screen_name: "OpenAIDevs"
          }
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );

  try {
    const result = await fetchPublicSource(
      "https://api.fxtwitter.com/2/status/2033636701848174967"
    );

    assert.equal(result.public, true);
    assert.equal(result.status, 200);
    assert.equal(
      result.canonicalUrl,
      "https://api.fxtwitter.com/2/status/2033636701848174967"
    );
    assert.equal(result.title, "OpenAI Developers (@OpenAIDevs)");
    assert.equal(
      result.text,
      "OpenAI Developers (@OpenAIDevs):\nSubagents are now available in Codex."
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public source fetch still rejects non-public URLs before fetching", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return new Response("unexpected");
  };

  try {
    await assert.rejects(
      fetchPublicSource("http://127.0.0.1/status/2033636701848174967"),
      /not a public HTTP\(S\) URL/
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public source fetch returns structured non-ok results for fallback decisions", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("not found", {
      status: 404,
      headers: {
        "content-type": "text/plain"
      }
    });

  try {
    const result = await fetchPublicSource(
      "https://api.fxtwitter.com/2/status/1518621477971165195"
    );

    assert.equal(result.public, true);
    assert.equal(result.status, 404);
    assert.equal(result.title, null);
    assert.equal(result.text, "not found");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public source fetch treats Jina target errors as non-ok evidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      "Title: ?\nURL Source: https://x.com/i/web/status/1518621477971165195\nWarning: Target URL returned error 404: Not Found\nMarkdown Content: ## Nothing to see here",
      {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      }
    );

  try {
    const result = await fetchPublicSource(
      "https://r.jina.ai/https://x.com/i/web/status/1518621477971165195"
    );

    assert.equal(result.public, true);
    assert.equal(result.status, 404);
    assert.match(result.text ?? "", /Nothing to see here/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public source text extraction keeps generic JSON text fields bounded", () => {
  const extracted = extractPublicSourceText(
    JSON.stringify({
      title: "Example title",
      description: "Example description",
      nested: {
        text: "Example body"
      }
    }),
    "application/json"
  );

  assert.deepEqual(extracted, {
    title: "Example title",
    text: "Example title\nExample description\nExample body"
  });
});
