param(
  [Parameter(Mandatory = $true)]
  [string]$EnvFilePath,
  [string]$ImageTag = "vrc-ai-bot:local",
  [string]$ContainerName = "vrc-ai-bot",
  [string]$CodexVolume = "vrc-ai-bot-codex-home",
  [string]$NodeModulesVolume = "vrc-ai-bot-node-modules",
  [string]$PnpmStoreVolume = "vrc-ai-bot-pnpm-store",
  [switch]$BuildImage,
  [switch]$ForceInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$resolvedEnvFile = (Resolve-Path $EnvFilePath).Path

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
  "--name",
  $ContainerName,
  "--env-file",
  $resolvedEnvFile,
  "--env",
  "HOME=/codex-home",
  "--env",
  "CODEX_HOME=/codex-home/.codex",
  "--volume",
  "${repoRoot}:/workspace",
  "--volume",
  "${CodexVolume}:/codex-home",
  "--volume",
  "${NodeModulesVolume}:/workspace/node_modules",
  "--volume",
  "${PnpmStoreVolume}:/pnpm/store",
  "--workdir",
  "/workspace"
)

if ($ForceInstall) {
  $dockerArgs += @("--env", "FORCE_PNPM_INSTALL=1")
}

$dockerArgs += @(
  $ImageTag,
  "pnpm",
  "dev:raw"
)

& docker @dockerArgs
