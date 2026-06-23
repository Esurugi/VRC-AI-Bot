#!/usr/bin/env sh
set -eu

RUNTIME_UID="${RUNTIME_UID:-1000}"
RUNTIME_GID="${RUNTIME_GID:-1000}"

for dir in \
  /data/vrc-ai-bot \
  /data/vrc-ai-bot/config \
  /data/vrc-ai-bot/traces \
  /data/codex-home \
  /data/backups
do
  mkdir -p "${dir}"
done

chown -R "${RUNTIME_UID}:${RUNTIME_GID}" \
  /data/vrc-ai-bot \
  /data/codex-home \
  /data/backups
