param(
  [ValidateSet("Web", "Hue")]
  [string]$Mode,
  [switch]$Check
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

function Write-Step {
  param([int]$Number, [int]$Total, [string]$Message)
  Write-Host ""
  Write-Host "[$Number/$Total] $Message" -ForegroundColor Cyan
}

function Invoke-Npm {
  param([string[]]$Arguments, [string]$FailureMessage)
  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

function Test-Url {
  param([string]$Url, [string]$RequiredText = "")
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and (
      [string]::IsNullOrWhiteSpace($RequiredText) -or $response.Content.Contains($RequiredText)
    )
  } catch {
    return $false
  }
}

function Test-PortInUse {
  param([int]$Port)
  return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-ForUrl {
  param([string]$Url, [string]$RequiredText = "", [int]$Seconds = 45)
  for ($elapsed = 0; $elapsed -lt $Seconds; $elapsed += 1) {
    if (Test-Url -Url $Url -RequiredText $RequiredText) { return }
    Start-Sleep -Seconds 1
  }
  throw "$Url 서버가 ${Seconds}초 안에 준비되지 않았습니다. 새로 열린 서버 창의 오류를 확인해 주세요."
}

function Start-ServiceWindow {
  param([string]$Title, [string]$Command)
  $escapedRoot = $projectRoot.Replace("'", "''")
  $fullCommand = "`$Host.UI.RawUI.WindowTitle='$Title'; Set-Location -LiteralPath '$escapedRoot'; $Command"
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $fullCommand
  ) | Out-Null
}

try {
  Clear-Host
  Write-Host "============================================================" -ForegroundColor DarkCyan
  Write-Host "  NextGenAgent - 빠른 웹 테스트 환경" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor DarkCyan
  Write-Host ""
  Write-Host "로컬 Worker와 테스트용 웹을 자동으로 준비하고 브라우저를 엽니다."
  Write-Host "Hue 장비가 없는 PC에서도 일반 웹 모드는 사용할 수 있습니다."

  Write-Step 1 5 "실행 환경을 확인합니다"
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
      -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "Node.js 또는 npm이 없습니다. https://nodejs.org 에서 Node.js 20 이상을 설치해 주세요."
  }
  $nodeVersion = (& node --version).Trim()
  $nodeMajor = [int]($nodeVersion.TrimStart("v").Split(".")[0])
  if ($nodeMajor -lt 20) { throw "Node.js 20 이상이 필요합니다. 현재 버전: $nodeVersion" }
  Write-Host "  Node.js $nodeVersion" -ForegroundColor Green

  $requiredFiles = @(
    "package.json",
    "apps/web/package.json",
    "apps/worker/package.json",
    "apps/worker/.dev.vars.example"
  )
  foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile)) { throw "필수 파일이 없습니다: $requiredFile" }
  }
  if ($Check) {
    Write-Host ""
    Write-Host "빠른 웹 테스트 실행기 자체 검사가 완료되었습니다." -ForegroundColor Green
    exit 0
  }

  if ([string]::IsNullOrWhiteSpace($Mode)) {
    Write-Host ""
    Write-Host "실행 모드를 선택하세요." -ForegroundColor Yellow
    Write-Host "  1. 일반 웹 테스트 - Hue 없이 웹과 AI 대화 테스트 (권장)"
    Write-Host "  2. Hue 포함 테스트 - 로컬 Worker 응답으로 실제 전구 테스트"
    $selection = (Read-Host "번호를 입력하세요 (기본값 1)").Trim()
    $Mode = if ($selection -eq "2") { "Hue" } else { "Web" }
  }

  if (-not (Test-Path -LiteralPath "apps/worker/.dev.vars")) {
    Copy-Item -LiteralPath "apps/worker/.dev.vars.example" -Destination "apps/worker/.dev.vars"
    Write-Host ""
    Write-Host "로컬 Worker 설정 파일을 생성했습니다:" -ForegroundColor Yellow
    Write-Host "  apps\worker\.dev.vars"
    Write-Host "OPENAI_API_KEY와 OPENAI_VECTOR_STORE_ID를 입력한 뒤 다시 실행하세요."
    Start-Process -FilePath "notepad.exe" -ArgumentList (Resolve-Path "apps/worker/.dev.vars")
    exit 1
  }

  Write-Step 2 5 "프로젝트 패키지를 준비합니다"
  Invoke-Npm -Arguments @("install", "--no-audit", "--no-fund") `
    -FailureMessage "npm 패키지 설치에 실패했습니다. 인터넷 연결과 npm 오류를 확인해 주세요."

  Write-Step 3 5 "로컬 AI Worker를 시작합니다"
  if (Test-Url -Url "http://127.0.0.1:8787/api/health" -RequiredText '"ok":true') {
    Write-Host "  기존 Worker를 사용합니다: http://127.0.0.1:8787" -ForegroundColor Green
  } else {
    if (Test-PortInUse -Port 8787) { throw "8787 포트를 다른 프로그램이 사용 중입니다." }
    Start-ServiceWindow -Title "NextGenAgent Local Worker" -Command "npm.cmd run dev:worker"
    Wait-ForUrl -Url "http://127.0.0.1:8787/api/health" -RequiredText '"ok":true'
    Write-Host "  Worker 준비 완료" -ForegroundColor Green
  }

  Write-Step 4 5 "테스트 웹을 시작합니다"
  if ($Mode -eq "Hue") {
    if (-not (Test-Path -LiteralPath "apps/hue-companion/.local/config.json")) {
      throw "Hue 설정이 없습니다. setup-hue.bat를 먼저 실행하거나 일반 웹 모드를 선택하세요."
    }
    Invoke-Npm -Arguments @("--workspace", "@nextgen/web", "run", "build") `
      -FailureMessage "테스트 웹 빌드에 실패했습니다."
    if (Test-PortInUse -Port 4173) {
      throw "4173 포트가 이미 사용 중입니다. 기존 Hue Companion 창을 닫고 다시 실행하세요."
    }
    Start-ServiceWindow -Title "NextGenAgent Hue Test" `
      -Command "`$env:NEXTGEN_WORKER_URL='http://127.0.0.1:8787'; npm.cmd --workspace @nextgen/hue-companion run start"
    Wait-ForUrl -Url "http://127.0.0.1:4173" -RequiredText "NextGenAgent"
    $testUrl = "http://127.0.0.1:4173"
  } else {
    if (Test-Url -Url "http://127.0.0.1:5173" -RequiredText "NextGenAgent") {
      Write-Host "  기존 웹 서버를 사용합니다: http://127.0.0.1:5173" -ForegroundColor Green
    } else {
      if (Test-PortInUse -Port 5173) { throw "5173 포트를 다른 프로그램이 사용 중입니다." }
      Start-ServiceWindow -Title "NextGenAgent Test Web" -Command "npm.cmd run dev:web"
      Wait-ForUrl -Url "http://127.0.0.1:5173" -RequiredText "NextGenAgent"
    }
    $testUrl = "http://127.0.0.1:5173"
  }

  Write-Step 5 5 "브라우저를 엽니다"
  Start-Process $testUrl
  Write-Host ""
  Write-Host "테스트 환경 준비 완료: $testUrl" -ForegroundColor Green
  if ($Mode -eq "Hue") {
    Write-Host "오른쪽 아래에 '조명 연결됨'이 표시되는지 확인하세요."
  }
  Write-Host "서버를 종료하려면 새로 열린 각 서버 창에서 Ctrl+C를 누르세요."
  Write-Host ""
  [void](Read-Host "Enter를 누르면 이 안내 창만 닫힙니다")
  exit 0
} catch {
  Write-Host ""
  Write-Host "테스트 환경을 시작하지 못했습니다." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if (-not $Check) {
    Write-Host ""
    [void](Read-Host "Enter를 누르면 종료합니다")
  }
  exit 1
}
