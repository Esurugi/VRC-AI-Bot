---
name: public-source-fetch
description: Establish same-turn public reconfirmation for a public URL in VRC-AI-Bot. Use whenever you need to turn a public URL into authoritative same-turn evidence for System, especially when the URL is not already in fetchable_public_urls but you need to cite it safely in the current answer.
---

# Public Source Fetch

Use this skill only to establish same-turn public reconfirmation for a public URL.

This is not a general web-research skill. Its purpose is narrower:
- confirm that one public HTTP(S) URL is fetchable right now
- return structured JSON that System can observe as authoritative evidence
- stay inside the existing public-URL boundary

## When to use it

Use this skill when all are true:
1. You need to cite a public URL as a source in the current turn.
2. That URL is not already present in `available_context.fetchable_public_urls`.
3. You want System to recognize it as same-turn public reconfirmation.

Do not use this skill for:
- blocked URLs
- localhost, private IP, `.local`, `file:`, `data:`, `javascript:`
- broad web search
- Discord facts
- DB reads

## Command

Run this from the repo root:

```bash
node --import tsx .agents/skills/public-source-fetch/scripts/fetch-public-source.ts --url "<public-url>"
```

The script is read-only. It fetches the URL, follows redirects, and prints structured JSON.

## Output

Successful output shape:

```json
{
  "requestedUrl": "https://openai.com/index/harness-engineering/",
  "finalUrl": "https://openai.com/index/harness-engineering/",
  "canonicalUrl": "https://openai.com/index/harness-engineering/",
  "public": true,
  "status": 200
}
```

How to use it:
- cite `canonicalUrl` or `finalUrl` in `sources_used` when appropriate
- treat this script output as the only formal route for same-turn public reconfirmation
- do not claim that System fetched it unless this script actually ran successfully

## Golden Path

1. Read `available_context.fetchable_public_urls` and `available_context.blocked_urls`.
2. If the URL is already in `fetchable_public_urls`, you usually do not need this skill.
3. If the URL is not already approved but is still public and relevant, run the script once.
4. Use the returned JSON as current-turn public evidence.
5. Continue the answer without broadening scope.

## Never

- Never use this skill for blocked or private URLs.
- Never treat your own wording as reconfirmation.
- Never use unofficial tools or random shell commands for reconfirmation when this script is enough.
