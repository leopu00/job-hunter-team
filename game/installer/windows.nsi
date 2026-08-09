; Job Hunter Team — installer Windows per l'export Godot.
; Build (dal Mac, da game/):
;   makensis -DVERSION=0.3.5 installer/windows.nsi
; Richiede: builds/windows/job-hunter-team.exe (export "Windows Desktop")
; e installer/icon.ico. Output stabile per releases/latest/download/:
; builds/windows/job-hunter-team-windows-x64-setup.exe
; Install per-utente (no admin), come il vecchio installer Electron. /S = silenzioso.

!ifndef VERSION
  !define VERSION "0.3.6"
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
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Italian"
!insertmacro MUI_LANGUAGE "English"

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\JobHunterTeam"

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

Section "Uninstall"
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
