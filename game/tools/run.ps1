param(
    [ValidateSet("boot", "test", "play")]
    [string]$Mode = "boot"
)

$ErrorActionPreference = "Stop"
$GameDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Godot = if ($env:JHT_GODOT_BIN) { $env:JHT_GODOT_BIN } else { "godot" }

function Invoke-Godot {
    param([string[]]$Arguments)
    & $Godot @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Godot exited with code $LASTEXITCODE"
    }
}

Push-Location $GameDir
try {
    $env:JHT_NOVPS = "1"
    Write-Host "[run.ps1] import resources/class cache..."
    Invoke-Godot @("--headless", "--import", ".")

    switch ($Mode) {
        "test" {
            Invoke-Godot @("--headless", "--script", "res://tools/nav_grid_selftest.gd")
            Invoke-Godot @("--headless", "--script", "res://tools/speech_bubble_selftest.gd")

            $env:JHT_VPS_CONTRACT_TEST = "1"
            $out = (& $Godot --headless --quit-after 3 . 2>&1 | Out-String)
            Remove-Item Env:JHT_VPS_CONTRACT_TEST
            if ($LASTEXITCODE -ne 0 -or $out -notmatch "VPS-CONTRACT-TEST PASS") { throw $out }

            $env:JHT_SCENE = "office"
            $env:JHT_PIPELINE_FORCE_TEST = "scout"
            $out = (& $Godot --headless . 2>&1 | Out-String)
            Remove-Item Env:JHT_PIPELINE_FORCE_TEST
            if ($LASTEXITCODE -ne 0 -or $out -notmatch "PIPELINE-FORCE-TEST PASS") { throw $out }

            $env:JHT_DOCTOR_TEST = "scout-4"
            $out = (& $Godot --headless . 2>&1 | Out-String)
            Remove-Item Env:JHT_DOCTOR_TEST
            Remove-Item Env:JHT_SCENE
            if ($LASTEXITCODE -ne 0 -or $out -notmatch "SIMULATION-DOCTOR-TEST PASS") { throw $out }
            Write-Host "[run.ps1] TEST OK"
        }
        "boot" {
            $env:JHT_SCENE = "office"
            Invoke-Godot @("--headless", "--quit-after", "15", ".")
            Remove-Item Env:JHT_SCENE
            Write-Host "[run.ps1] BOOT OK"
        }
        "play" {
            Remove-Item Env:JHT_NOVPS
            Invoke-Godot @("--path", $GameDir)
        }
    }
}
finally {
    Pop-Location
}
