; Job Hunter Team — installer Windows per l'export Godot.
; Build (dal Mac, da game/):
;   makensis -DVERSION=0.3.5 installer/windows.nsi
; Richiede: builds/windows/job-hunter-team.exe (export "Windows Desktop")
; e installer/icon.ico. Output stabile per releases/latest/download/:
; builds/windows/job-hunter-team-windows-x64-setup.exe
; Install per-utente (no admin), come il vecchio installer Electron. /S = silenzioso.

!ifndef VERSION
  !define VERSION "0.3.5"
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
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Italian"
!insertmacro MUI_LANGUAGE "English"

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\JobHunterTeam"

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

Section "Uninstall"
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
