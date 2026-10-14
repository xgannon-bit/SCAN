param([switch] $CheckOnly)
$ErrorActionPreference = 'Stop'
$scanRoot = Split-Path -Parent $PSScriptRoot
$scanNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$scanCli = Join-Path $scanRoot 'scripts\next-local.mjs'
foreach ($scanRequired in @($scanNode, $scanCli, (Join-Path $scanRoot '.venv\Scripts\python.exe'), (Join-Path $scanRoot '.next-visual-rebuild\BUILD_ID'))) {
  if (-not (Test-Path -LiteralPath $scanRequired -PathType Leaf)) { throw 'The visual-rebuild build or local runtime is missing. See docs/visual-rebuild-implementation.md.' }
}
$scanListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 3218)
$scanListener.Server.ExclusiveAddressUse = $true
try { $scanListener.Start() } catch { throw 'Port 3218 is already in use. Open http://127.0.0.1:3218/workspace if this is the existing SCAN visual-rebuild server; leave the process untouched.' } finally { $scanListener.Stop() }
if ($CheckOnly) { Write-Output 'Visual Rebuild build/runtime present; loopback port 3218 available. No server started.'; return }
$scanPreviousBuild = $env:SCAN_VISUAL_BUILD
$scanPreviousPort = $env:SCAN_PORT
$scanPreviousTelemetry = $env:NEXT_TELEMETRY_DISABLED
$scanPreviousLocation = Get-Location
try {
  Set-Location -LiteralPath $scanRoot
  $env:SCAN_VISUAL_BUILD = '1'; $env:SCAN_PORT = '3218'; $env:NEXT_TELEMETRY_DISABLED = '1'
  Write-Output 'SCAN visual-rebuild development: http://127.0.0.1:3218/workspace'
  Write-Output 'Keep this window open; Ctrl+C stops this server. Original evaluation builds use separate folders.'
  & $scanNode $scanCli start
} finally {
  $env:SCAN_VISUAL_BUILD = $scanPreviousBuild; $env:SCAN_PORT = $scanPreviousPort; $env:NEXT_TELEMETRY_DISABLED = $scanPreviousTelemetry
  Set-Location -LiteralPath $scanPreviousLocation
}
