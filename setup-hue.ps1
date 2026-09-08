param(
  [switch]$Check
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

function Write-Step {
  param(
    [int]$Number,
    [string]$Message
  )

  Write-Host ""
  Write-Host "[$Number/4] $Message" -ForegroundColor Cyan
}

function Invoke-ProjectCommand {
  param(
    [string[]]$Arguments,
    [string]$FailureMessage
  )

  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Wait-ForUser {
  Write-Host ""
  [void](Read-Host "Enter를 누르면 종료합니다")
}

try {
  Clear-Host
  Write-Host "============================================================" -ForegroundColor DarkYellow
  Write-Host "  NextGenAgent - Philips Hue 설치 마법사" -ForegroundColor Yellow
  Write-Host "============================================================" -ForegroundColor DarkYellow
  Write-Host ""
  Write-Host "이 마법사가 다음 작업을 순서대로 진행합니다."
  Write-Host "  1. Node.js와 npm 확인"
  Write-Host "  2. 프로젝트 패키지 설치"
  Write-Host "  3. 프로젝트 빌드 검사"
  Write-Host "  4. Hue Bridge 및 전구 연결"
  Write-Host ""
  Write-Host "준비 사항" -ForegroundColor Yellow
  Write-Host "  - 이 PC와 Hue Bridge가 같은 네트워크에 연결되어 있어야 합니다."
  Write-Host "  - 안내가 나오면 Bridge 가운데 버튼만 한 번 누르면 됩니다."
  Write-Host "  - 서로 다른 컬러 Hue 전구 4개가 필요합니다."

  if (-not $Check) {
    Write-Host ""
    [void](Read-Host "준비되었으면 Enter를 누르세요")
  }

  Write-Step 1 "실행 환경을 확인합니다"
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $nodeCommand -or -not $npmCommand) {
    throw "Node.js 또는 npm을 찾지 못했습니다. https://nodejs.org 에서 Node.js 20 이상을 설치해 주세요."
  }

  $nodeVersion = (& node --version).Trim()
  $npmVersion = (& npm.cmd --version).Trim()
  $nodeMajor = [int]($nodeVersion.TrimStart("v").Split(".")[0])
  if ($nodeMajor -lt 20) {
    throw "Node.js 20 이상이 필요합니다. 현재 버전은 $nodeVersion 입니다."
  }
  Write-Host "  Node.js $nodeVersion" -ForegroundColor Green
  Write-Host "  npm $npmVersion" -ForegroundColor Green

  if ($Check) {
    $requiredFiles = @(
      "package.json",
      "apps/hue-companion/src/setup.mjs",
      "apps/hue-companion/src/server.mjs"
    )
    foreach ($requiredFile in $requiredFiles) {
      if (-not (Test-Path -LiteralPath $requiredFile)) {
        throw "필수 파일을 찾지 못했습니다: $requiredFile"
      }
    }
    Write-Host ""
    Write-Host "설치 마법사 자체 검사가 완료되었습니다." -ForegroundColor Green
    exit 0
  }

  Write-Step 2 "프로젝트 패키지를 설치합니다"
  Invoke-ProjectCommand -Arguments @("install", "--no-audit", "--no-fund") `
    -FailureMessage "프로젝트 패키지 설치에 실패했습니다. 인터넷 연결과 npm 오류를 확인해 주세요."

  Write-Step 3 "프로젝트 빌드를 검사합니다"
  Invoke-ProjectCommand -Arguments @("run", "build") `
    -FailureMessage "프로젝트 빌드 검사에 실패했습니다. 위의 오류 내용을 확인해 주세요."

  Write-Step 4 "Hue Bridge와 전구를 연결합니다"
  Write-Host ""
  Write-Host "Bridge를 자동으로 검색합니다." -ForegroundColor Yellow
  Write-Host "검색되지 않으면 Philips Hue 앱에 표시된 Bridge IP를 입력하세요."
  Write-Host "가운데 버튼 입력은 자동 감지되므로 Enter를 누를 필요가 없습니다."
  Write-Host "각 선배에게 서로 다른 전구를 선택하면 해당 전구가 잠시 점등됩니다."
  Write-Host ""
  Invoke-ProjectCommand -Arguments @("run", "hue:setup") `
    -FailureMessage "Hue 연결 설정을 완료하지 못했습니다."

  Write-Host ""
  Write-Host "============================================================" -ForegroundColor DarkGreen
  Write-Host "  Philips Hue 설정이 완료되었습니다." -ForegroundColor Green
  Write-Host "============================================================" -ForegroundColor DarkGreen
  Write-Host ""
  Write-Host "설정 파일: apps\hue-companion\.local\config.json"
  Write-Host "이 파일은 Git에서 제외되며 외부에 공유하면 안 됩니다." -ForegroundColor DarkGray
  Write-Host ""

  $launch = Read-Host "지금 Hue 데모를 실행할까요? (Y/n)"
  if ([string]::IsNullOrWhiteSpace($launch) -or $launch -match "^[Yy]$") {
    Write-Host ""
    Write-Host "데모 서버를 새 창에서 시작합니다..." -ForegroundColor Cyan
    $escapedRoot = $projectRoot.Replace("'", "''")
    $command = "Set-Location -LiteralPath '$escapedRoot'; npm.cmd run demo:hue"
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-NoExit",
      "-NoProfile",
      "-Command",
      $command
    )
    Start-Sleep -Seconds 3
    Start-Process "http://127.0.0.1:4173"
    Write-Host "브라우저에서 http://127.0.0.1:4173 을 열었습니다." -ForegroundColor Green
    Write-Host "종료할 때는 데모 서버 창에서 Ctrl+C를 누르세요."
  } else {
    Write-Host "나중에 npm run demo:hue 명령으로 시작할 수 있습니다."
  }

  Wait-ForUser
  exit 0
} catch {
  Write-Host ""
  Write-Host "설정을 완료하지 못했습니다." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Write-Host "확인할 항목:" -ForegroundColor Yellow
  Write-Host "  - PC와 Hue Bridge가 같은 네트워크인지"
  Write-Host "  - Bridge와 전구의 전원이 켜져 있는지"
  Write-Host "  - 안내 후 45초 안에 Bridge 가운데 버튼을 눌렀는지"
  Write-Host "  - 컬러 Hue 전구가 4개 이상 연결되어 있는지"
  if (-not $Check) {
    Wait-ForUser
  }
  exit 1
}
