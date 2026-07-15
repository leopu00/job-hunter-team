param(
    [ValidateSet("boot", "test", "play")]
    [string]$Mode = "boot"
)

$ErrorActionPreference = "Stop"
$GameDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Godot = if ($env:JHT_GODOT_BIN) {
    $env:JHT_GODOT_BIN
}
elseif ($env:GODOT) {
    $env:GODOT
}
else {
    "godot"
}

# setup-godot espone su Windows un symlink senza estensione. Git Bash lo
# esegue, mentre PowerShell non propaga in modo affidabile il relativo exit
# code: dereferenziamo il vero .exe quando il comando e un link locale.
if (Test-Path -LiteralPath $Godot) {
    $GodotItem = Get-Item -LiteralPath $Godot
    $GodotTarget = @($GodotItem.Target)[0]
    if ($GodotTarget) {
        if (-not [System.IO.Path]::IsPathRooted($GodotTarget)) {
            $GodotTarget = Join-Path $GodotItem.DirectoryName $GodotTarget
        }
        $Godot = $GodotTarget
    }
}
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
    param([string[]]$GodotArguments)
    & $Godot @GodotArguments
    $ExitCode = $LASTEXITCODE
    if ($null -eq $ExitCode -or $ExitCode -ne 0) {
        throw "Godot exited with code $ExitCode"
    }
}

$LocationPushed = $false
try {
    Push-Location $GameDir
    $LocationPushed = $true
    $env:JHT_NOVPS = "1"
    Write-Host "[run.ps1] import resources/class cache..."
    Invoke-Godot -GodotArguments @("--headless", "--import", ".")

    switch ($Mode) {
        "test" {
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/nav_grid_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/speech_bubble_selftest.gd")

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
            Invoke-Godot -GodotArguments @("--headless", "--quit-after", "15", ".")
            Remove-Item Env:JHT_SCENE
            Write-Host "[run.ps1] BOOT OK"
        }
        "play" {
            Remove-Item Env:JHT_NOVPS
            Invoke-Godot -GodotArguments @("--path", $GameDir)
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
