# Behavior Preservation Test Design

## Blocking Issues

- なし。設計は進められる。
- 注意: 現行 characterization には `forum_longform` の未メンション follow-up を無視する挙動があるが、要求 `FOR.01.07` / `FOR.01-07` は forum thread の非 bot かつ non-empty 投稿を毎回応答対象にする。approval evidence は docs 側を正とし、現行挙動は regression 防止対象ではなく差分検出用 characterization として扱う。

## Docs Map

| Source | Authority | Test-relevant facts |
| --- | --- | --- |
| `AGENTS.md` | bot runtime 正本 | same place / public thread / same thread / admin_control の返信先規則、facts-only `available_context`、`task.retry_context` は control plane、blocked/private URL 取得禁止、self-mod は owner/admin 明示依頼のみ。 |
| `implementation/AGENTS.md` | implementation layer guard | System は facts/authority/side effects/DB integrity、Harness は meaning/retrieval/wording。timeout, heuristic routing, forced fallback, semantic retry は boundary review trigger。 |
| `implementation/references/agents-harness-boundary-patterns.md` | Harness boundary reference | `available_context` は facts plane、retry metadata は control plane。reply routing と Discord side effects は System boundary、意味判断は Harness contract。 |
| `docs/VRC-AI-Bot_decisions.md` | decision log | admin diagnostics は明示診断だけ、chat root URL は自動知見化しない、人工 timeout/truncation を避ける、session identity 正本、same-turn public reconfirmation、retry scheduler、forum/feature profile/override 方針。 |
| `implementation/docs/discord-llm-bot-requirements.md` | requirement table | RUN, ING, THR, CHAT, FOR, EVT, SEC, AUTH, ERR, PER のユーザー価値と forbidden states。 |
| `implementation/docs/discord-llm-bot-spec-delta-v0.4.md` | implementation-ready spec | `HarnessRequest` shape、reply outcome、cursor rules、feature profiles、forum high reasoning、output safety, override, retry scheduler, admin diagnostics JSON。 |
| `implementation/docs/forum-longform-exploration-loop.md` | forum research design note | prompt refinement -> supervisor -> workers -> high final。final answer は safety-before-publish、references appendix は別送信、forum retry は visible retry 優先。 |
| Current code around `runtime/message`, `harness`, `domain`, `runtime/forum`, `runtime/admin`, `storage/repositories` | characterization only | 現行 observable path, gaps, and existing private-helper tests. Code does not redefine the specification. |
| Existing `implementation/test/**/*.test.ts` | coverage inventory | Node built-in test runner. Current tests are mostly behavior-unit and narrow integration; no full black-box Discord workflow harness yet. |

## Boundary Owner Table

| Requirement | Owner | Why not the other side |
| --- | --- | --- |
| Reply destination, thread creation, Discord archive/send/reply side effects | System boundary | Harness may choose outcome and wording, but Discord side effects and exact place authority are operational boundaries. |
| Meaning of user request, retrieval strategy, answer wording, source selection | Harness contract | Encoding these in TypeScript would steal semantic responsibility and make legacy mode/channel heuristics brittle. |
| `task.phase`, retry metadata, forum visible recovery state | Control plane | These coordinate execution and must not be mixed into `available_context` facts. |
| Discord place, channel/thread/guild IDs, URL lists, known source URLs, feature list | Facts plane | They are facts for Harness interpretation, not hidden instructions or quality gates. |
| Persistence integrity, migration preservation, cursor monotonicity | System boundary | Data durability and idempotency are DB/operational correctness, not model judgment. |
| Public-source reconfirmation evidence | System boundary + Harness contract | Harness can request/use public research; System only accepts authoritative structured repo-local fetch evidence for same-turn public grounding. |

Stop-trigger list for future implementation: fixed timeout, truncation, semantic fallback, permanent-failure classification, heuristic routing by legacy mode, and quality gating must be reviewed before coding.

## Requirement Ledger

| ID | Requirement | Source | User-observable oracle | Risk if broken | Forbidden state | Technique |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | `url_watch` root URL creates one public knowledge thread and replies there. | `AGENTS.md`, `BOT.01-05-05`, `THR.01-05-01` | User sees one public thread for the original message and the shared summary in that thread. | Duplicate/no thread, wrong place reply, lost knowledge share. | Chat root or thread follow-up creates a public thread. | Black-box E2E + decision table. |
| R2 | chat root URL remains normal conversation and does not auto-ingest. | decision log, `CHAT.01.04`, `CHAT.01-02-03` | User sees same-place chat reply or ignore; no knowledge thread and no knowledge write. | Casual URL paste pollutes shared knowledge. | Public thread or server_public write from chat URL alone. | Black-box E2E + negative test. |
| R3 | knowledge thread follow-up always gets same-thread visible response for non-empty human input. | `THR.01.05a`, `THR.01-05-04`, `SEC.01-05-06` | Follow-up in the existing thread gets a visible reply or generic same-thread failure after retry. | User is silently ignored in a thread. | `ignore`, no_reply, or reply to root. | Integration + negative no-silent test. |
| R4 | final output safety runs before publish. | `SEC.01.04a-b`, `SEC.01-05-05` | Unsafe answer is not posted; one retry is attempted; if still unsafe, same-place refusal is posted. | Private/source-out-of-scope data leaks publicly. | Discord send occurs before safety guard decision. | E2E with instrumented fake Discord send order + integration. |
| R5 | same-turn public reconfirmation is authoritative only from repo-local public fetch output. | `SEC.01.05b`, decision log | Public answer may cite newly observed public URLs only when structured fetch evidence exists. | Model self-claim bypasses source boundary. | `sources_used` accepts skill-like strings or unobserved public URL. | Contract + abuse tests. |
| R6 | feature profile/assignment is canonical; legacy mode is compatibility input only. | 2026-05-21 decision, config tests | Assigning `admin_override`, `knowledge_ingest`, `forum_research` features controls behavior independent of legacy mode labels. | New config silently behaves as old mode/channel heuristic. | Code treats `mode` as primary when feature says otherwise. | Config contract + routing integration. |
| R7 | `admin_diagnostics` is gated to explicit operator diagnostics in admin override places. | decision log, `BOT.01-05-06`, `ERR.01-03-04/05` | Normal admin conversation gets natural chat reply; explicit diagnostics gets JSON code block in same place. | Operators get JSON for ordinary questions or users get diagnostics outside admin place. | `admin_diagnostics` outside admin feature; normal "what is your permission?" becomes diagnostics. | E2E + negative security test. |
| R8 | override workspace-write is dedicated override-thread only and same actor only. | `AUTH.03`, `AUTH.04`, 2026-05-21 decision | Admin command creates admin-control dedicated thread; same actor inside gets workspace-write; origin and other actors remain read-only. | Repo write path leaks into normal Discord conversation. | Non-admin or non-override place switches to workspace-write. | Security E2E + integration. |
| R9 | forum thread longform uses high session continuity and public safety before final publish. | `FOR.01`, forum longform design | Forum post thread gets high-reasoning response in same thread, with visible progress/recovery and safe final; references appendix sent only after safe final. | Longform UX breaks or unsafe public answer leaks. | Parent forum treated as place; unmentioned non-empty follow-up ignored; final posted before safety. | Black-box E2E + state-transition + safety order test. |
| R10 | startup recovery and retry keep cursor monotonicity. | `RUN.01.05`, `RUN.01-04-05a`, `ERR.01-03-01b` | Pending retry/processing duplicate does not advance cursor; completed duplicate can advance. | Messages are skipped or replayed indefinitely. | Cursor advances past pending retry. | Integration + property/monotonic tests. |
| R11 | storage round-trip preserves knowledge, source visibility, override, session, retry, and forum state. | `MEM.01`, `BOT.01-08`, migrations | Fresh DB and migrated DB read back equivalent public contract rows. | Restart loses continuity or leaks visibility. | Legacy `codex_session` used as runtime binding; visibility key lost. | Real SQLite integration + migration fixtures. |
| R12 | migration preservation keeps old data usable only through new contracts. | decision logs, migrations 006/008/012/013 | Old `message_processing` migrates state, old `codex_session` moves to legacy table, new runtime uses `codex_session_binding`. | Upgrade corrupts sessions/retries. | Automatic unsafe resume from legacy sessions. | Migration integration with old-schema fixture. |

## Existing Characterization, Not Specification

These observations describe current behavior to help detect accidental changes during refactor. They are not approval evidence when they conflict with docs.

| Area | Current characterization | Keep as spec? | Notes |
| --- | --- | --- | --- |
| Forum thread service | Starter message handled; mentioned follow-up handled; unmentioned follow-up ignored. | No for unmentioned follow-up. | Conflicts with `FOR.01.07`; keep one characterization test only if labeled legacy-current and expected to be replaced by spec test. |
| Config | Feature profiles already drive assignments; legacy locations accepted and mismatch rejected. | Yes. | Aligns with 2026-05-21 decision. |
| Output safety | Fetchable original URL remains allowed during retry; unrelated cited URL triggers retry. | Yes, but incomplete. | Needs publish-order and public reconfirmation abuse cases. |
| Reply dispatch | Public thread creation only for `url_watch` root with evidence; thread messages stay same place. | Yes. | Needs end-to-end Discord side-effect oracle. |
| Startup recovery | Non-chat replays backlog; chat seeds/advances cursors without replaying backlog. | Partly. | Need cursor monotonicity with `message_processing` state, not only fetch order. |
| Admin diagnostics | Tests locate admin target by feature. | Partly. | Need Harness outcome gate and normal admin chat negative case. |

## Test Scale Decision

This refactor needs a layered suite:

| Scale | Required? | Rationale | Approval evidence? |
| --- | --- | --- | --- |
| Black-box Discord E2E | Yes | Core value is observed through Discord message intake, reply place, thread creation, and side effects. Smaller tests can pass while users see wrong threads or no reply. | Yes for R1, R2, R3, R4, R7, R8, R9. |
| Narrow integration with real SQLite | Yes | Cursor, retry, migration, session, visibility, and storage round-trip depend on real DB schema and transactions. | Yes for R10, R11, R12. |
| Behavior unit tests | Yes | Deterministic rules like feature assignment, safety source classification, routing decision tables, and engagement facts should be fast and focused. | Supporting, except config contract cases. |
| Contract/schema tests | Yes | `HarnessRequest`, `HarnessResponse`, migration rows, and public fetch evidence are downstream contracts. | Yes for source safety and migration boundaries. |
| State-transition tests | Yes | Forum research, retry lifecycle, override start/use/close, and cursor state are transitions with forbidden states. | Yes where E2E is expensive. |
| Security/abuse tests | Yes | Public safety, admin gate, override, SSRF/blocked URL, and private-source leakage are high-risk. | Yes. |
| Characterization tests | Yes, labeled | Useful during large rewrite, but cannot define correctness when docs disagree. | No. |
| Architecture/fitness tests | Yes | System/Harness boundary and write-scope rules are explicit repo constraints. | Supporting guard. |

## Technique Selection

| Risk | Technique | Representative cases |
| --- | --- | --- |
| Reply destination | Workflow examples + decision table | chat root, url_watch root, knowledge thread, forum post thread, admin_control root, override thread. |
| Safety-before-publish | Temporal oracle with fake Discord sink | Record `safety_evaluate`, `retry_turn`, `send_message`, `create_thread`; assert no send/create before allow/refusal. |
| Feature policy vs legacy mode | Equivalence classes | New feature assignment, legacy mode-only, mismatched legacy, duplicate assignment, feature-mode conflict. |
| Admin diagnostics gate | Decision table | Explicit diagnostics in admin feature, normal permission question in admin feature, diagnostics outside admin feature, non-admin command. |
| Forum recovery | State transitions | prompt refinement -> supervisor -> workers -> final -> safety -> send; final timeout/protocol error -> visible retry -> final/refusal. |
| Cursor monotonicity | Property/invariant | Cursor never moves backward; pending retry/processing duplicate never advances; completed duplicate may advance to that message. |
| Storage round-trip | Contract fixtures | Create/write/read/close/reopen for knowledge/source/visibility/session/override/retry/forum state. |
| Migration preservation | Golden fixtures | Apply migrations from old schemas with representative rows and assert new tables/legacy isolation. |
| Public safety abuse | Negative cases | blocked URL, private IP, unknown source id, private record, skill-name pseudo-source, self-claimed public reconfirmation. |

## Approval Evidence

These are the tests that may be cited as "done" for behavior preservation.

| Test ID | Name | Cadence | Given / When / Then | Real boundary required |
| --- | --- | --- | --- | --- |
| AE-E2E-01 | url_watch root public ingest creates one public thread safely | default or slow | Given URL in configured knowledge place, when Harness returns safe `knowledge_ingest`, then one public thread is created, reply is sent in that thread, knowledge write handoff uses allowed scope, cursor completes after send. | Fake Discord adapter is allowed, but must record real side-effect order; real SQLite required. |
| AE-E2E-02 | chat root URL does not create public thread or knowledge write | default | Given same URL in chat place, when Harness replies, then same-place response/ignore only; no thread create; no knowledge persistence. | Fake Discord + real SQLite. |
| AE-E2E-03 | knowledge thread follow-up is never silent | default | Given existing source-linked thread and non-empty human follow-up, when Harness returns ignore/no_reply/empty, then one retry is attempted and final visible same-thread response or generic failure is sent. | Fake Harness with scripted outcomes; fake Discord sink. |
| AE-E2E-04 | output safety blocks publish before Discord side effect | default | Given out-of-scope `sources_used`, when response is ready, then no `send` or `createThread` occurs before safety retry/refusal; final refusal goes same place. | Instrumented fake Discord sink; real OutputSafetyGuard. |
| AE-E2E-05 | admin diagnostics are explicit and place-gated | default | Given admin_control feature place, normal permission question returns `chat_reply`; explicit diagnostics returns diagnostics JSON; same request outside admin feature is not diagnostics. | Fake Harness outcomes + dispatch path. |
| AE-E2E-06 | override start/use/close keeps write scope thread-local | slow | Admin command from configured place creates dedicated admin thread; same actor in thread gets workspace-write; origin place and other actor stay read-only; close archives thread/session. | Fake Discord command API + real SQLite session/override repos. |
| AE-E2E-07 | forum final safety-before-publish and recovery | slow/nightly | Forum post with public research goes through progress, final synthesis, safety, final reply, reference appendix; unsafe final triggers visible retry/refusal before publish. | Fake Codex pipeline acceptable, but publish-order oracle and real SQLite forum state required. |
| AE-DB-01 | cursor and retry lifecycle monotonicity | default | For acquired/pending_retry/processing/completed duplicates, cursor advances only after completed or terminal notified failure; never backward. | Real SQLite repository. |
| AE-DB-02 | storage round-trip public contracts | default | Write knowledge/source links/session binding/override/retry/forum state, close/reopen DB, read equivalent rows and visibility selectors. | Real SQLite. |
| AE-MIG-01 | migration preservation from legacy schemas | default | Apply migrations over old `codex_session`, old `message_processing`, forum v1 state fixtures, then assert legacy isolation and new contract rows. | Real migration runner on temp DB. |

## Supporting Tests

| Test | What it proves | What it does not prove |
| --- | --- | --- |
| Feature profile config contract | Config loader rejects mismatches and assigns features before channel behavior. | Does not prove runtime routes by feature. |
| Routing decision table | `knowledge_ingest` routing maps thread/root/mode/features to expected target kind. | Does not prove Discord thread creation occurs exactly once. |
| Harness request contract | `available_context` contains place features, delivery facts, URL facts; retry metadata only in `task.retry_context`. | Does not prove final Discord side effects. |
| Capability resolver table | grants external fetch/write/moderation only from factual gates and override context. | Does not prove Codex receives the right sandbox. |
| OutputSafetyGuard source matrix | accepts visible record/public observed URL and rejects blocked/out-of-scope source. | Does not prove publish ordering. |
| Session policy matrix | workload/binding/sandbox/model profile identities are stable. | Does not prove App Server resume behavior. |
| Forum pipeline unit state cases | supervisor worker constraints, prompt artifact refresh, source catalog dedupe. | Does not prove user-visible forum recovery. |
| Admin command unit cases | permission checks, command place rules, thread name/copy behavior. | Does not prove workspace-write scope through message processing. |

## Negative Tests

| Category | Forbidden state | Expected result |
| --- | --- | --- |
| Public safety | `sources_used` includes blocked URL, localhost, private IP, unknown record id, private record, or unobserved public URL. | Retry once if eligible, then same-place refusal; no public send before allow/refusal. |
| Forum final | Final answer is sent before output safety passes. | Test fails on event order. |
| Forum follow-up | Non-empty forum post thread follow-up is ignored solely because no mention. | Spec E2E fails; this is not acceptable approval behavior. |
| Feature policy | Feature assignment says `knowledge_ingest` but legacy mode says chat and runtime follows mode. | Config or runtime routing test fails. |
| Admin diagnostics | Normal admin_control conversation becomes diagnostics JSON. | E2E expects natural `chat_reply`. |
| Override | Non-admin, wrong actor, origin place, or closed override thread gets workspace-write. | Sandbox/capability oracle remains read-only/false. |
| Cursor | Pending retry duplicate advances cursor. | Integration test fails. |
| Migration | `codex_session_legacy` is used to resume new runtime session. | Migration/session test fails. |
| Persistence | `conversation_only` source is visible from `server_public` without public reconfirmation. | Visibility contract test fails. |

## Mock/Fake Policy

May fake:

- Discord client/API with an event-recording adapter for messages, replies, thread create/archive, reactions, typing, and interaction replies. Reason: Discord itself is nondeterministic and expensive; the oracle is user-observable side effects and order.
- Codex App Server/Harness with scripted intent/answer/retry outcomes. Reason: test target is bot runtime behavior, not model quality.
- Public fetch script result as a structured fixture only when testing System acceptance of reconfirmation evidence.
- Time/clock for retry, weekly announcement, and migration timestamps.

Must be real:

- SQLite migrations and repositories for approval tests involving cursor, retry, session, override, knowledge visibility, forum state, and storage round-trip.
- URL safety classifier for blocked/public URL boundaries.
- OutputSafetyGuard for approval tests about source leakage and safety-before-publish.
- Session identity construction for sandbox/model/profile continuity.

Cannot cite as done:

- Tests that assert private helper names or call counts without Discord-observable side effects.
- Pure snapshot tests of Harness JSON shape without side-effect or forbidden-state assertions.
- Fake DB maps for cursor, migration, round-trip, or persistence integrity approval.
- Characterization tests that preserve current behavior when docs define a different oracle.

## Red-First Plan

1. `AE-E2E-04` safety-before-publish first. Expected red: current tests do not observe Discord send/create order around output safety; unsafe final can be missed by helper-level tests.
2. `AE-E2E-07` forum final safety/recovery. Expected red: current suite only tests small forum helpers and prompt-artifact refresh, not final publish order, visible recovery, or references appendix sequencing.
3. `AE-E2E-03` knowledge thread non-silent follow-up. Expected red: helper normalization exists, but no full message-to-reply workflow proves same-thread visible output after no_reply/ignore.
4. `AE-E2E-05` admin diagnostics gate. Expected red: current tests find admin feature target, but do not prove normal admin chat avoids diagnostics JSON.
5. `AE-E2E-02` chat root URL no auto-ingest. Expected red: routing helpers exist, but no workflow asserts absence of thread creation and persistence.
6. `AE-DB-01` cursor monotonicity over real `message_processing`. Expected red: startup recovery tests use fake store and do not combine processing state with cursor update.
7. `AE-DB-02` storage round-trip. Expected red: no broad repository round-trip covering knowledge visibility/session/override/retry/forum state together.
8. `AE-MIG-01` migration preservation. Expected red: no golden old-schema fixture proves migration from legacy tables.

## First Failing Test Commands

Initial focused commands for the implementation worker:

```powershell
pnpm test -- implementation/test/e2e/discord-behavior-preservation.test.ts
pnpm test -- implementation/test/integration/storage-roundtrip.test.ts
pnpm test -- implementation/test/integration/migration-preservation.test.ts
pnpm test -- implementation/test/integration/cursor-retry-monotonicity.test.ts
```

Existing suite safety net:

```powershell
pnpm test
pnpm typecheck
```

If the worker keeps tests under current folders instead of adding `e2e` / `integration`, preserve the test IDs in test names so approval evidence remains traceable.

## Implementation Boundaries And Allowed Side Effects

Allowed for test implementation:

- Add tests under `implementation/test/**`.
- Add test-only fake Discord/Harness adapters under `implementation/test/support/**`.
- Add migration fixture SQL/JSON under `implementation/test/fixtures/**`.
- Use temp directories and temp SQLite DBs created during tests.
- Run `pnpm test` and `pnpm typecheck`.

Not allowed without a separate implementation task:

- Change production code while writing the red tests.
- Read host-side personal `.codex`, `.claude`, OAuth, or external conversation history.
- Use Discord network side effects in default tests.
- Make tests assert private helper names as the approval oracle.
- Encode new System semantic heuristics to make tests pass.

Architecture guard for future implementation:

- System-side tests may assert facts, authority, side effects, DB I/O, safety, and persistence integrity.
- Harness-side tests may assert structured contract inputs/outputs and semantic freedom, not TypeScript meaning shortcuts.
- `available_context` assertions must stay facts-only; retry/safety regeneration assertions belong under `task.retry_context`.

## Worker Split Plan

| Worker | Scope | Files expected | Approval tests |
| --- | --- | --- | --- |
| E2E workflow worker | Fake Discord adapter, black-box message/command workflows, side-effect order oracle. | `implementation/test/e2e/discord-behavior-preservation.test.ts`, `implementation/test/support/fake-discord.ts`, `implementation/test/support/scripted-harness.ts` | AE-E2E-01..07 |
| Storage worker | Real SQLite round-trip, cursor/retry lifecycle, migration fixtures. | `implementation/test/integration/storage-roundtrip.test.ts`, `cursor-retry-monotonicity.test.ts`, `migration-preservation.test.ts`, fixtures | AE-DB-01, AE-DB-02, AE-MIG-01 |
| Contract/safety worker | Harness request/response contract, output safety matrix, public reconfirmation abuse cases. | Existing harness tests plus new contract tests | R4, R5 supporting and negative coverage |
| Boundary/architecture worker | Import/layer checks and facts/control-plane assertions. | `implementation/test/architecture/*.test.ts` | Supporting architecture-fitness |
| Characterization worker | Current behavior snapshots labeled `characterization`, excluding doc-conflicting behavior from approval. | `implementation/test/characterization/*.test.ts` | Non-approval only |

Recommended sequence: E2E workflow worker and Storage worker can start first in parallel. Contract/safety worker should coordinate with E2E on shared fake Harness response shapes. Boundary worker should run after the first red tests define intended public seams.
