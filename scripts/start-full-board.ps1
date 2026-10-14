param([switch] $CheckOnly)
$ErrorActionPreference = 'Stop'
$scanRoot = Split-Path -Parent $PSScriptRoot
$scanNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$scanCli = Join-Path $scanRoot 'scripts\next-local.mjs'
foreach ($scanRequired in @($scanNode, $scanCli, (Join-Path $scanRoot '.venv\Scripts\python.exe'), (Join-Path $scanRoot '.next-full-board\BUILD_ID'))) {
  if (-not (Test-Path -LiteralPath $scanRequired -PathType Leaf)) { throw 'The full-board build or local runtime is missing. See docs/full-board-integration.md.' }
}
$scanListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 3221)
$scanListener.Server.ExclusiveAddressUse = $true
try { $scanListener.Start() } catch { throw 'Port 3221 is already in use. Open http://127.0.0.1:3221/workspace if this is the existing SCAN full-board server; leave the process untouched.' } finally { $scanListener.Stop() }
if ($CheckOnly) { Write-Output 'Full Board build/runtime present; loopback port 3221 available. No server started.'; return }
$scanPreviousBuild = $env:SCAN_FULL_BOARD_BUILD
$scanPreviousPort = $env:SCAN_PORT
$scanPreviousTelemetry = $env:NEXT_TELEMETRY_DISABLED
$scanPreviousLocation = Get-Location
try {
  Set-Location -LiteralPath $scanRoot
  $env:SCAN_FULL_BOARD_BUILD = '1'; $env:SCAN_PORT = '3221'; $env:NEXT_TELEMETRY_DISABLED = '1'
  Write-Output 'SCAN full-board development: http://127.0.0.1:3221/workspace'
  Write-Output 'Keep this window open; Ctrl+C stops this server. Original evaluation builds use separate folders.'
  & $scanNode $scanCli start
} finally {
  $env:SCAN_FULL_BOARD_BUILD = $scanPreviousBuild; $env:SCAN_PORT = $scanPreviousPort; $env:NEXT_TELEMETRY_DISABLED = $scanPreviousTelemetry
  Set-Location -LiteralPath $scanPreviousLocation
}
