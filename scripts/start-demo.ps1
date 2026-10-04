param(
  [ValidateRange(1, 65535)] [int] $Port = 3210,
  [switch] $CheckOnly
)

# Run in a normal foreground PowerShell window. Ctrl+C stops the local server.
$ErrorActionPreference = 'Stop'
$scanRoot = Split-Path -Parent $PSScriptRoot
$scanPreviousTelemetry = $env:NEXT_TELEMETRY_DISABLED
$scanPreviousPort = $env:SCAN_PORT
$scanListener = $null
$scanMutex = $null
$scanOwnsMutex = $false

try {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js is missing. Use the Node version recorded in .node-version, then run npm ci in this checkout.'
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd is missing. Repair the existing Node/npm installation before launching SCAN.'
  }
  $scanNodeText = & node.exe --version
  if ($LASTEXITCODE -ne 0) { throw 'Node.js could not report its version.' }
  $scanNodeVersion = [version]($scanNodeText.Trim().TrimStart('v'))
  if ($scanNodeVersion -lt [version]'20.18.1' -or $scanNodeVersion -ge [version]'25.0.0') {
    throw "Unsupported Node.js $scanNodeText. SCAN requires >=20.18.1 and <25; see .node-version for the tested version."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $scanRoot 'node_modules\next\dist\bin\next') -PathType Leaf)) {
    throw 'Project dependencies are missing. Run npm ci in the SCAN checkout, then retry this launcher.'
  }
  # A second port still shares this checkout's .next build. Serialize this launcher
  # and also detect direct npm starts before touching the running server's assets.
  $scanHasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $scanRootKey = [BitConverter]::ToString($scanHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($scanRoot.ToLowerInvariant()))).Replace('-', '')
  } finally { $scanHasher.Dispose() }
  $scanMutex = [System.Threading.Mutex]::new($false, "Local\SCAN-Demo-$scanRootKey")
  try { $scanOwnsMutex = $scanMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $scanOwnsMutex = $true }
  if (-not $scanOwnsMutex) {
    throw 'This checkout already has a demo launcher running. Use that server, or stop it with Ctrl+C before rebuilding.'
  }
  $scanNextPath = Join-Path $scanRoot 'node_modules\next\dist\bin\next'
  $scanExisting = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($scanNextPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  if ($scanExisting.Count -gt 0) {
    throw 'This SCAN checkout already has a Next.js process running. Use that server, or stop it from its own terminal before rebuilding. A different port still shares the same build.'
  }
  # Bind briefly to verify availability; never terminate an existing listener.
  $scanListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  $scanListener.Server.ExclusiveAddressUse = $true
  try { $scanListener.Start() } catch {
    throw "Loopback port $Port is occupied or unavailable. Leave that process alone; rerun with -Port and a free port."
  }
  $scanListener.Stop()
  $scanListener = $null

  Write-Output "SCAN checkout: $scanRoot"
  Write-Output "Node.js: $scanNodeText"
  Write-Output "Demo URL: http://127.0.0.1:$Port/demo"
  if ($CheckOnly) {
    Write-Output 'Preflight passed: Node/npm, Next dependency and loopback port are available. No build or running server was verified.'
    exit 0
  }

  Push-Location -LiteralPath $scanRoot
  try {
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:SCAN_PORT = [string]$Port
    Write-Output 'Building the current source for this presentation. No packages will be installed.'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed. SCAN was not started; fix the build error and retry.' }
    Write-Output "Build ID: $(Get-Content -LiteralPath (Join-Path $scanRoot '.next\BUILD_ID') -Raw)"
    Write-Output "Open http://127.0.0.1:$Port/demo in your browser. Keep this window open; Ctrl+C stops SCAN."
    & npm.cmd run start
    if ($LASTEXITCODE -ne 0) { throw "SCAN stopped with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
} catch {
  Write-Error $_ -ErrorAction Continue
  exit 1
} finally {
  if ($scanListener) { $scanListener.Stop() }
  if ($scanOwnsMutex) { $scanMutex.ReleaseMutex() }
  if ($scanMutex) { $scanMutex.Dispose() }
  $env:NEXT_TELEMETRY_DISABLED = $scanPreviousTelemetry
  $env:SCAN_PORT = $scanPreviousPort
}
