param(
  [ValidateSet('Install', 'Open', 'Serve')] [string] $Mode = 'Open',
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
$env:PATH = (Join-Path $env:ProgramFiles 'nodejs') + ';' + $env:PATH

function Get-ScanReady {
  $scanConnections = @(Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue)
  if (-not $scanConnections.Count) { return $false }
  foreach ($scanConnection in $scanConnections) {
    $scanProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($scanConnection.OwningProcess)"
    if ($scanConnection.LocalAddress -ne '127.0.0.1' -or -not $scanProcess.CommandLine -or
        $scanProcess.CommandLine.IndexOf($scanNextPath, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
      throw 'Port 3210 belongs to another application. It has been left untouched.'
    }
  }
  try {
    $scanResponse = Invoke-WebRequest -Uri $scanUrl -UseBasicParsing -TimeoutSec 3
    return ($scanResponse.StatusCode -eq 200 -and $scanResponse.Content -match 'SCAN')
  } catch { return $false }
}

try {
  if ($Mode -eq 'Install') {
    $scanExisting = Get-ScheduledTask -TaskName $scanTaskName -ErrorAction SilentlyContinue
    if ($scanExisting) {
      if ($scanExisting.Actions.Arguments -notcontains ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scanScript + '" -Mode Serve')) {
        throw 'An existing SCAN task points elsewhere. It was left unchanged.'
      }
    } else {
      $scanAction = New-ScheduledTaskAction -Execute $scanPowerShell -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scanScript + '" -Mode Serve') -WorkingDirectory $scanRoot
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

  if (-not (Get-ScanReady)) {
    $scanTask = Get-ScheduledTask -TaskName $scanTaskName -ErrorAction Stop
    if ($scanTask.State -ne 'Running') { Start-ScheduledTask -TaskName $scanTaskName }
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
    if (-not $scanReady) { throw "SCAN is not ready after three minutes. Logs: $scanLogs" }
  }
  if (-not $NoBrowser) { Start-Process $scanUrl }
  Write-Output "SCAN is ready: $scanUrl"
} catch {
  $scanMessage = $_.Exception.Message
  if ($Mode -eq 'Open' -and -not $NoBrowser) {
    Add-Type -AssemblyName System.Windows.Forms
    $null = [System.Windows.Forms.MessageBox]::Show($scanMessage, 'SCAN startup', 'OK', 'Error')
  }
  Write-Error $scanMessage -ErrorAction Continue
  exit 1
}
