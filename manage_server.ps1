param(
  [ValidateSet('start','stop','restart','status')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $ProjectRoot 'server.pid'
$LogDir = Join-Path $ProjectRoot 'logs'
$ServerFile = Join-Path $ProjectRoot 'server.js'
$Port = 8780

function Find-Node {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
  )
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { $candidates += $command.Source }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw 'Node.js 22.5 이상을 찾을 수 없습니다.'
}

function Get-RoutineProcess {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $savedPid = [int](Get-Content -LiteralPath $PidFile -Raw)
  $basicProcess = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if (-not $basicProcess) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
  if (-not $process) {
    throw "PID $savedPid 프로세스의 명령줄을 검증할 수 없어 조작하지 않습니다."
  }
  $normalizedCommand = ($process.CommandLine -replace '/', '\')
  $normalizedServer = ($ServerFile -replace '/', '\')
  if (-not $normalizedCommand.Contains($normalizedServer)) {
    throw "PID $savedPid 은 루틴 서버가 아니므로 조작하지 않습니다."
  }
  return $process
}

function Test-Health {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
    return [bool]$health.ok
  } catch { return $false }
}

function Start-Routine {
  $existing = Get-RoutineProcess
  if ($existing -and (Test-Health)) {
    Write-Output "MyRoutine already running (PID $($existing.ProcessId), port $Port)."
    return
  }
  if ($existing) { throw '루틴 서버 프로세스는 있으나 응답하지 않습니다. status를 확인해 주세요.' }
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $node = Find-Node
  $outLog = Join-Path $LogDir 'server.out.log'
  $errLog = Join-Path $LogDir 'server.err.log'
  $process = Start-Process -FilePath $node -ArgumentList @($ServerFile) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  Set-Content -LiteralPath $PidFile -Value $process.Id -NoNewline
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    if (Test-Health) {
      Write-Output "MyRoutine started (PID $($process.Id), http://127.0.0.1:$Port)."
      return
    }
  }
  throw "루틴 서버가 시작되지 않았습니다. $errLog 를 확인해 주세요."
}

function Stop-Routine {
  $process = Get-RoutineProcess
  if (-not $process) {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Output 'MyRoutine is not running.'
    return
  }
  Stop-Process -Id $process.ProcessId
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 200
    if (-not (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) { break }
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Write-Output "MyRoutine stopped (PID $($process.ProcessId))."
}

switch ($Action) {
  'start' { Start-Routine }
  'stop' { Stop-Routine }
  'restart' { Stop-Routine; Start-Routine }
  'status' {
    $process = Get-RoutineProcess
    if ($process -and (Test-Health)) { Write-Output "RUNNING PID=$($process.ProcessId) PORT=$Port"; exit 0 }
    Write-Output 'STOPPED'; exit 1
  }
}
