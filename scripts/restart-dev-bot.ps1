$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$currentProcessId = $PID
$repoPattern = [regex]::Escape($repoRoot)
$botPattern = "(implementation[\\/]+src[\\/]+main\.ts|dist[\\/]+src[\\/]+main\.js|restart-dev-bot\.ps1|node_modules[\\/]\.bin[\\/]\.\.[\\/]tsx[\\/]dist[\\/]cli\.mjs|tsx[\\/]dist[\\/]loader\.mjs)"
$cmdPattern = "(corepack(?:\.cmd)?\s+pnpm\s+dev|pnpm\s+dev)"

$targetProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $currentProcessId -and
  (
    (
      $_.Name -eq "node.exe" -and
      $_.CommandLine -match $repoPattern -and
      $_.CommandLine -match $botPattern
    ) -or
    (
      ($_.Name -eq "powershell.exe" -or $_.Name -eq "pwsh.exe" -or $_.Name -eq "cmd.exe") -and
      $_.CommandLine -match $repoPattern -and
      (
        $_.CommandLine -match $botPattern -or
        $_.CommandLine -match $cmdPattern
      )
    )
  )
}

if ($targetProcesses.Count -gt 0) {
  $targetProcesses | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
  }
  $stoppedIds = ($targetProcesses | ForEach-Object { $_.ProcessId }) -join ", "
  Write-Host "stopped existing bot process ids: $stoppedIds"
} else {
  Write-Host "no existing bot process found"
}

$tsxPath = Join-Path $repoRoot "node_modules/.bin/tsx.cmd"
if (-not (Test-Path $tsxPath)) {
  throw "tsx binary not found at $tsxPath"
}

& $tsxPath (Join-Path $repoRoot "implementation/src/main.ts")
exit $LASTEXITCODE
