param([ValidateSet('worker', 'companion')][string]$Service)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $projectRoot
$localNodeDir = Join-Path $projectRoot '.local/runtimes/node'
if (Test-Path -LiteralPath (Join-Path $localNodeDir 'node.exe')) { $env:PATH = "$localNodeDir;$env:PATH" }
$env:NEXTGEN_INSTANCE_ID = (Get-Content -LiteralPath '.local/instance.json' -Raw | ConvertFrom-Json).instanceId
if ($Service -eq 'worker') {
  & node.exe (Join-Path $projectRoot 'node_modules/wrangler/bin/wrangler.js') dev --local --config (Join-Path $projectRoot '.local/worker/wrangler.json') --port 8787
} else {
  $env:NEXTGEN_WORKER_URL = 'http://127.0.0.1:8787'
  $env:NEXTGEN_CONTROL_TOKEN = (Get-Content -LiteralPath '.local/control.json' -Raw | ConvertFrom-Json).token
  $env:NEXTGEN_HUE_ENABLED = if ((Get-Content -LiteralPath '.local/instance.json' -Raw | ConvertFrom-Json).webOnly) { 'false' } else { 'true' }
  & node.exe apps/hue-companion/src/server.mjs
}
exit $LASTEXITCODE
