# run.ps1 e' il "run.sh test" di chi sviluppa su Windows: senza, un PC Windows
# non vede il guard delle 7 lingue prima di pushare.
#
# La lista dei test NON vive qui: sta in tools/test-matrix.txt, unica fonte
# consumata anche da run.sh e da .github/workflows/game.yml. Le voci marcate
# `posix` vengono saltate, ma A VOCE: un test che sparisce in silenzio e' un
# test perduto, ed e' esattamente cosi' che le tre liste erano divergite.
param(
    [ValidateSet("boot", "test", "play")]
    [string]$Mode = "boot",
    [ValidateSet("gate", "watch", "all")]
    [string]$Tier = "all"
)

$ErrorActionPreference = "Stop"
$GameDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$IsWindowsHost = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
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

# --- tools/test-matrix.txt: unica fonte di verita' dei selftest ---------------
# Formato: id|kind|tier|platform|env|target|marker  (documentato nel file).
function Get-TestMatrix {
    $Path = Join-Path $PSScriptRoot "test-matrix.txt"
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "tools/test-matrix.txt non trovato: nessun test da eseguire"
    }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $Line = $_.Trim()
        if ($Line -eq "" -or $Line.StartsWith("#")) { return }
        $F = $Line.Split("|")
        if ($F.Count -ne 7) { throw "riga malformata in test-matrix.txt: $Line" }
        [pscustomobject]@{
            Id       = $F[0]
            Kind     = $F[1]
            Tier     = $F[2]
            Platform = $F[3]
            # `@(...)` attorno a Split NON e' ridondante: su una riga con UN
            # solo campo (nessuno spazio) Split restituisce una STRINGA, non un
            # array, e da li' `$T.Target[0]` indicizza il primo CARATTERE. Il
            # risultato era `--script res://t` su ogni selftest, cioe' l'intera
            # matrice rossa su Windows con l'errore "Resource file not found:
            # res://t", che non somiglia affatto alla sua causa. macOS e Linux
            # non lo vedevano: run.sh non passa da qui.
            Env      = @(if ($F[4] -eq "-") { @() } else { $F[4].Split(" ") })
            Target   = @(if ($F[5] -eq "-") { @() } else { $F[5].Split(" ") })
            Marker   = $(if ($F[6] -eq "-") { $null } else { $F[6] })
        }
    }
}

$TestMatrix = @(Get-TestMatrix)

# Le variabili d'ambiente da salvare e ripristinare escono dalla matrice, non
# da un elenco a mano che restava indietro a ogni test aggiunto.
$EnvNames = @("JHT_NOVPS") + @(
    $TestMatrix | ForEach-Object { $_.Env } | ForEach-Object { $_.Split("=")[0] }
) | Select-Object -Unique
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

function New-GodotProcessInfo {
    param(
        [string[]]$GodotArguments,
        [bool]$CaptureOutput
    )
    $Info = [System.Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $Godot
    $Info.WorkingDirectory = $GameDir
    $Info.UseShellExecute = $false
    # ProcessStartInfo.Arguments funziona anche su Windows PowerShell 5.1.
    # Gli argomenti usati qui non terminano con backslash; quotiamo quelli con
    # spazi per supportare checkout e home directory non banali.
    $Info.Arguments = (($GodotArguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
    }) -join ' ')
    $Info.RedirectStandardOutput = $CaptureOutput
    $Info.RedirectStandardError = $CaptureOutput
    return $Info
}

# Il runner Windows va in ACCESS_VIOLATION (0xC0000005 = -1073741819) durante
# la catena di ~26 avvii di Godot che questo blocco esegue in fila. Ogni uscita
# lascia risorse dietro di se' ("N ObjectDB instances were leaked", "N resources
# still in use") e a un certo punto un avvio non regge -- ma **il punto si
# sposta**: il 2026-07-29 e' caduto sull'export, il 2026-07-30 su
# sidebar_nav_selftest, che nel run precedente era passato.
#
# Un crash che cambia bersaglio non e' il segnale di un test rotto: e' il segnale
# che l'ambiente non regge la sequenza. Il rimedio e' dare fiato fra un processo
# e il successivo e riprovare **una** volta il singolo avvio, gridandolo nel
# log. Un test davvero rotto fallisce anche al secondo tentativo, e con lo
# stesso codice d'uscita: quella distinzione resta intatta.
function Invoke-Godot {
    param([string[]]$GodotArguments)
    $Attempt = 0
    while ($true) {
        $Attempt++
        if ($IsWindowsHost) {
            $Process = [System.Diagnostics.Process]::Start(
                (New-GodotProcessInfo -GodotArguments $GodotArguments -CaptureOutput $false)
            )
            $Process.WaitForExit()
            $ExitCode = $Process.ExitCode
            $Process.Dispose()
            # Lascia al sistema il tempo di riprendersi gli handle del processo
            # appena uscito, prima di avviarne un altro.
            Start-Sleep -Milliseconds 400
        }
        else {
            & $Godot @GodotArguments
            $ExitCode = $LASTEXITCODE
        }
        if ($ExitCode -eq 0) { return }
        # -1073741819 = 0xC0000005 ACCESS_VIOLATION: il motore e' morto, non ha
        # fallito un'asserzione. Solo questo caso merita un secondo tentativo.
        if ($IsWindowsHost -and $Attempt -eq 1 -and $ExitCode -eq -1073741819) {
            Write-Host "::warning::Godot crashato (0xC0000005) su $($GodotArguments -join ' ') -- riprovo una volta"
            Start-Sleep -Seconds 5
            continue
        }
        throw "Godot exited with code $ExitCode"
    }
}

function Invoke-GodotCaptured {
    param([string[]]$GodotArguments)
    if ($IsWindowsHost) {
        $Process = [System.Diagnostics.Process]::new()
        $Process.StartInfo = New-GodotProcessInfo -GodotArguments $GodotArguments -CaptureOutput $true
        if (-not $Process.Start()) { throw "Unable to start Godot" }
        $Stdout = $Process.StandardOutput.ReadToEndAsync()
        $Stderr = $Process.StandardError.ReadToEndAsync()
        $Process.WaitForExit()
        $ExitCode = $Process.ExitCode
        $Output = $Stdout.GetAwaiter().GetResult() + $Stderr.GetAwaiter().GetResult()
        $Process.Dispose()
    }
    else {
        $Output = (& $Godot @GodotArguments 2>&1 | Out-String)
        $ExitCode = $LASTEXITCODE
    }
    if ($ExitCode -ne 0) {
        throw "Godot exited with code $ExitCode`n$Output"
    }
    return $Output
}

# Esegue il tier richiesto della matrice. Come run.sh, NON si ferma al primo
# rosso: il riepilogo finale vale piu' del secondo risparmiato, e sul tier
# `watch` (test mai passati da una CI) e' proprio il quadro completo che serve.
function Invoke-TestMatrix {
    param([string]$Want)
    $Selected = @($TestMatrix | Where-Object { $Want -eq "all" -or $_.Tier -eq $Want })
    if ($Selected.Count -eq 0) {
        throw "tier '$Want' non seleziona nessun test (gate|watch|all)"
    }
    $Failed = @()
    $Skipped = @()
    foreach ($T in $Selected) {
        if ($T.Platform -eq "posix") {
            Write-Host "[run.ps1] SKIP $($T.Id) -- dichiarato POSIX-only in test-matrix.txt"
            $Skipped += $T.Id
            continue
        }
        foreach ($Name in $EnvNames) {
            if ($Name -eq "JHT_NOVPS") { continue }
            Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
        }
        foreach ($Pair in $T.Env) {
            $Kv = $Pair.Split("=", 2)
            Set-Item "Env:$($Kv[0])" $Kv[1]
        }
        Write-Host "[run.ps1] $($T.Id) ($($T.Tier)/$($T.Kind)) ..."
        try {
            switch ($T.Kind) {
                "script" {
                    $ScriptPath = $T.Target[0]
                    Invoke-Godot -GodotArguments @(
                        "--headless", "--script", "res://$ScriptPath")
                }
                "run" {
                    $GodotArgs = @("--headless") + $T.Target + @(".")
                    $Out = Invoke-GodotCaptured -GodotArguments $GodotArgs
                    if ($T.Marker -and $Out -notmatch [regex]::Escape($T.Marker)) {
                        # Uscire 0 senza stampare il marker significa che le
                        # asserzioni non sono state eseguite: e' un rosso.
                        throw "marker atteso e MAI stampato: $($T.Marker)`n$Out"
                    }
                }
                "python" {
                    $PyScript = $T.Target[0]
                    & python $PyScript
                    if ($LASTEXITCODE -ne 0) {
                        throw "$PyScript exited with code $LASTEXITCODE"
                    }
                }
                default { throw "kind sconosciuto '$($T.Kind)' in test-matrix.txt" }
            }
            Write-Host "[run.ps1]   PASS $($T.Id)"
        }
        catch {
            Write-Host "[run.ps1]   FAIL $($T.Id): $_"
            $Failed += $T.Id
        }
    }
    if ($Skipped.Count -gt 0) {
        Write-Host "[run.ps1] saltati perche' POSIX-only: $($Skipped -join ', ')"
    }
    if ($Failed.Count -gt 0) {
        throw "TEST KO -- $($Failed.Count)/$($Selected.Count) falliti: $($Failed -join ', ')"
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
            Invoke-TestMatrix -Want $Tier
            Write-Host "[run.ps1] TEST OK (tier=$Tier)"
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
