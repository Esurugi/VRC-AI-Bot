# Production Ops Scripts

Run scripts with `sh scripts/ops/...`; the execute bit is not part of the
contract.

## Prepare Data Directories

`prepare-oracle-data-dirs.sh` is a host preflight script. It creates the
production `/data` directories and sets ownership for the runtime user, so it
usually needs `sudo`.

Check the container runtime UID/GID:

```sh
docker compose -f compose.prod.yaml run --rm --entrypoint id bot
```

Run the preflight with the UID/GID reported for the runtime user:

```sh
sudo RUNTIME_UID=1000 RUNTIME_GID=1000 sh scripts/ops/prepare-oracle-data-dirs.sh
```

## Backup Runtime Data

Run `backup-runtime.sh` inside the production container so it uses the same
paths, mounted volumes, and packaged tools as the bot runtime:

```sh
docker compose -f compose.prod.yaml run --rm bot sh scripts/ops/backup-runtime.sh
```

The script writes the manifest path to stdout. The plain `.env` file is not
included in the backup archive because it contains secrets.

Host execution is possible only when the host has compatible `sqlite3`, `tar`,
`gzip`, `sha256sum`, and, for encrypted Codex home backups, `gpg`.

## Codex CLI Version Check

The Dockerfiles pin `@openai/codex` through `CODEX_CLI_VERSION`. Verify the
runtime image after build:

```sh
docker compose -f compose.prod.yaml run --rm bot codex --version
```

Expected pinned version:

```text
codex-cli 0.142.0
```
