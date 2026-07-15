param(
    [ValidateSet("boot", "test", "play")]
    [string]$Mode = "boot"
)

$ErrorActionPreference = "Stop"
$GameDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Godot = if ($env:JHT_GODOT_BIN) { $env:JHT_GODOT_BIN } else { "godot" }
$EnvNames = @(
    "JHT_NOVPS", "JHT_VPS_CONTRACT_TEST", "JHT_SCENE",
    "JHT_PIPELINE_FORCE_TEST", "JHT_DOCTOR_TEST"
)
$SavedEnv = @{}
foreach ($Name in $EnvNames) {
    $SavedEnv[$Name] = if (Test-Path "Env:$Name") { (Get-Item "Env:$Name").Value } else { $null }
}

# Un mutex per utente protegge anche worktree diversi dalla corruzione della
# cache Godot causata da import/test concorrenti sullo stesso PC Windows.
$GodotMutex = [System.Threading.Mutex]::new($false, "JHTGameGodot")
$HasMutex = $false
try {
    $HasMutex = $GodotMutex.WaitOne(0)
}
catch [System.Threading.AbandonedMutexException] {
    $HasMutex = $true
}
if (-not $HasMutex) {
    $GodotMutex.Dispose()
    throw "Another JHT Godot run is already active on this Windows account."
}

function Invoke-Godot {
    param([string[]]$Arguments)
    & $Godot @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Godot exited with code $LASTEXITCODE"
    }
}

$LocationPushed = $false
try {
    Push-Location $GameDir
    $LocationPushed = $true
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
    if ($LocationPushed) { Pop-Location }
    foreach ($Name in $EnvNames) {
        if ($null -eq $SavedEnv[$Name]) {
            Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item "Env:$Name" $SavedEnv[$Name]
        }
    }
    if ($HasMutex) { $GodotMutex.ReleaseMutex() }
    $GodotMutex.Dispose()
}
