# Implementation Layer

`implementation/` is the repository layer for how the Discord bot is built.

## Owns
- `implementation/src`
- `implementation/test`
- `implementation/AGENTS.md`

## Does Not Define
- bot-runtime behavior policy
- runtime harness instructions
- reply target rules as authoritative policy

Those runtime rules live in the repository-root `AGENTS.md` and the local `discord-harness` skill.
