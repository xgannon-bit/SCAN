param(
  [ValidateSet('Install', 'Open', 'Serve', 'Restart')] [string] $Mode = 'Open',
  [switch] $NoBrowser
)

# An on-demand, current-user Windows task owns the server, not an editor terminal.
$ErrorActionPreference = 'Stop'
$scanRoot = Split-Path -Parent $PSScriptRoot
$scanIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$scanTaskName = 'SCAN-Desktop-' + $scanIdentity.User.Value
$scanPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$scanScript = $PSCommandPath
$scanUrl = 'http://127.0.0.1:3210/'
$scanLogs = Join-Path $env:LOCALAPPDATA 'SCAN\desktop-server'
$scanNextPath = Join-Path $scanRoot 'node_modules\next\dist\bin\next'
$scanServeArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scanScript + '" -Mode Serve'
$script:scanReadyReason = 'No verified SCAN listener is available.'
$env:PATH = (Join-Path $env:ProgramFiles 'nodejs') + ';' + $env:PATH

function Write-ScanLauncherEvent([string] $Message) {
  $null = New-Item -ItemType Directory -Path $scanLogs -Force
  Add-Content -LiteralPath (Join-Path $scanLogs 'launcher.log') -Encoding UTF8 -Value ("{0} [{1}] {2}" -f [DateTime]::UtcNow.ToString('o'), $Mode, $Message)
}

function Get-ScanPrincipalSid([string] $Principal) {
  try {
    if ($Principal -match '^S-\d-') { return [Security.Principal.SecurityIdentifier]::new($Principal).Value }
    return [Security.Principal.NTAccount]::new($Principal).Translate([Security.Principal.SecurityIdentifier]).Value
  } catch { throw 'The SCAN task principal could not be resolved. It was left unchanged.' }
}

function Assert-ScanTask($Task) {
  if (-not $Task -or @($Task.Actions).Count -ne 1 -or
      $Task.Actions[0].Execute -ine $scanPowerShell -or
      $Task.Actions[0].Arguments -cne $scanServeArguments -or
      $Task.Actions[0].WorkingDirectory -ine $scanRoot -or
      (Get-ScanPrincipalSid $Task.Principal.UserId) -ne $scanIdentity.User.Value -or
      [string]$Task.Principal.LogonType -notin @('Interactive', '3') -or [string]$Task.Principal.RunLevel -notin @('Limited', '0')) {
    throw 'The existing SCAN task does not match this checkout and signed-in user. It was left unchanged.'
  }
}

function Assert-ScanServerProcess($Process) {
  if (-not $Process -or $Process.Name -ine 'node.exe' -or -not $Process.ExecutablePath -or -not $Process.CreationDate) {
    throw 'The SCAN port/process identity could not be verified. It has been left untouched.'
  }
  $scanNodePattern = [regex]::Escape([string]$Process.ExecutablePath)
  $scanCliPattern = [regex]::Escape($scanNextPath)
  $scanCommandPattern = '^\s*(?:"' + $scanNodePattern + '"|' + $scanNodePattern + ')\s+(?:"' + $scanCliPattern + '"|' + $scanCliPattern + ')\s+start\s+--hostname\s+127\.0\.0\.1\s+--port\s+3210\s*$'
  if (-not $Process.CommandLine -or $Process.CommandLine -inotmatch $scanCommandPattern) {
    throw 'Another application or a different Next.js operation/port is present. It has been left untouched; stop it from its own launcher before rebuilding this checkout.'
  }
  $scanOwner = Invoke-CimMethod -InputObject $Process -MethodName GetOwnerSid
  if ($scanOwner.ReturnValue -ne 0 -or $scanOwner.Sid -ne $scanIdentity.User.Value) {
    throw 'The SCAN process is not owned by the signed-in user. It has been left untouched.'
  }
}

function Get-ScanListeners {
  $scanConnections = @(Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue)
  $scanSeen = @{}
  foreach ($scanConnection in $scanConnections) {
    if ($scanConnection.LocalAddress -ne '127.0.0.1') {
      throw 'Port 3210 belongs to another application. It has been left untouched.'
    }
    $scanProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($scanConnection.OwningProcess)"
    if (-not $scanProcess) {
      # The verified server can exit between TCP enumeration and process lookup.
      # Ignore only a listener which is also absent in a fresh TCP snapshot.
      $scanStillListening = @(Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue | Where-Object {
        $_.OwningProcess -eq $scanConnection.OwningProcess -and $_.LocalAddress -eq $scanConnection.LocalAddress
      })
      if (-not $scanStillListening.Count) { continue }
    }
    Assert-ScanServerProcess $scanProcess
    if (-not $scanSeen.ContainsKey($scanProcess.ProcessId)) { $scanSeen[$scanProcess.ProcessId] = $true; $scanProcess }
  }
}

function Test-ScanAssets([string] $Html) {
  $scanAssets = @{}
  foreach ($scanMatch in [regex]::Matches($Html, '(?i)\b(?:src|href)\s*=\s*["'']([^"'']+)["'']')) {
    $scanAssetUri = [Uri]::new([Uri]$scanUrl, [System.Net.WebUtility]::HtmlDecode($scanMatch.Groups[1].Value))
    if (-not $scanAssetUri.AbsolutePath.StartsWith('/_next/static/', [StringComparison]::Ordinal) -or
        $scanAssetUri.AbsolutePath -notmatch '\.(js|css)$') { continue }
    if ($scanAssetUri.GetLeftPart([UriPartial]::Authority) -ne ([Uri]$scanUrl).GetLeftPart([UriPartial]::Authority)) {
      $script:scanReadyReason = 'The dashboard advertises a nonlocal Next.js asset.'; return $false
    }
    $scanAssets[$scanAssetUri.AbsoluteUri] = if ($scanAssetUri.AbsolutePath.EndsWith('.css')) { 'css' } else { 'js' }
  }
  if ($scanAssets.Count -gt 64 -or 'css' -notin $scanAssets.Values -or 'js' -notin $scanAssets.Values) {
    $script:scanReadyReason = 'The dashboard does not advertise a bounded set of JavaScript and CSS assets.'; return $false
  }
  foreach ($scanAssetUrl in $scanAssets.Keys) {
    try {
      $scanAsset = Invoke-WebRequest -Uri $scanAssetUrl -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0
      $scanExpectedType = if ($scanAssets[$scanAssetUrl] -eq 'css') { '^text/css\b' } else { '^(?:text|application)/(?:javascript|x-javascript)\b' }
      if ($scanAsset.StatusCode -ne 200 -or [string]$scanAsset.Headers['Content-Type'] -notmatch $scanExpectedType -or
          -not $scanAsset.Content.Length -or [string]$scanAsset.Content -match '^\s*<(?:!doctype|html)\b') { throw 'Invalid asset response.' }
    } catch {
      $script:scanReadyReason = 'A dashboard JavaScript or CSS asset is unavailable or invalid: ' + $scanAssetUrl
      return $false
    }
  }
  return $true
}

function Get-ScanReady {
  if (-not @(Get-ScanListeners).Count) { $script:scanReadyReason = 'No verified SCAN listener is available.'; return $false }
  try {
    $scanResponse = Invoke-WebRequest -Uri $scanUrl -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0
    if ($scanResponse.StatusCode -ne 200 -or $scanResponse.Content -notmatch 'SCAN') { throw 'Invalid dashboard response.' }
    if (-not (Test-ScanAssets $scanResponse.Content)) { return $false }
    $script:scanReadyReason = 'Dashboard and advertised JavaScript/CSS assets responded successfully.'
    return $true
  } catch { $script:scanReadyReason = 'The SCAN dashboard did not respond successfully.'; return $false }
}

function Stop-VerifiedScanServer($Task) {
  Assert-ScanTask $Task
  # Validate everything before stopping anything. Another port, dev/build process
  # or owner in this checkout must keep start-demo's shared .next guard effective.
  $scanListening = @(Get-ScanListeners)
  $scanProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($scanNextPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  foreach ($scanProcess in $scanProcesses) { Assert-ScanServerProcess $scanProcess }
  foreach ($scanListener in $scanListening) {
    if ($scanListener.ProcessId -notin @($scanProcesses.ProcessId)) { throw 'The SCAN listener changed during verification. Retry after checking its launcher.' }
  }
  if ($Task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $scanTaskName
    Write-ScanLauncherEvent "Stopped verified task $scanTaskName. Checking for its remaining Next.js server."
  }
  foreach ($scanProcess in $scanProcesses) {
    $scanCurrent = Get-CimInstance Win32_Process -Filter "ProcessId=$($scanProcess.ProcessId)" -ErrorAction SilentlyContinue
    if (-not $scanCurrent) { continue }
    Assert-ScanServerProcess $scanCurrent
    if ($scanCurrent.CreationDate -ne $scanProcess.CreationDate) { throw 'A process ID was reused during restart. The new process was left untouched.' }
    Stop-Process -Id $scanCurrent.ProcessId -ErrorAction Stop
    Write-ScanLauncherEvent "Stopped verified SCAN Next.js server PID $($scanCurrent.ProcessId)."
  }
  $scanStopDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $scanRemaining = @(Get-ScanListeners)
    $scanCurrentTask = Get-ScheduledTask -TaskName $scanTaskName
    Assert-ScanTask $scanCurrentTask
    if (-not $scanRemaining.Count -and $scanCurrentTask.State -ne 'Running') { return }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $scanStopDeadline)
  throw 'The verified SCAN server/task did not stop within ten seconds. No rebuild was started.'
}

try {
  if ($Mode -eq 'Install') {
    $scanExisting = Get-ScheduledTask -TaskName $scanTaskName -ErrorAction SilentlyContinue
    if ($scanExisting) {
      Assert-ScanTask $scanExisting
    } else {
      $scanAction = New-ScheduledTaskAction -Execute $scanPowerShell -Argument $scanServeArguments -WorkingDirectory $scanRoot
      $scanPrincipal = New-ScheduledTaskPrincipal -UserId $scanIdentity.Name -LogonType Interactive -RunLevel Limited
      $scanSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
      $null = Register-ScheduledTask -TaskName $scanTaskName -Action $scanAction -Principal $scanPrincipal -Settings $scanSettings -Description 'Starts the local SCAN dashboard on demand. No administrator rights, password or startup trigger.'
    }
    $scanDesktop = [Environment]::GetFolderPath('Desktop')
    $scanShell = New-Object -ComObject WScript.Shell
    # Refresh the old shortcut too so either name starts the same server.
    foreach ($scanName in @('Open SCAN.lnk', 'Open SCAN Demo.lnk')) {
      $scanShortcut = $scanShell.CreateShortcut((Join-Path $scanDesktop $scanName))
      $scanShortcut.TargetPath = $scanPowerShell
      $scanShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scanScript + '" -Mode Open'
      $scanShortcut.WorkingDirectory = $scanRoot
      $scanShortcut.Description = 'Start SCAN locally and open the dashboard'
      $scanShortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',14'
      $scanShortcut.Save()
    }
    Write-Output "Installed Open SCAN on $scanDesktop. Task: $scanTaskName"
    exit 0
  }

  if ($Mode -eq 'Serve') {
    $null = New-Item -ItemType Directory -Path $scanLogs -Force
    $scanLog = Join-Path $scanLogs ('server-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
    Start-Transcript -LiteralPath $scanLog | Out-Null
    try {
      & (Join-Path $PSScriptRoot 'start-demo.ps1') -Port 3210
      if ($LASTEXITCODE -ne 0) { throw "SCAN exited with code $LASTEXITCODE. See $scanLog" }
    } finally { Stop-Transcript | Out-Null }
    exit 0
  }

  if ($Mode -eq 'Restart') {
    $scanTask = Get-ScheduledTask -TaskName $scanTaskName -ErrorAction Stop
    Stop-VerifiedScanServer $scanTask
  }
  if (-not (Get-ScanReady)) {
    Write-ScanLauncherEvent $script:scanReadyReason
    if ($Mode -eq 'Open' -and @(Get-ScanListeners).Count) {
      throw "The SCAN server is running but its dashboard/assets are not ready. Save the browser project, then run desktop-scan.ps1 -Mode Restart. $script:scanReadyReason Logs: $scanLogs"
    }
    $scanTask = Get-ScheduledTask -TaskName $scanTaskName -ErrorAction Stop
    Assert-ScanTask $scanTask
    if ($scanTask.State -ne 'Running') { Start-ScheduledTask -TaskName $scanTaskName; Write-ScanLauncherEvent "Started verified task $scanTaskName." }
    $scanDeadline = [DateTime]::UtcNow.AddMinutes(3)
    $scanReady = $false
    while ([DateTime]::UtcNow -lt $scanDeadline) {
      if (Get-ScanReady) { $scanReady = $true; break }
      Start-Sleep -Milliseconds 750
      $scanTask = Get-ScheduledTask -TaskName $scanTaskName
      if ($scanTask.State -ne 'Running') {
        $scanInfo = Get-ScheduledTaskInfo -TaskName $scanTaskName
        if ($scanInfo.LastTaskResult -ne 0 -and $scanInfo.LastTaskResult -ne 267009) {
          throw "SCAN could not start (Windows result $($scanInfo.LastTaskResult)). Logs: $scanLogs"
        }
      }
    }
    if (-not $scanReady) { throw "SCAN is not ready after three minutes. $script:scanReadyReason Logs: $scanLogs" }
  }
  Write-ScanLauncherEvent $script:scanReadyReason
  if (-not $NoBrowser) { Start-Process $scanUrl }
  Write-Output "SCAN is ready: $scanUrl"
} catch {
  $scanMessage = $_.Exception.Message
  try { Write-ScanLauncherEvent $scanMessage } catch { Write-Warning 'The launcher log could not be updated.' }
  if ($Mode -in @('Open', 'Restart') -and -not $NoBrowser) {
    Add-Type -AssemblyName System.Windows.Forms
    $null = [System.Windows.Forms.MessageBox]::Show($scanMessage, 'SCAN startup', 'OK', 'Error')
  }
  Write-Error $scanMessage -ErrorAction Continue
  exit 1
}
