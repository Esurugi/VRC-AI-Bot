param(
  [string]$EnvFilePath,
  [string]$ImageTag = "vrc-ai-bot:local",
  [string]$CodexVolume = "vrc-ai-bot-codex-home",
  [string]$NodeModulesVolume = "vrc-ai-bot-node-modules",
  [string]$PnpmStoreVolume = "vrc-ai-bot-pnpm-store",
  [switch]$BuildImage
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path

if ($BuildImage) {
  & docker build -t $ImageTag $repoRoot
}

foreach ($volumeName in @($CodexVolume, $NodeModulesVolume, $PnpmStoreVolume)) {
  & docker volume create $volumeName | Out-Null
}

$dockerArgs = @(
  "run",
  "--rm",
  "-it",
  "--env",
  "HOME=/codex-home",
  "--env",
  "CODEX_HOME=/codex-home/.codex",
  "--env",
  "SKIP_PNPM_INSTALL=1",
  "--volume",
  "${repoRoot}:/workspace",
  "--volume",
  "${CodexVolume}:/codex-home",
  "--volume",
  "${NodeModulesVolume}:/workspace/node_modules",
  "--volume",
  "${PnpmStoreVolume}:/pnpm/store",
  "--workdir",
  "/workspace",
  $ImageTag,
  "codex",
  "login"
)

if ($EnvFilePath) {
  $resolvedEnvFile = (Resolve-Path $EnvFilePath).Path
  $dockerArgs = @(
    $dockerArgs[0..2]
    "--env-file"
    $resolvedEnvFile
    $dockerArgs[3..($dockerArgs.Length - 1)]
  )
}

& docker @dockerArgs
