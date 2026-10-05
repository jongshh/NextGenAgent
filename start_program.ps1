param(
  [ValidateSet('Web', 'Hue')][string]$Mode = 'Hue',
  [switch]$Voice,
  [switch]$Check,
  [switch]$Stop,
  [switch]$SyncDb,
  [switch]$RedeploySupabase,
  [switch]$RegisterHue
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-Required {
  param([string]$Executable, [string[]]$Arguments)
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "명령 실행 실패: $Executable (종료 코드 $LASTEXITCODE). 위 진단을 확인하세요." }
}
function Resolve-Node {
  $localNode = Join-Path $projectRoot '.local/runtimes/node/node.exe'
  if (Test-Path -LiteralPath $localNode) { $env:PATH = "$(Split-Path $localNode);$env:PATH"; return $localNode }
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) {
    $major = [int]((& $command.Source -p 'process.versions.node.split(String.fromCharCode(46))[0]').Trim())
    if ($major -ge 22) { return $command.Source }
  }
  if ($Check -or $Stop) { throw 'Node.js 22 이상이 없거나 PATH에 없습니다.' }
  Write-Host 'Node.js 22 실행 환경을 공식 배포본으로 준비합니다.' -ForegroundColor Cyan
  $versions = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -TimeoutSec 30
  $release = $versions | Where-Object { $_.version -match '^v22\.' -and $_.lts } | Select-Object -First 1
  if (-not $release) { throw 'Node.js 배포 목록을 조회하지 못했습니다. nodejs.org에서 Node.js 22 이상을 설치하세요.' }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-$($release.version)-win-$arch"
  $downloadDir = Join-Path $projectRoot '.local/runtimes'
  [void](New-Item -ItemType Directory -Path $downloadDir -Force)
  $zip = Join-Path $downloadDir "$name.zip"
  Invoke-WebRequest "https://nodejs.org/dist/$($release.version)/$name.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 120
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt" -UseBasicParsing -TimeoutSec 30).Content
  $expected = ($sums -split "`n" | Where-Object { $_ -match "  $([Regex]::Escape($name)).zip\s*$" } | Select-Object -First 1) -split '\s+'
  if (-not $expected -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected[0]) { throw 'Node.js 다운로드 무결성 검사 실패' }
  Expand-Archive -LiteralPath $zip -DestinationPath $downloadDir -Force
  $nodeExtracted = [IO.Path]::GetFullPath((Join-Path $downloadDir $name))
  $nodeTarget = [IO.Path]::GetFullPath((Join-Path $downloadDir 'node'))
  $runtimeBoundary = [IO.Path]::GetFullPath($downloadDir).TrimEnd('\') + '\'
  if (-not $nodeExtracted.StartsWith($runtimeBoundary, [StringComparison]::OrdinalIgnoreCase) -or
      -not $nodeTarget.StartsWith($runtimeBoundary, [StringComparison]::OrdinalIgnoreCase)) { throw '실행 환경 경로 검증 실패' }
  Move-Item -LiteralPath $nodeExtracted -Destination $nodeTarget
  $env:PATH = "$(Split-Path $localNode);$env:PATH"
  return $localNode
}
function Resolve-Python {
  $localPython = Join-Path $projectRoot '.local/runtimes/python/python.exe'
  $existingPdfPython = Join-Path $projectRoot '.local/python-venv/Scripts/python.exe'
  if (Test-Path -LiteralPath $existingPdfPython) {
    & $existingPdfPython -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
    if ($LASTEXITCODE -eq 0) { return $existingPdfPython }
  }
  if ($env:NEXTGEN_PYTHON -and (Test-Path -LiteralPath $env:NEXTGEN_PYTHON)) { return $env:NEXTGEN_PYTHON }
  if (Test-Path -LiteralPath $localPython) { return $localPython }
  foreach ($candidate in @('python.exe', 'python3.exe')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command -and $command.Source -notmatch 'WindowsApps') {
      & $command.Source -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
      if ($LASTEXITCODE -eq 0) { return $command.Source }
    }
  }
  if ($Check) { throw 'Python 3.10 이상이 없습니다.' }
  Write-Host 'PDF 처리용 Python을 사용자 범위로 설치합니다.' -ForegroundColor Cyan
  $downloadDir = Join-Path $projectRoot '.local/runtimes'
  [void](New-Item -ItemType Directory -Path $downloadDir -Force)
  $installer = Join-Path $downloadDir 'python-installer.exe'
  $pythonArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
  Invoke-WebRequest "https://www.python.org/ftp/python/3.13.7/python-3.13.7-$pythonArch.exe" -OutFile $installer -UseBasicParsing -TimeoutSec 120
  if ((Get-AuthenticodeSignature -LiteralPath $installer).Status -ne 'Valid') { throw 'Python 설치 파일 서명 검사 실패. python.org에서 직접 설치하세요.' }
  $target = Split-Path -Parent $localPython
  $process = Start-Process -FilePath $installer -WindowStyle Hidden -Wait -PassThru -ArgumentList @('/quiet', 'InstallAllUsers=0', 'Include_launcher=0', 'Include_test=0', 'Include_pip=1', 'PrependPath=0', "TargetDir=`"$target`"")
  if ($process.ExitCode -notin @(0, 3010) -or -not (Test-Path -LiteralPath $localPython)) { throw 'Python 자동 설치 실패. Python 3.10 이상을 직접 설치한 뒤 다시 실행하세요.' }
  return $localPython
}
function Get-ServiceHealth {
  param([string]$Url)
  try { return Invoke-RestMethod -Uri $Url -TimeoutSec 2 } catch { return $null }
}
function Start-LocalService {
  param([string]$Name, [int]$Port, [string]$HealthUrl, [string]$InstanceId)
  $health = Get-ServiceHealth $HealthUrl
  if ($health -and $health.project -eq 'nextgenagent' -and $health.instanceId -eq $InstanceId) {
    Write-Host "기존 $Name 서버를 재사용합니다." -ForegroundColor Green
    return
  }
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "$Port 포트가 다른 프로그램 또는 이전 버전에서 사용 중입니다. start_program.bat -Stop으로 이 실행기의 서버를 종료하거나 점유 프로그램을 확인하세요."
  }
  $logRoot = Join-Path $projectRoot 'logs'
  [void](New-Item -ItemType Directory -Path $logRoot -Force)
  $script = Join-Path $projectRoot 'scripts/service.ps1'
  $process = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script`"", '-Service', $Name) -RedirectStandardOutput (Join-Path $logRoot "$Name.out.log") -RedirectStandardError (Join-Path $logRoot "$Name.err.log")
  $records = @{}
  if (Test-Path -LiteralPath '.local/services.json') {
    $previous = Get-Content -LiteralPath '.local/services.json' -Raw | ConvertFrom-Json
    foreach ($property in $previous.PSObject.Properties) { $records[$property.Name] = $property.Value }
  }
  $owned = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
  $records[$Name] = @{ pid = $process.Id; creationDate = $owned.CreationDate.ToUniversalTime().ToString('o') }
  $records | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath '.local/services.json' -Encoding UTF8
  for ($elapsed = 0; $elapsed -lt 60; $elapsed++) {
    $health = Get-ServiceHealth $HealthUrl
    if ($health -and $health.project -eq 'nextgenagent' -and $health.instanceId -eq $InstanceId) { return }
    if ($process.HasExited) { break }
    Start-Sleep -Seconds 1
  }
  throw "$Name 시작 실패. logs/$Name.err.log와 logs/$Name.out.log를 확인하세요. start_program.bat -Stop으로 이번 실행의 서버를 종료할 수 있습니다."
}
function Stop-LocalServices {
  if (-not (Test-Path -LiteralPath '.local/services.json')) { Write-Host '이 실행기가 기록한 서버가 없습니다.'; return }
  & $node scripts/runtime.mjs shutdown
  Start-Sleep -Seconds 5
  $records = Get-Content -LiteralPath '.local/services.json' -Raw | ConvertFrom-Json
  $expectedScript = Join-Path $projectRoot 'scripts/service.ps1'
  foreach ($property in $records.PSObject.Properties) {
    $record = $property.Value
    $owned = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$record.pid)" -ErrorAction SilentlyContinue
    if (-not $owned) { continue }
    if ($owned.CreationDate.ToUniversalTime().ToString('o') -ne $record.creationDate -or
        -not $owned.CommandLine.Contains($expectedScript)) {
      Write-Host "$($property.Name): 프로세스 소유권이 일치하지 않아 종료하지 않았습니다."; continue
    }
    & taskkill.exe /PID $record.pid /T /F | Out-Null
  }
  Write-Host '이 실행기의 서버 종료를 완료했습니다.'
}
try {
  Write-Host 'NextGenAgent 통합 실행기' -ForegroundColor Cyan
  $node = Resolve-Node
  if ($Stop) { Stop-LocalServices; exit 0 }
  if ($Check) {
    $issues = 0
    try { $python = Resolve-Python; & $python -c 'import pypdf'; if ($LASTEXITCODE -ne 0) { $issues++ } } catch { Write-Host $_.Exception.Message; $issues++ }
    & $node scripts/runtime.mjs check
    if ($LASTEXITCODE -ne 0) { $issues++ }
    foreach ($port in @(4173, 5173, 8787)) {
      if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { Write-Host "포트 $port 사용 중" }
    }
    if ($issues) { exit 1 }; exit 0
  }
  Invoke-Required $node @('scripts/runtime.mjs', 'prepare')
  & $node scripts/runtime.mjs needs-install
  if ($LASTEXITCODE -eq 10) {
    Invoke-Required 'npm.cmd' @('ci', '--no-audit', '--no-fund')
    Invoke-Required $node @('scripts/runtime.mjs', 'stamp')
  } elseif ($LASTEXITCODE -ne 0) { throw '패키지 진단 실패' }
  $python = Resolve-Python
  $pdfPython = Join-Path $projectRoot '.local/python-venv/Scripts/python.exe'
  if (-not (Test-Path -LiteralPath $pdfPython)) { Invoke-Required $python @('-m', 'venv', (Join-Path $projectRoot '.local/python-venv')) }
  & $pdfPython -c 'import pypdf; assert tuple(map(int,pypdf.__version__.split(chr(46)))) == (5,9,0)'
  if ($LASTEXITCODE -ne 0) { Invoke-Required $pdfPython @('-m', 'pip', 'install', '-r', 'scripts/requirements.txt') }
  $python = $pdfPython
  & $node scripts/runtime.mjs needs-sync
  if ($SyncDb -or $LASTEXITCODE -eq 10) {
    $env:PYTHONIOENCODING = 'utf-8'
    Invoke-Required $python @('packages/rag/scripts/process_interview_pdf.py', '--all', '.local/candidate')
    Invoke-Required $node @('packages/rag/scripts/upload_vector_store.mjs', '.local/candidate')
  } elseif ($LASTEXITCODE -ne 0) { throw 'DB 동기화 진단 실패' }
  $remoteArgs = @('scripts/runtime.mjs', 'supabase')
  if ($RedeploySupabase) { $remoteArgs += '--force' }
  Invoke-Required $node $remoteArgs
  Invoke-Required 'npm.cmd' @('--workspace', '@nextgen/web', 'run', 'build')
  $configArgs = @('scripts/runtime.mjs', 'worker-config')
  if ($Mode -eq 'Web') { $configArgs += '--web' }
  Invoke-Required $node $configArgs
  $instance = (Get-Content -LiteralPath '.local/instance.json' -Raw | ConvertFrom-Json).instanceId
  Start-LocalService 'worker' 8787 'http://127.0.0.1:8787/api/health' $instance
  # The Companion serves the built UI in both modes. Web mode simply skips Hue setup.
  Start-LocalService 'companion' 4173 'http://127.0.0.1:4173/health' $instance
  Start-Process 'http://127.0.0.1:4173'
  $developerUrl = if ($RegisterHue) { 'http://127.0.0.1:4173/developer/lights' } else { 'http://127.0.0.1:4173/developer' }
  Start-Process $developerUrl
  Write-Host '실행 완료: http://127.0.0.1:4173' -ForegroundColor Green
  Write-Host '조명 장비가 없으면 웹·음성만 사용할 수 있습니다. 조명은 개발자 탭에서 등록하세요.'
  Write-Host '서버 종료: start_program.bat -Stop / 진단: start_program.bat -Check'
  exit 0
} catch {
  Write-Host '실행을 완료하지 못했습니다.' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
