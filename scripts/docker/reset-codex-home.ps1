param(
  [string]$CodexVolume = "vrc-ai-bot-codex-home"
)

$ErrorActionPreference = "Stop"

& docker volume rm -f $CodexVolume
