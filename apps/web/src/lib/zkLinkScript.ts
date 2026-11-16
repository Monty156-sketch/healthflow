// The small program for the hospital PC that has ZKBio Time on it. It reads new punches from ZKBio Time's own
// web interface (on that PC) and sends them to HealthFlow every minute. Windows PowerShell only; nothing to install.
export function zkLinkScript(healthflowUrl: string, key: string): string {
  return String.raw`# HealthFlow link for ZKBio Time
# Run this once on the PC that has ZKBio Time, in a PowerShell window opened in this folder:
#   powershell -ExecutionPolicy Bypass -File .\HealthFlowLink.ps1
# Check it first without sending anything:
#   powershell -ExecutionPolicy Bypass -File .\HealthFlowLink.ps1 -Test
param([switch]$Test, [switch]$Run)
$ErrorActionPreference = 'Stop'
$HF   = '${healthflowUrl}'
$KEY  = '${key}'
$dir  = Join-Path $env:LOCALAPPDATA 'HealthFlowLink'
$cfg  = Join-Path $dir 'zkbio.json'
$self = Join-Path $dir 'HealthFlowLink.ps1'
$stateFile = Join-Path $dir 'state.json'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Ask-Settings {
  Write-Host 'First time set-up. These stay on this PC.'
  $url  = Read-Host 'Address you open ZKBio Time at in the browser (for example http://localhost:8081)'
  $user = Read-Host 'ZKBio Time user name'
  $pass = Read-Host 'ZKBio Time password' -AsSecureString
  @{ url = $url.TrimEnd('/'); user = $user; pass = ($pass | ConvertFrom-SecureString) } | ConvertTo-Json | Set-Content -Path $cfg
}
if (-not (Test-Path $cfg)) { Ask-Settings }
$c = Get-Content $cfg -Raw | ConvertFrom-Json
$secure = $c.pass | ConvertTo-SecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

function Get-Token {
  $r = Invoke-RestMethod -Method Post -Uri ($c.url + '/jwt-api-token-auth/') -ContentType 'application/json' -Body (@{ username = $c.user; password = $plain } | ConvertTo-Json)
  return $r.token
}
function Get-Transactions($token, $from, $to) {
  $all = @()
  $page = 1
  do {
    $uri = $c.url + '/iclock/api/transactions/?page=' + $page + '&page_size=500&start_time=' + [uri]::EscapeDataString($from) + '&end_time=' + [uri]::EscapeDataString($to)
    try { $r = Invoke-RestMethod -Uri $uri -Headers @{ Authorization = ('JWT ' + $token) } }
    catch { $r = Invoke-RestMethod -Uri $uri -Headers @{ Authorization = ('Bearer ' + $token) } }
    $all += $r.data
    $page++
  } while ($r.next)
  return $all
}
function To-Punch($t) {
  $dept = $t.department
  if ($dept -and $dept.PSObject.Properties.Name -contains 'dept_name') { $dept = $dept.dept_name }
  @{ code = [string]$t.emp_code; time = [string]$t.punch_time; state = [string]$t.punch_state_display; name = (($t.first_name + ' ' + $t.last_name).Trim()); dept = [string]$dept }
}

# The last 20 hours every time (a night shift is 12 or 13), so a check-out always arrives with its check-in.
# Nothing is sent unless something new has happened: HealthFlow is only bothered when a punch actually arrives.
# If this PC was off or offline, it goes back 20 hours before the last time it ran, so nothing from the gap is missed (up to 31 days).
$state = $null
if (Test-Path $stateFile) { $state = Get-Content $stateFile -Raw | ConvertFrom-Json }
$start = (Get-Date).AddHours(-20)
if ($state -and $state.lastRun) {
  $back = ([datetime]::Parse($state.lastRun)).AddHours(-20)
  if ($back -lt $start) { $start = $back }
}
if ($start -lt (Get-Date).AddDays(-31)) { $start = (Get-Date).AddDays(-31) }
$to   = (Get-Date).AddDays(1).ToString('yyyy-MM-dd 00:00:00')
$from = $start.ToString('yyyy-MM-dd HH:mm:ss')
$token = Get-Token
$tx = @(Get-Transactions $token $from $to)
$newest = ($tx | ForEach-Object { [string]$_.punch_time } | Sort-Object | Select-Object -Last 1)
$sig = [string]$tx.Count + '|' + $newest
Write-Host ('ZKBio Time gave ' + $tx.Count + ' punches since ' + $from + '.')
if ($Test) {
  $tx | Select-Object -First 5 | ForEach-Object { Write-Host ((To-Punch $_) | ConvertTo-Json -Compress) }
  Write-Host 'Test only: nothing was sent to HealthFlow.'
  return
}
$last = $null
if ($state) { $last = $state.sig }
if ($tx.Count -gt 0 -and $sig -ne $last) {
  $punches = @($tx | ForEach-Object { To-Punch $_ })
  for ($i = 0; $i -lt $punches.Count; $i += 500) {
    $chunk = @($punches[$i..([Math]::Min($i + 499, $punches.Count - 1))])
    $body = @{ punches = $chunk } | ConvertTo-Json -Depth 4
    $res = Invoke-RestMethod -Method Post -Uri ($HF + '/api/clock-link/punches') -Headers @{ Authorization = ('Bearer ' + $KEY) } -ContentType 'application/json' -Body $body
    Write-Host ('Sent ' + $res.received + ' punches. New attendance records: ' + $res.newAttendance)
  }
  @{ sig = $sig; lastRun = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path $stateFile
} else {
  Write-Host 'Nothing new to send.'
  @{ sig = $last; lastRun = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path $stateFile
}

# First run by hand: keep a copy here and ask Windows to run it every minute.
if (-not $Run -and $MyInvocation.MyCommand.Path -ne $self) {
  Copy-Item -Path $MyInvocation.MyCommand.Path -Destination $self -Force
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $self + '" -Run')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName 'HealthFlow link' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host 'Done. This PC will now send new punches to HealthFlow every minute while it is on and you are signed in.'
  Read-Host 'Press Enter to close'
}
`;
}
