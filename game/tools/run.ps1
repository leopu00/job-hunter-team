param(
    [ValidateSet("boot", "test", "play")]
    [string]$Mode = "boot"
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
$EnvNames = @(
    "JHT_NOVPS", "JHT_VPS_CONTRACT_TEST", "JHT_SCENE",
    "JHT_PIPELINE_FORCE_TEST", "JHT_DOCTOR_TEST", "JHT_COMIC_CHAT_TEST"
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

function Invoke-Godot {
    param([string[]]$GodotArguments)
    if ($IsWindowsHost) {
        $Process = [System.Diagnostics.Process]::Start(
            (New-GodotProcessInfo -GodotArguments $GodotArguments -CaptureOutput $false)
        )
        $Process.WaitForExit()
        $ExitCode = $Process.ExitCode
        $Process.Dispose()
    }
    else {
        & $Godot @GodotArguments
        $ExitCode = $LASTEXITCODE
    }
    if ($ExitCode -ne 0) {
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
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/pipeline_queue_selftest.gd")
			Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/embedded_terminal_selftest.gd")
            # Self-test indipendenti dalla piattaforma: asseriscono su dati del
            # repo (dizionari, tema, font imbarcati) e su trasformazioni pure.
            # Stanno qui perche' run.ps1 e' il "run.sh test" di chi sviluppa su
            # Windows: senza, un PC Windows non vede il guard delle 7 lingue
            # prima di pushare. terminal_selection_selftest.gd resta escluso:
            # apre "/bin/sh" senza il ramo Windows che ha embedded_terminal.
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/theme_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/budget_notice_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/burn_mode_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/doc_preview_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/i18n_parity_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/sidebar_nav_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/agent_names_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/idle_pace_selftest.gd")
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/headless_exit_selftest.gd")
            # L'aggiornamento automatico: si aggiorna solo in avanti, si
            # installa da solo SOLO dove il pacchetto e' firmato, e non va in
            # rete quando non deve. Windows non ha un export firmato, quindi
            # qui la parte che conta e' proprio che l'installazione automatica
            # resti spenta.
            Invoke-Godot -GodotArguments @("--headless", "--script", "res://tools/update_check_selftest.gd")
			& python tools/audit_character_sheets.py
			if ($LASTEXITCODE -ne 0) { throw "character sheet audit failed" }
			python tools/python_payload_syntax_test.py
			if ($LASTEXITCODE -ne 0) { throw "Embedded Python payload test failed" }
			$env:JHT_SCENE = "office"
			$env:JHT_GUIDED_TEST = "1"
			$out = Invoke-GodotCaptured -GodotArguments @("--headless", ".")
			Remove-Item Env:JHT_GUIDED_TEST
			Remove-Item Env:JHT_SCENE
			if ($out -notmatch "GUIDED-ONBOARDING-TEST PASS") { throw $out }

			# Pagina di chat a fumetti: vignette, ordine, colori distinti fra
			# agente e utente, code opposte e scroll all'indietro. Invoke-GodotCaptured
			# solleva gia' da se' su exit code != 0; il match sulla riga e' il
			# secondo controllo, non l'unico.
			$env:JHT_SCENE = "office"
			$env:JHT_COMIC_CHAT_TEST = "1"
			$out = Invoke-GodotCaptured -GodotArguments @("--headless", ".")
			Remove-Item Env:JHT_COMIC_CHAT_TEST
			Remove-Item Env:JHT_SCENE
			if ($out -notmatch "COMIC-CHAT-TEST PASS") { throw $out }

            $env:JHT_VPS_CONTRACT_TEST = "1"
            $out = Invoke-GodotCaptured -GodotArguments @("--headless", "--quit-after", "3", ".")
            Remove-Item Env:JHT_VPS_CONTRACT_TEST
            if ($out -notmatch "VPS-CONTRACT-TEST PASS") { throw $out }

            $env:JHT_SCENE = "office"
            $env:JHT_PIPELINE_FORCE_TEST = "scout"
            $out = Invoke-GodotCaptured -GodotArguments @("--headless", ".")
            Remove-Item Env:JHT_PIPELINE_FORCE_TEST
            if ($out -notmatch "PIPELINE-FORCE-TEST PASS") { throw $out }

            $env:JHT_BACKEND_SWITCH_TEST = "1"
            $out = Invoke-GodotCaptured -GodotArguments @("--headless", ".")
            Remove-Item Env:JHT_BACKEND_SWITCH_TEST
            if ($out -notmatch "BACKEND-SWITCH-TEST PASS") { throw $out }

            $env:JHT_DOCTOR_TEST = "scout-4"
            $out = Invoke-GodotCaptured -GodotArguments @("--headless", ".")
            Remove-Item Env:JHT_DOCTOR_TEST
            Remove-Item Env:JHT_SCENE
            if ($out -notmatch "SIMULATION-DOCTOR-TEST PASS") { throw $out }
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
