`implementation/AGENTS.md` stores implementation-facing repository rules.
The repository-root `AGENTS.md` remains the canonical bot-runtime harness.

## Scope
- This file defines how the bot is implemented, reviewed, and modified under `implementation/`.
- Read this file only when the override layer authorizes repo investigation or code changes.
- Outside the override layer, do not surface `implementation/` internals in responses unless the user explicitly asks for them.
- Even when this file is in scope, keep response content focused on the requested outcome. Do not volunteer internal logic explanations unless asked.

## Boundary Principle
- System owns facts, authority, scope/visibility boundaries, Discord side effects, DB I/O, persistence integrity, sandboxing, and safety rules.
- Harness owns meaning interpretation, retrieval strategy, save intent, source selection, wording, summarization, and translation.
- System must stay thin. Do not add heuristic meaning interpretation to TypeScript when the same judgment belongs to the model.
- If a new mechanism makes System decide intent, query wording, or semantic routing, treat that as a design smell and justify it explicitly.
- Before changing Harness/System boundaries, runtime contracts, skills, or context shaping, read `references/agents-harness-boundary-patterns.md` and follow it as a Harness-facing reference.

## Mandatory Boundary Gate
- The boundary reference is not optional guidance. When a change touches Harness/System boundaries, runtime contracts, retry policy, timeout policy, forum orchestration, codex/app-server integration, message processing, or reply routing, read `references/agents-harness-boundary-patterns.md` in the same turn before editing.
- Before coding those changes, explicitly classify each intended change as one of `System boundary`, `Harness contract`, `control plane`, or `facts plane`.
- If that classification is not written down in working notes or a user update yet, stop and do it before editing.
- Do not encode semantic assumptions as fixed constants or branch rules. Forbidden examples include `this step should be light so 30s is enough`, `this answer is too short so retry`, `done=true so finalize now`, and `this planner timeout should be terminal`.
- SLA and deadline control may exist in System only as operational boundaries and remaining-budget allocation. Do not turn them into semantic judgments about quality, task size, or user intent.
- If a bug appears to invite more TypeScript control logic, first ask whether the missing piece is actually a Harness contract, worker contract, prompt contract, or operational skill/script route.
- Prefer removing thick System logic to stacking another exception on top of it.

## Portable Harness Fixed Contract
- This section is intentionally portable across Codex, Claude Code, and similar agentic projects. Treat it as the default fixed contract whenever an agent edits Harness-adjacent code.
- The trigger is not project-specific. If a change touches orchestration, retries, timeouts, planner/worker/final decomposition, prompt shaping, context shaping, routing, or evidence flow, apply this contract before editing.
- Follow this sequence in order. Do not skip steps because the bug looks obvious.
- Step 1: open the boundary reference in the same turn.
- Step 2: write an owner table for every intended change using `requirement | owner | why not the other side`.
- Step 3: if the owner is `Harness contract`, solve it in prompt contract, worker contract, skill contract, or structured model I/O, not in TypeScript heuristics.
- Step 4: if the owner is `System boundary`, justify the real boundary in concrete terms such as authority, visibility, side effects, persistence integrity, sandboxing, or hard deadline control.
- Step 5: if the proposed fix is a timeout, truncation, forced fallback, permanent failure classification, heuristic routing, or semantic retry rule, treat that as a stop-and-review event rather than an implementation shortcut.
- Step 6: after editing, re-run the review checklist and explicitly check whether the patch reduced Harness freedom.
- If an agent cannot produce the owner table or cannot justify the boundary in those terms, that agent must not own the change.

## Portable Boundary Enforcement Pattern
- This pattern is the reusable Harness fixed for other agents and similar projects. Copy the pattern even if filenames, runtimes, or model providers differ.
- Do not depend on memory of past failures. Convert the boundary rule into an explicit pre-edit ritual and post-edit review.
- Required roles:
  - `Implementer`: proposes and applies the change.
  - `Boundary reviewer`: checks only whether System stole Harness responsibility. This may be a separate agent or a forced second-pass by the same agent, but it must be treated as an independent review step.
- Required artifacts before editing:
  - `owner table`: `requirement | owner | why not the other side`
  - `stop-trigger list`: which parts of the planned change involve timeout, truncation, heuristic routing, forced fallback, permanent failure, or quality gating
- Required review outcome after editing:
  - `pass`: System still owns only boundary and operations
  - `fail`: System now decides meaning, query wording, retrieval scope, decomposition, quality, or answer structure
- If the review outcome is `fail`, do not patch around it. Redesign the change at the contract level first.

## Failure Recurrence Explanation And Guard
- The repeating failure mode is predictable: visible runtime symptoms make fixed constants and branch rules feel like the fastest lever, so agents default to thickening System instead of improving Harness contracts.
- Therefore the prevention method must be mechanical, not motivational. "Be careful" is not a sufficient control.
- Mandatory guard:
  - If a fix introduces or changes a fixed timeout, truncation, heuristic branch, forced fallback, permanent failure classification, or quality threshold, presume `Harness theft` until the owner table proves otherwise.
  - If the proposed justification is `this step should be light`, `this answer should be enough`, `this path is probably terminal`, or similar, stop. Those are semantic assumptions, not System boundaries.
  - If the same smell appears twice in one project, stop local patching and refresh the boundary reference before the next code change.

## Cross-Project Reviewer Contract
- This reviewer contract is intended to work across different agents and similar projects.
- Reviewer questions:
  - Did the change move a semantic choice from the model into host code?
  - Did the change replace model freedom with a constant, threshold, timeout, or heuristic shortcut?
  - Did the change encode a quality complaint as System behavior instead of a Harness contract?
  - Did the change treat an operational deadline as if it justified semantic claims about task size, answer quality, or terminal failure?
- Reviewer decision rule:
  - If any answer is `yes`, reject the design until the semantic part is moved back into prompt contract, worker contract, structured model I/O, or another Harness-side operating contract.

## Cross-Project Default Invariants
- System may own only boundaries and operations: authority, scope/visibility, side effects, DB I/O, persistence integrity, sandboxing, safety policy, and hard deadlines.
- Harness may own only semantics and generation: meaning interpretation, retrieval strategy, decomposition, source selection, wording, summarization, and synthesis.
- Facts plane must stay facts-only. Control-plane state such as retry metadata, safety regeneration state, budgets, and orchestration hints must stay outside it.
- A timeout is an operational boundary only. It must never smuggle in semantic claims such as `this task should be easy`, `this answer is good enough`, or `this failure should be terminal`.
- A quality complaint is not a license to thicken System. First answer with a Harness contract, worker redesign, planner redesign, or better structured outputs.
- If the same smell appears twice, stop patching locally and revisit the boundary document before the next edit.

## Repeat-Failure Guard
- If the current change touches the same boundary family that previously regressed in this repository, do not patch immediately from memory.
- Re-open `references/agents-harness-boundary-patterns.md`, identify the prior smell in concrete terms, and state why the new change stays on the boundary side instead of the meaning side.
- When the tempting fix is a timeout, truncation, heuristic, forced fallback, or permanent failure classification, treat that as a mandatory boundary-review trigger.

## Review Checklist
- Did I make System interpret user meaning that should belong to Harness?
- Did I reduce Harness freedom with an unnecessary rule, timeout, truncation, or capability fiction?
- Is this change natural from the user story, not just convenient for the implementation?
- Does System still only own facts, boundaries, side effects, and integrity after this change?
- Did I add any fixed constant or failure policy that is secretly a semantic assumption rather than a real operational boundary?
- If I touched timeout/retry/orchestration code, did I verify that the rule is budget control only and not a proxy for meaning or quality?

## Implementation Rules
- Source code and tests under `implementation/` follow the rules in this file.
- The boundaries of all modules are defined by Bounded Contexts. Domains must remain isolated from one another.
- Through Dependency Inversion, all input and output pass through typed interfaces. The domain layer never contains infrastructure imports.
- We use a contract-first approach: define interfaces and type signatures before implementation details.
- Each file must maintain a consistent cohesion gradient with one main axis of change and one reason for existence.
- The module graph must remain acyclic. Circular imports are boundary violations.
- Persistence belongs to the repository layer, orchestration belongs to the service layer, and business invariants belong to the domain layer.
- Apply colocation: type definitions, interfaces, implementations, and tests should live inside the same boundary directory.
- Public API surface is defined by barrel exports. Symbols that are not exported are private by convention.
- Boundary principles, review checks, and implementation-layer design discussion belong here, not in the repository-root `AGENTS.md`.
- All Discord bot implementations and fixes must follow Context7 or official documentation as the primary source of truth.
