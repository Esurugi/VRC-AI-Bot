import assert from "node:assert/strict";
import test from "node:test";
import { extractPublicSourceText, fetchPublicSource } from "../../src/knowledge/public-source-fetch.js";
import { decodeJson3Transcript, selectCaptionTrack } from "../../src/knowledge/public-source/youtube-transcript.js";

test("public source fetch exposes provider text and failed HTTP status without conflating them", async () => {
  const url = "https://api.fxtwitter.com/2/status/2033636701848174967";
  const result = await fetchPublicSource(url, async () => ({ finalUrl: url, status: 200, contentType: "application/json", body: JSON.stringify({ status: { text: "Subagents are now available in Codex.", author: { name: "OpenAI Developers", screen_name: "OpenAIDevs" } } }) }));
  assert.equal(result.title, "OpenAI Developers (@OpenAIDevs)");
  assert.equal(result.text, "OpenAI Developers (@OpenAIDevs):\nSubagents are now available in Codex.");
  const jina = "https://r.jina.ai/https://x.com/i/web/status/1518621477971165195";
  const failed = await fetchPublicSource(jina, async () => ({ finalUrl: jina, status: 200, contentType: "text/plain", body: "Warning: Target URL returned error 404: Not Found\nNothing to see here" }));
  assert.equal(failed.status, 404);
  assert.match(failed.text!, /Nothing to see here/);
});

test("HTML script truncation cannot become source text and long text retains its ending", () => {
  assert.equal(extractPublicSourceText("<title>Video</title><body><script>ytBootstrapConfig = secret", "text/html").text, "Video");
  const body = "研究の説明。".repeat(2000) + "最終節の重要な条件";
  assert.equal(extractPublicSourceText(body, "text/plain").text, body);
  assert.equal(extractPublicSourceText("%PDF", "application/pdf").text, null);
});

test("YouTube uses original creator captions before automatic captions and preserves times", () => {
  const track = { ext: "json3", url: "https://www.youtube.com/api/timedtext?v=cqwKceUSZ5Q" };
  const metadata = { id: "cqwKceUSZ5Q", language: "ar", formats: [{ language: "en-US", language_preference: 10 }], subtitles: { en: [track] }, automatic_captions: { "ar-orig": [track], "en-orig": [track], ja: [track] } };
  assert.deepEqual(selectCaptionTrack(metadata), { track, language: "en", automatic: false });
  assert.deepEqual(selectCaptionTrack({ ...metadata, subtitles: {} }), { track, language: "en", automatic: true });
  assert.equal(selectCaptionTrack({ id: metadata.id }), null);
  assert.equal(selectCaptionTrack({ id: metadata.id, language: "en", subtitles: { ja: [track] } }), null);
  assert.equal(decodeJson3Transcript(JSON.stringify({ events: [{ tStartMs: 61500, segs: [{ utf8: "Learning " }, { utf8: "from context." }] }] })), "[0:01:01] Learning from context.");
});
