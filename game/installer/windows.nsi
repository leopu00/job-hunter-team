; Job Hunter Team — installer Windows per l'export Godot.
; Build (dal Mac, da game/):
;   makensis -DVERSION=0.3.5 installer/windows.nsi
; Richiede: builds/windows/job-hunter-team.exe (export "Windows Desktop")
; e installer/icon.ico. Output stabile per releases/latest/download/:
; builds/windows/job-hunter-team-windows-x64-setup.exe
; Install per-utente (no admin), come il vecchio installer Electron. /S = silenzioso.

!ifndef VERSION
  !define VERSION "0.3.9"
!endif
!ifndef VERSION_NUMERIC
  !define VERSION_NUMERIC "${VERSION}.0"
!endif
!ifndef AUTHORITY_DIR
  !error "AUTHORITY_DIR with the verified manifest/signature/helper is required"
!endif

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

Name "Job Hunter Team"
OutFile "..\builds\windows\job-hunter-team-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Job Hunter Team"
RequestExecutionLevel user
; zlib e niente pre-scan CRC: LZMA+CRC su un payload da ~340MB tenevano
; l'installer "muto" per decine di secondi su hardware vecchio (T440s).
; L'integrità del download la garantisce lo SHA-256 pubblicato, non il CRC.
SetCompressor zlib
CRCCheck off

; Metadati del file installer (proprietà → dettagli)
VIProductVersion "${VERSION_NUMERIC}"
VIAddVersionKey "ProductName" "Job Hunter Team"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION_NUMERIC}"
VIAddVersionKey "FileDescription" "Job Hunter Team — The Office (installer)"
VIAddVersionKey "LegalCopyright" "Copyright © Job Hunter Team"
VIAddVersionKey "CompanyName" "Job Hunter Team"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\job-hunter-team.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Avvia Job Hunter Team"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
; Pagina componenti della DISINSTALLAZIONE: esiste solo per offrire la
; rimozione dei dati utente come scelta. Va fra CONFIRM e INSTFILES, cioè
; dopo «vuoi disinstallare?» e prima che qualcosa venga toccato.
!insertmacro MUI_UNPAGE_COMPONENTS
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Italian"
!insertmacro MUI_LANGUAGE "English"

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\JobHunterTeam"

; ── I dati dell'utente, e perché non si cancellano da soli ────────────
; Il gioco fissa `user://` Windows a questo stesso percorso con gli override
; `.windows` di project.godot. Il custom name riproduce il path storico, ma non
; segue piu' `config/name`: una rinomina del prodotto non abbandona onboarding
; (guided_onboarding.cfg, onboarding_context.*), tour (tour.cfg),
; configurazione VPS e runtime, log e cache. Il path storico e' stato
; verificato su una macchina reale il 2026-08-12.
;
; DIRETTIVA: questa cartella NON viene cancellata da disinstallazione né da
; upgrade. È roba dell'utente — profilo, lingua, configurazione — e un
; installer che se la porta via da solo fa il danno peggiore che questo
; prodotto possa fare. Il difetto [WIN-USERDIR-SURVIVES-REINSTALL] non è che
; la cartella sopravviva: è che ripartire puliti non fosse POSSIBILE nemmeno
; volendolo. Da qui la sezione opzionale qui sotto, DESELEZIONATA per default.
!define USERDATA_DIR "$APPDATA\Godot\app_userdata\Job Hunter Team"
; L'app Electron di prima scriveva in $APPDATA\JHT Desktop. Chi viene da
; quella versione ha ancora quella cartella: la rimozione esplicita la porta
; via insieme all'altra, altrimenti «ho scelto di cancellare i miei dati»
; lascerebbe indietro proprio i più vecchi.
!define USERDATA_DIR_LEGACY "$APPDATA\JHT Desktop"

Function AssertSafeInstallDir
  ; L'updater e una capability host: l'installer non accetta un percorso scelto
  ; dall'utente (in particolare .jht/Documents o un bind del container).
  StrCpy $0 "$LOCALAPPDATA\Programs\Job Hunter Team"
  StrCmp $INSTDIR $0 path_exact
  Abort "Il percorso di installazione non e quello host protetto previsto."

  path_exact:
  StrCpy $0 "$INSTDIR"
  ancestor_loop:
    System::Call 'kernel32::GetFileAttributesW(w r0)i.r1'
    ${If} $1 != -1
      IntOp $2 $1 & 0x400
      ${If} $2 != 0
        Abort "Il percorso di installazione contiene un reparse point."
      ${EndIf}
    ${EndIf}
    ${GetParent} "$0" $3
    StrCmp $3 $0 ancestors_done
    StrCmp $3 "" ancestors_done
    StrCpy $0 $3
    Goto ancestor_loop
  ancestors_done:
FunctionEnd

Function RunInstallPreflight
  ; Il guard viene estratto nel plugin dir privato di NSIS e invocato soltanto
  ; con -File. La policy PowerShell host resta autorevole, senza override.
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=jht-windows-install-preflight.ps1 "..\..\scripts\jht-windows-install-preflight.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\jht-windows-install-preflight.ps1" -Mode "$9" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    SetErrorLevel 2
    Abort "La directory di installazione non supera i controlli owner, ACL e link."
  ${EndIf}
FunctionEnd

Section "Install"
  Call AssertSafeInstallDir
  ; Prima mutazione consentita solo dopo preflight su owner/DACL, reparse,
  ; canonical path e hardlink di ogni child preesistente.
  StrCpy $9 "Prepare"
  Call RunInstallPreflight
  Call AssertSafeInstallDir

  SetOutPath "$INSTDIR"
  File "..\builds\windows\job-hunter-team.exe"
  File "icon.ico"
  File "${AUTHORITY_DIR}\jht-windows-update.ps1"
  File "${AUTHORITY_DIR}\RELEASE-MANIFEST.json"
  File "${AUTHORITY_DIR}\RELEASE-MANIFEST.json.sig"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Verifica finale prima di shortcut/registry: anche Uninstall.exe deve essere
  ; regular, single-link, current-owner e senza writer estranei.
  Call AssertSafeInstallDir
  StrCpy $9 "VerifyInstalled"
  Call RunInstallPreflight
  WriteRegStr HKCU "Software\Job Hunter Team" "InstallDir" "$INSTDIR"

  ; Collegamenti
  CreateShortcut "$DESKTOP\Job Hunter Team.lnk" "$INSTDIR\job-hunter-team.exe" "" "$INSTDIR\icon.ico"
  CreateDirectory "$SMPROGRAMS\Job Hunter Team"
  CreateShortcut "$SMPROGRAMS\Job Hunter Team\Job Hunter Team.lnk" "$INSTDIR\job-hunter-team.exe" "" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\Job Hunter Team\Disinstalla.lnk" "$INSTDIR\Uninstall.exe"

  ; Voce in "App e funzionalità"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "Job Hunter Team"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Job Hunter Team"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

; Il programma: sempre, e senza spunta da togliere — chi ha aperto il
; disinstallatore vuole disinstallare. `SectionIn RO` la mostra bloccata nella
; pagina componenti, così l'unica scelta lì è quella sui dati.
Section "un.Job Hunter Team" SEC_UN_APP
  SectionIn RO
  Delete "$INSTDIR\job-hunter-team.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\jht-windows-update.ps1"
  Delete "$INSTDIR\RELEASE-MANIFEST.json"
  Delete "$INSTDIR\RELEASE-MANIFEST.json.sig"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\Job Hunter Team.lnk"
  Delete "$SMPROGRAMS\Job Hunter Team\Job Hunter Team.lnk"
  Delete "$SMPROGRAMS\Job Hunter Team\Disinstalla.lnk"
  RMDir "$SMPROGRAMS\Job Hunter Team"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Job Hunter Team"
SectionEnd

; ── La scelta che mancava: ripartire puliti ────────────────────────────
; `/o` = deselezionata all'apertura. Chi non la guarda nemmeno esce con i
; propri dati intatti, che è il comportamento di prima e la direttiva.
; Anche `Uninstall.exe /S` (QuietUninstallString, "App e funzionalità") la
; lascia deselezionata: in silenzio non si distrugge niente.
;
; Si cancella SOLO la cartella di questo progetto, mai il suo genitore
; $APPDATA\Godot\app_userdata — lì possono vivere i dati di altri giochi
; Godot, che non sono nostri da toccare.
Section /o "un.Rimuovi anche i miei dati (lingua, onboarding, configurazione)" SEC_UN_USERDATA
  DetailPrint "Rimozione dei dati utente richiesta esplicitamente."
  IfFileExists "${USERDATA_DIR}\*.*" 0 +3
    DetailPrint "Rimuovo ${USERDATA_DIR}"
    RMDir /r "${USERDATA_DIR}"
  IfFileExists "${USERDATA_DIR_LEGACY}\*.*" 0 +3
    DetailPrint "Rimuovo ${USERDATA_DIR_LEGACY}"
    RMDir /r "${USERDATA_DIR_LEGACY}"
SectionEnd

; Testi della pagina componenti: senza descrizione il riquadro resta vuoto e
; la spunta sembra un dettaglio tecnico invece di una decisione.
!insertmacro MUI_UNFUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_UN_APP} "Rimuove il programma, i collegamenti e le voci di registro."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_UN_USERDATA} "Cancella anche lingua, onboarding, tour e configurazione salvati. Senza questa spunta i tuoi dati restano, e una reinstallazione li ritrova."
!insertmacro MUI_UNFUNCTION_DESCRIPTION_END
