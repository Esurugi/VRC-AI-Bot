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

## Review Checklist
- Did I make System interpret user meaning that should belong to Harness?
- Did I reduce Harness freedom with an unnecessary rule, timeout, truncation, or capability fiction?
- Is this change natural from the user story, not just convenient for the implementation?
- Does System still only own facts, boundaries, side effects, and integrity after this change?

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
