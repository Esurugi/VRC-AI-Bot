param(
  [string]$EnvFilePath = (Join-Path $env:LOCALAPPDATA "VRC-AI-Bot\vrc-ai-bot.env"),
  [string]$ImageTag = "vrc-ai-bot:local",
  [string]$ContainerName = "vrc-ai-bot",
  [string]$CodexVolume = "vrc-ai-bot-codex-home",
  [string]$NodeModulesVolume = "vrc-ai-bot-node-modules",
  [string]$PnpmStoreVolume = "vrc-ai-bot-pnpm-store",
  [int]$DaemonWaitSeconds = 60,
  [switch]$BuildImage
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resolvedEnvFile = (Resolve-Path $EnvFilePath).Path

function Wait-DockerDaemon {
  param(
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
      return
    }

    Start-Sleep -Seconds 2
  }

  throw "Docker daemon did not become ready within $TimeoutSeconds seconds."
}

Wait-DockerDaemon -TimeoutSeconds $DaemonWaitSeconds

if ($BuildImage) {
  & docker build -t $ImageTag $repoRoot
}

foreach ($volumeName in @($CodexVolume, $NodeModulesVolume, $PnpmStoreVolume)) {
  & docker volume create $volumeName | Out-Null
}

$existingContainerIdOutput = & docker ps -aq --filter "name=^/${ContainerName}$"
$existingContainerId = if ($null -eq $existingContainerIdOutput) { "" } else { "$existingContainerIdOutput".Trim() }

if ($existingContainerId) {
  $runningContainerIdOutput = & docker ps -q --filter "name=^/${ContainerName}$"
  $runningContainerId = if ($null -eq $runningContainerIdOutput) { "" } else { "$runningContainerIdOutput".Trim() }

  if ($runningContainerId) {
    Write-Output "Container '$ContainerName' is already running."
    exit 0
  }

  & docker start $ContainerName | Out-Null
  Write-Output "Container '$ContainerName' started."
  exit 0
}

$dockerArgs = @(
  "run",
  "-d",
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
  "/workspace",
  $ImageTag,
  "pnpm",
  "dev:raw"
)

$createdContainerId = (& docker @dockerArgs).Trim()
Write-Output "Container '$ContainerName' created: $createdContainerId"
