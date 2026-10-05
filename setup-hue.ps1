param([switch]$Check)
& (Join-Path $PSScriptRoot 'start_program.ps1') -RegisterHue @PSBoundParameters
exit $LASTEXITCODE