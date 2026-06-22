# Typed Public Evidence Pipeline Test Design

## Docs Map

- Root `AGENTS.md`: `available_context` is facts-only; blocked/private URLs must not be fetch targets; public source evidence must be established before citation or persistence.
- `implementation/AGENTS.md`: evidence flow touches Harness/System boundary, so System may enforce facts and persistence integrity while Harness owns retrieval strategy and source selection.
- `implementation/references/agents-harness-boundary-patterns.md`: fallback and evidence acceptance are stop triggers; tests must fix observable contracts, not encode semantic meaning heuristics.
- User requirement for this task: remove legacy public URL compatibility fields and use typed evidence fields.

## Requirement Ledger

- X status URLs keep `original_url`; canonical item identity is query-free `x.com/.../status/{id}`.
- `fxtwitter.com`, `fixupx.com`, `vxtwitter.com`, and `twitter.com` status URLs become `x_status` resources with x.com canonical identity.
- `buildHarnessRequest` must emit only the typed public evidence fields.
- With `allow_external_fetch=true`, answer phase fetches readable candidates prepared by System; empty/error retrieval results become failures, not facts.
- Jina facts keep `canonical_item_url` as x.com and `retrieval_url` as r.jina.ai.
- If all candidates fail, facts are empty and failures preserve each attempted retrieval.
- `knowledge_writes` that store summary or normalized text require `evidence_fact_ids` resolving to non-empty `public_source_facts.text`.
- Blocked/private URLs produce no admissions, resources, candidates, facts, or fetch attempts.

## Test Scale And Technique

- Contract tests for `buildHarnessRequest` because downstream Harness consumers observe the request shape.
- Narrow integration-style runner tests with a fake public source fetcher because the observable behavior is candidate ordering, fallback, and facts/failures attachment.
- Safety and persistence negative tests because candidate-only or empty evidence is a forbidden state.

## Mock/Fake Policy

- Network fetching is faked in runner tests so the default suite remains deterministic.
- The fake may vary status, content type, title, and text; it must not bypass candidate ordering or facts/failures construction.
- SQLite remains real in safety and persistence tests because persistence integrity is the boundary under test.

## Red-First Plan

- The new tests are expected to be red until production no longer emits legacy URL arrays and records typed failures.
- Red failures in safety/persistence are expected until `evidence_fact_ids` are validated against non-empty `public_source_facts`.
