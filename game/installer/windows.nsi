; Job Hunter Team — installer Windows per l'export Godot.
; Build (dal Mac, da game/):
;   makensis -DVERSION=0.3.5 installer/windows.nsi
; Richiede: builds/windows/job-hunter-team.exe (export "Windows Desktop")
; e installer/icon.ico. Output stabile per releases/latest/download/:
; builds/windows/job-hunter-team-windows-x64-setup.exe
; Install per-utente (no admin), come il vecchio installer Electron. /S = silenzioso.

!ifndef VERSION
  !define VERSION "0.3.7"
!endif
!ifndef VERSION_NUMERIC
  !define VERSION_NUMERIC "${VERSION}.0"
!endif

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "Job Hunter Team"
OutFile "..\builds\windows\job-hunter-team-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Job Hunter Team"
InstallDirRegKey HKCU "Software\Job Hunter Team" "InstallDir"
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
!insertmacro MUI_PAGE_DIRECTORY
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
; Il gioco non imposta `use_custom_user_dir`, quindi `user://` di Godot è
; $APPDATA\Godot\app_userdata\<nome progetto>: lì vivono onboarding
; (guided_onboarding.cfg, onboarding_context.*), tour (tour.cfg),
; configurazione VPS e runtime, log e cache. Verificato su una macchina reale
; il 2026-08-12.
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

Section "Install"
  SetOutPath "$INSTDIR"
  File "..\builds\windows\job-hunter-team.exe"
  File "icon.ico"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
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
