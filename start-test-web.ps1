param(
  [ValidateSet("Web", "Hue")][string]$Mode = "Web",
  [switch]$Voice,
  [switch]$Check
)
& (Join-Path $PSScriptRoot 'start_program.ps1') -Mode $Mode -Voice:$Voice -Check:$Check
exit $LASTEXITCODE
