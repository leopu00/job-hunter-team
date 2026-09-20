# Run the harness on Windows (PowerShell).   Usage:  .\run.ps1 -p "your prompt"
# Windows twin of run.sh. Keys live in .env, which git ignores.

$ErrorActionPreference = "Stop"

# cd into the script's own directory so every path stays relative
Push-Location $PSScriptRoot
try {
    $env:PYTHONSAFEPATH = "1"
    $env:PYTHONPATH = $PSScriptRoot

    uv run --project . --env-file .env --quiet -m app.main @args
}
finally {
    Pop-Location
}
