#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${HOME:-/codex-home}" "${CODEX_HOME:-/codex-home/.codex}" /pnpm/store
mkdir -p /workspace/node_modules

if [[ "$(id -u)" == "0" ]]; then
  chown -R node:node "${HOME:-/codex-home}" "${CODEX_HOME:-/codex-home/.codex}" /pnpm /workspace/node_modules
  export HOME="${HOME:-/codex-home}"
  export CODEX_HOME="${CODEX_HOME:-/codex-home/.codex}"

  if [[ "${SKIP_PNPM_INSTALL:-0}" != "1" ]]; then
    if [[ "${FORCE_PNPM_INSTALL:-0}" == "1" || ! -f node_modules/.modules.yaml ]]; then
      runuser -u node -- pnpm config set store-dir /pnpm/store >/dev/null
      runuser -u node -- pnpm install --frozen-lockfile
    fi
  else
    runuser -u node -- pnpm config set store-dir /pnpm/store >/dev/null
  fi

  exec runuser -u node -- "$@"
fi

pnpm config set store-dir /pnpm/store >/dev/null

if [[ "${SKIP_PNPM_INSTALL:-0}" != "1" ]]; then
  if [[ "${FORCE_PNPM_INSTALL:-0}" == "1" || ! -f node_modules/.modules.yaml ]]; then
    pnpm install --frozen-lockfile
  fi
fi

exec "$@"
