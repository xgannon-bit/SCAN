import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

// Load function ASTs only. Never execute the launcher, Windows tasks or processes.
const script = path.resolve('scripts/desktop-scan.ps1').replaceAll("'", "''");
const harness = String.raw`
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('__SCRIPT__', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false) | ForEach-Object { Invoke-Expression $_.Extent.Text }
$scanRoot = 'C:\Authored\SCAN'
$scanNextPath = $scanRoot + '\node_modules\next\dist\bin\next'
$scanPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$scanServeArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Authored\SCAN\scripts\desktop-scan.ps1" -Mode Serve'
$scanTaskName = 'SCAN-Desktop-SYNTHETIC'
$scanIdentity = [pscustomobject]@{ Name='FICTIONAL\User'; User=[pscustomobject]@{ Value='S-1-5-21-1000' } }
$scanUrl = 'http://127.0.0.1:3210/'
$script:processes = @([pscustomobject]@{ ProcessId=700; Name='node.exe'; ExecutablePath='C:\Authored\node.exe'; CreationDate=[datetime]'2026-01-02T03:04:05Z'; CommandLine=('"C:\Authored\node.exe" "' + $scanNextPath + '" start --hostname 127.0.0.1 --port 3210'); OwnerSid=$scanIdentity.User.Value })
$script:connections = @([pscustomobject]@{ OwningProcess=700; LocalAddress='127.0.0.1' })
$script:task = [pscustomobject]@{ State='Running'; Actions=@([pscustomobject]@{ Execute=$scanPowerShell; Arguments=$scanServeArguments; WorkingDirectory=$scanRoot }); Principal=[pscustomobject]@{ UserId=$scanIdentity.User.Value; LogonType='Interactive'; RunLevel='Limited' } }
$script:taskStops=0; $script:killed=@(); $script:events=@(); $script:requests=@()
$script:html='<html><title>SCAN</title><link rel="stylesheet" href="/_next/static/chunks/authored.css"><script src="/_next/static/chunks/authored.js"></script><script src="/_next/static/chunks/authored.js"></script></html>'
$script:badAsset=''
function Get-NetTCPConnection { [CmdletBinding()] param($LocalPort,$State) $script:connections }
function Get-CimInstance { [CmdletBinding()] param($ClassName,$Filter) if ($Filter -match '^ProcessId=(\d+)$') { $script:processes | Where-Object { $_.ProcessId -eq [int]$Matches[1] } } else { $script:processes } }
function Invoke-CimMethod { param($InputObject,$MethodName) [pscustomobject]@{ ReturnValue=0; Sid=$InputObject.OwnerSid } }
function Get-ScheduledTask { param($TaskName) $script:task }
function Stop-ScheduledTask { param($TaskName) $script:taskStops++; $script:task.State='Ready' }
function Stop-Process { [CmdletBinding()] param($Id) $script:killed+= $Id; $script:processes=@($script:processes | Where-Object { $_.ProcessId -ne $Id }); $script:connections=@($script:connections | Where-Object { $_.OwningProcess -ne $Id }) }
function Write-ScanLauncherEvent { param($Message) $script:events+= $Message }
function Invoke-WebRequest {
 param($Uri,[switch]$UseBasicParsing,$TimeoutSec,$MaximumRedirection)
 $script:requests+= [string]$Uri
 if ([string]$Uri -eq $scanUrl) { return [pscustomobject]@{ StatusCode=200; Content=$script:html; Headers=@{'Content-Type'='text/html'} } }
 if ([string]$Uri -eq $script:badAsset) { return [pscustomobject]@{ StatusCode=200; Content='<html>SCAN fallback</html>'; Headers=@{'Content-Type'='text/html'} } }
 if ([string]$Uri -match '\.css$') { return [pscustomobject]@{ StatusCode=200; Content='body { color: navy }'; Headers=@{'Content-Type'='text/css; charset=utf-8'} } }
 return [pscustomobject]@{ StatusCode=200; Content='globalThis.authored = true;'; Headers=@{'Content-Type'='application/javascript; charset=utf-8'} }
}
function Require($Value,[string]$Reason) { if (-not $Value) { throw $Reason } }
function Require-Refusal([scriptblock]$Operation) { $refused=$false; try { & $Operation } catch { $refused=$true }; Require $refused 'Unsafe operation was not refused.' }
`.replace('__SCRIPT__', script);

function check(body) {
  const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { input: harness + '\n' + body + '\n', encoding: 'utf8', timeout: 15_000, windowsHide: true });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stderr.trim(), '', child.stderr);
}
const windows = { skip: process.platform !== 'win32' };

test('desktop listener check tolerates a process and listener disappearing together', windows, () => check(`
$script:processes=@(); $script:tcpReads=0
function Get-NetTCPConnection { [CmdletBinding()] param($LocalPort,$State) $script:tcpReads++; if ($script:tcpReads -eq 1) { $script:connections } }
Require (@(Get-ScanListeners).Count -eq 0) 'Exited listener should be absent.'
Require ($script:tcpReads -eq 2) 'Fresh listener snapshot was not checked.'
Require ($script:killed.Count -eq 0) 'No process may be stopped.'
`));

test('desktop listener check still refuses an unidentifiable active listener', windows, () => check(`
$script:processes=@()
Require-Refusal { Get-ScanListeners }
Require ($script:killed.Count -eq 0) 'No process may be stopped.'
`));

test('desktop readiness verifies all advertised local JS/CSS and deduplicates URLs', windows, () => check(`
Require (Get-ScanReady) 'Healthy authored assets were rejected.'
Require ($script:requests.Count -eq 3) 'Expected dashboard, one CSS and one JS fetch.'
Require ($script:taskStops -eq 0 -and $script:killed.Count -eq 0) 'Readiness mutated the runtime.'
`));

test('desktop readiness rejects stale HTML with missing CSS/JS even when fallback returns 200', windows, () => check(`
$script:badAsset='http://127.0.0.1:3210/_next/static/chunks/authored.css'
Require (-not (Get-ScanReady)) 'Stale CSS was accepted.'
Require ($script:scanReadyReason -match 'CSS asset is unavailable') 'Asset failure needs an actionable reason.'
$script:badAsset='http://127.0.0.1:3210/_next/static/chunks/authored.js'
Require (-not (Get-ScanReady)) 'Stale JS was accepted.'
Require ($script:taskStops -eq 0 -and $script:killed.Count -eq 0) 'Failed readiness mutated the runtime.'
`));

test('desktop readiness refuses an asset-free shell and never requests an external asset', windows, () => check(`
$script:html='<html>SCAN</html>'
Require (-not (Get-ScanReady)) 'Unhydrated shell was accepted.'
$script:requests=@()
$script:html='<html>SCAN<link href="http://example.invalid/_next/static/x.css"><script src="/_next/static/a.js"></script></html>'
Require (-not (Get-ScanReady)) 'Nonlocal asset was accepted.'
Require ($script:requests.Count -eq 1) 'A nonlocal asset was requested.'
`));

test('desktop restart stops only the verified task and its matching orphan Next process', windows, () => check(`
Stop-VerifiedScanServer $script:task
Require ($script:taskStops -eq 1) 'Expected one task stop.'
Require ($script:killed.Count -eq 1 -and $script:killed[0] -eq 700) 'Expected only verified PID 700.'
Require ($script:events.Count -eq 2) 'Task and process stop should be logged.'
`));

test('desktop restart refuses different ports, dev/build operations and foreign owners before stopping', windows, () => check(`
$originalCommand=$script:processes[0].CommandLine
foreach ($replacement in @($originalCommand.Replace('--port 3210','--port 3211'), $originalCommand.Replace(' start ',' dev '), $originalCommand.Replace(' start ',' build '))) {
 $script:processes[0].CommandLine=$replacement
 Require-Refusal { Stop-VerifiedScanServer $script:task }
}
$script:processes[0].CommandLine=$originalCommand
$script:processes[0].OwnerSid='S-1-5-21-2000'
Require-Refusal { Stop-VerifiedScanServer $script:task }
Require ($script:taskStops -eq 0 -and $script:killed.Count -eq 0) 'Unverified runtime was stopped.'
`));

test('desktop restart refuses another same-checkout port even when 3210 is valid', windows, () => check(`
$other=$script:processes[0].PSObject.Copy(); $other.ProcessId=701; $other.CommandLine=$other.CommandLine.Replace('--port 3210','--port 3211')
$script:processes+= $other
Require-Refusal { Stop-VerifiedScanServer $script:task }
Require ($script:taskStops -eq 0 -and $script:killed.Count -eq 0) 'Shared-build guard was bypassed.'
`));

test('desktop restart refuses a different task action or principal before changing anything', windows, () => check(`
$script:task.Actions[0].WorkingDirectory='C:\\Another\\App'
Require-Refusal { Stop-VerifiedScanServer $script:task }
$script:task.Actions[0].WorkingDirectory=$scanRoot
$script:task.Principal.UserId='S-1-5-21-2000'
Require-Refusal { Stop-VerifiedScanServer $script:task }
Require ($script:taskStops -eq 0 -and $script:killed.Count -eq 0) 'Unverified task was stopped.'
`));

test('desktop task verification accepts Windows CIM numeric interactive/limited enums', windows, () => check(`
$script:task.Principal.LogonType=3; $script:task.Principal.RunLevel=0
Assert-ScanTask $script:task
$script:task.Principal.RunLevel=1
Require-Refusal { Assert-ScanTask $script:task }
$script:task.Principal.RunLevel=0; $script:task.Principal.LogonType=5
Require-Refusal { Assert-ScanTask $script:task }
Require ($script:taskStops -eq 0 -and $script:killed.Count -eq 0) 'Verification changed the task or process.'
`));

test('desktop restart rejects a reused process ID instead of stopping the new process', windows, () => check(`
$script:connections=@()
function Get-CimInstance { [CmdletBinding()] param($ClassName,$Filter) if ($Filter -match '^ProcessId=') { $fresh=$script:processes[0].PSObject.Copy(); $fresh.CreationDate=$fresh.CreationDate.AddMinutes(1); $fresh } else { $script:processes } }
Require-Refusal { Stop-VerifiedScanServer $script:task }
Require ($script:killed.Count -eq 0) 'Reused PID was stopped.'
`));
