#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/data/backups}"
BOT_DB_PATH="${BOT_DB_PATH:-/data/vrc-ai-bot/bot.sqlite}"
CONFIG_DIR="${BOT_CONFIG_DIR:-/data/vrc-ai-bot/config}"
PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-/data/vrc-ai-bot/.env}"
CODEX_HOME="${CODEX_HOME:-/data/codex-home/.codex}"
CODEX_HOME_BACKUP_MODE="${CODEX_HOME_BACKUP_MODE:-relogin}"
CODEX_HOME_BACKUP_PASSPHRASE_FILE="${CODEX_HOME_BACKUP_PASSPHRASE_FILE:-}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT%/}/vrc-ai-bot-${timestamp}"
manifest_path="${backup_dir}/manifest.json"

mkdir -p "${backup_dir}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

sha256_or_empty() {
  if [ -f "$1" ]; then
    sha256sum "$1" | awk '{print $1}'
  fi
}

db_backup=""
db_status="missing"
db_sha256=""
if [ -f "${BOT_DB_PATH}" ]; then
  db_backup="${backup_dir}/bot.sqlite"
  sqlite3 "${BOT_DB_PATH}" ".backup '${db_backup}'"
  db_status="ok"
  db_sha256="$(sha256_or_empty "${db_backup}")"
fi

config_archive=""
config_status="missing"
config_sha256=""
if [ -d "${CONFIG_DIR}" ]; then
  config_archive="${backup_dir}/config.tar.gz"
  tar -C "$(dirname "${CONFIG_DIR}")" -czf "${config_archive}" "$(basename "${CONFIG_DIR}")"
  config_status="ok"
  config_sha256="$(sha256_or_empty "${config_archive}")"
fi

codex_archive=""
codex_status="relogin_required"
codex_sha256=""
codex_restore_note="CODEX_HOME was not backed up; run codex login after restore."
case "${CODEX_HOME_BACKUP_MODE}" in
  encrypted)
    if [ ! -d "${CODEX_HOME}" ]; then
      codex_status="missing"
      codex_restore_note="CODEX_HOME directory was missing at backup time."
    elif [ -z "${CODEX_HOME_BACKUP_PASSPHRASE_FILE}" ] || [ ! -f "${CODEX_HOME_BACKUP_PASSPHRASE_FILE}" ]; then
      echo "CODEX_HOME_BACKUP_MODE=encrypted requires CODEX_HOME_BACKUP_PASSPHRASE_FILE." >&2
      exit 2
    else
      codex_archive="${backup_dir}/codex-home.tar.gz.gpg"
      tar -C "$(dirname "${CODEX_HOME}")" -czf - "$(basename "${CODEX_HOME}")" \
        | gpg --batch --yes --symmetric --cipher-algo AES256 \
            --passphrase-file "${CODEX_HOME_BACKUP_PASSPHRASE_FILE}" \
            --output "${codex_archive}"
      codex_status="encrypted"
      codex_sha256="$(sha256_or_empty "${codex_archive}")"
      codex_restore_note="Decrypt codex-home.tar.gz.gpg before restore; it contains Codex credentials."
    fi
    ;;
  relogin)
    codex_status="relogin_required"
    codex_restore_note="CODEX_HOME intentionally excluded; run codex login after restore."
    ;;
  *)
    echo "CODEX_HOME_BACKUP_MODE must be relogin or encrypted." >&2
    exit 2
    ;;
esac

env_status="excluded"
env_restore_note="/data/vrc-ai-bot/.env intentionally excluded from the plain backup archive because it contains secrets; recreate it from production.env.example and the secret manager or operator notes before restore."
if [ ! -f "${PRODUCTION_ENV_FILE}" ]; then
  env_status="missing"
  env_restore_note="/data/vrc-ai-bot/.env was missing at backup time; create it from production.env.example before starting the restored runtime."
fi

cat > "${manifest_path}" <<EOF
{
  "manifest_version": 1,
  "created_at_utc": "$(json_escape "${timestamp}")",
  "recovery_unit": "sqlite_db_config_codex_home",
  "backup_dir": "$(json_escape "${backup_dir}")",
  "sqlite": {
    "source": "$(json_escape "${BOT_DB_PATH}")",
    "artifact": "$(json_escape "${db_backup}")",
    "status": "$(json_escape "${db_status}")",
    "sha256": "$(json_escape "${db_sha256}")",
    "method": "sqlite online backup via .backup"
  },
  "config": {
    "source": "$(json_escape "${CONFIG_DIR}")",
    "artifact": "$(json_escape "${config_archive}")",
    "status": "$(json_escape "${config_status}")",
    "sha256": "$(json_escape "${config_sha256}")"
  },
  "env": {
    "source": "$(json_escape "${PRODUCTION_ENV_FILE}")",
    "artifact": "",
    "status": "$(json_escape "${env_status}")",
    "included": false,
    "restore_note": "$(json_escape "${env_restore_note}")"
  },
  "codex_home": {
    "source": "$(json_escape "${CODEX_HOME}")",
    "artifact": "$(json_escape "${codex_archive}")",
    "status": "$(json_escape "${codex_status}")",
    "sha256": "$(json_escape "${codex_sha256}")",
    "restore_note": "$(json_escape "${codex_restore_note}")"
  }
}
EOF

printf '%s\n' "${manifest_path}"
