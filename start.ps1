param([int]$Port = 8766)
$ErrorActionPreference = 'Stop'
$villageBundled = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
if (Test-Path -LiteralPath $villageBundled) {
    & $villageBundled (Join-Path $PSScriptRoot 'server.py') --port $Port --open-browser
} else {
    $villagePython = Get-Command python -ErrorAction Stop
    & $villagePython.Source (Join-Path $PSScriptRoot 'server.py') --port $Port --open-browser
}
exit $LASTEXITCODE
