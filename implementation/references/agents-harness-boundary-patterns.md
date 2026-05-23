# Agents Harness Boundary Patterns

This reference is the pre-edit gate for Harness-adjacent changes in this
repository. Read it in the same turn before editing orchestration, retries,
timeouts, planner/worker/final decomposition, prompt shaping, context shaping,
routing, evidence flow, Discord intake, or admin override behavior.

The repository-root `AGENTS.md` is the canonical bot-runtime contract.
`implementation/AGENTS.md` and this file are implementation-layer guardrails for
repo investigation and code changes.

## Boundary Split

| Area | Owner | Allowed responsibility |
| --- | --- | --- |
| Facts, authority, scope, visibility, side effects, DB I/O, persistence integrity, sandboxing, safety, hard deadlines | System boundary | Enforce real operational boundaries and provide accurate facts. |
| Meaning, intent, retrieval strategy, source selection, decomposition, wording, summarization, translation, answer structure | Harness contract | Give the model enough contract and context to make semantic decisions. |
| Retry metadata, budgets, task phase, orchestration state | Control plane | Coordinate execution without mixing control state into user-visible facts. |
| Discord place, message, thread, guild, channel, URL, known source, history, and capability facts | Facts plane | Stay facts-only; do not include retry or safety regeneration instructions. |

## Pre-Edit Sequence

1. Classify every intended change as `System boundary`, `Harness contract`,
   `control plane`, or `facts plane`.
2. Write an owner table using:

   `requirement | owner | why not the other side`

3. If the owner is `Harness contract`, solve the issue through prompt contract,
   worker contract, skill contract, or structured model I/O.
4. If the owner is `System boundary`, justify it with concrete authority,
   visibility, side effect, persistence, sandboxing, safety, or deadline terms.
5. Treat timeout, truncation, forced fallback, permanent failure classification,
   heuristic routing, and quality gating as stop triggers.
6. After editing, run the review checklist below before declaring the change
   complete.

## Stop Triggers

Stop and redesign before coding if the proposed fix does any of these:

- makes TypeScript decide user intent, answer quality, task difficulty, or
  finality;
- adds a fixed timeout or token threshold because a step "should be light";
- treats `done`, short output, or a timeout as proof that the answer is good;
- routes semantically different work by channel name when a feature contract or
  place capability is the real boundary;
- moves retry, safety regeneration, or planning hints into `available_context`;
- converts an LLM quality complaint into a System branch instead of a Harness
  contract improvement.

## Accepted System Fixes

System-side changes are acceptable when they only enforce operational facts and
boundaries, for example:

- Discord authority checks and allowed-place checks;
- exact reply destination mechanics after the Harness has chosen an outcome;
- persistence integrity and idempotency;
- separating facts plane from control plane;
- collecting factual thread history without interpreting the user's meaning;
- exposing feature capabilities independently from Discord channel identity.

## Rejected Thick-System Fixes

Do not implement these as host-code shortcuts:

- choosing retrieval queries from hard-coded keyword branches;
- deciding that a follow-up is "minor" or "major" from message length;
- forcing final answers because a worker timed out;
- suppressing a discussion because the System thinks the previous answer was
  sufficient;
- using Discord channel identity as the primary abstraction when the real
  abstraction is a feature capability, engagement policy, or reply policy.

## Post-Edit Review Checklist

- Did the change keep System limited to facts, boundaries, side effects, and
  integrity?
- Did any semantic choice move from the Harness into TypeScript?
- Did any fixed constant become a proxy for quality, difficulty, or user intent?
- Did `available_context` remain facts-only?
- Did the change preserve Harness freedom to interpret the user's latest
  request with the relevant conversation context?
- If the change touched Discord intake or reply routing, is the destination rule
  still explicit and test-covered?

If any answer indicates Harness responsibility was stolen by System logic, reject
the patch and redesign at the contract level first.
