param([switch] $CheckOnly)
$ErrorActionPreference = 'Stop'
$scanRoot = Split-Path -Parent $PSScriptRoot
$scanNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$scanCli = Join-Path $scanRoot 'scripts\next-local.mjs'
foreach ($scanRequired in @($scanNode, $scanCli, (Join-Path $scanRoot '.venv\Scripts\python.exe'), (Join-Path $scanRoot '.next-visual-processing\BUILD_ID'))) {
  if (-not (Test-Path -LiteralPath $scanRequired -PathType Leaf)) { throw 'The visual-processing build or local runtime is missing. See docs/visual-processing-increment.md.' }
}
$scanListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 3219)
$scanListener.Server.ExclusiveAddressUse = $true
try { $scanListener.Start() } catch { throw 'Port 3219 is already in use. Open http://127.0.0.1:3219/workspace if this is the existing SCAN visual-processing server; leave the process untouched.' } finally { $scanListener.Stop() }
if ($CheckOnly) { Write-Output 'Visual Processing build/runtime present; loopback port 3219 available. No server started.'; return }
$scanPreviousBuild = $env:SCAN_PROCESSING_BUILD
$scanPreviousPort = $env:SCAN_PORT
$scanPreviousTelemetry = $env:NEXT_TELEMETRY_DISABLED
$scanPreviousLocation = Get-Location
try {
  Set-Location -LiteralPath $scanRoot
  $env:SCAN_PROCESSING_BUILD = '1'; $env:SCAN_PORT = '3219'; $env:NEXT_TELEMETRY_DISABLED = '1'
  Write-Output 'SCAN visual-processing development: http://127.0.0.1:3219/workspace'
  Write-Output 'Keep this window open; Ctrl+C stops this server. Original evaluation builds use separate folders.'
  & $scanNode $scanCli start
} finally {
  $env:SCAN_PROCESSING_BUILD = $scanPreviousBuild; $env:SCAN_PORT = $scanPreviousPort; $env:NEXT_TELEMETRY_DISABLED = $scanPreviousTelemetry
  Set-Location -LiteralPath $scanPreviousLocation
}
