; Hooks of the Windows installer: bundle.windows.nsis.installerHooks in
; tauri.conf.json. Tauri's NSIS template !includes this file (the extension
; does not matter to NSIS; .nsi is the one the repository accepts) and inserts
; the macros; its own defines (UNINSTKEY, PRODUCTNAME) are visible here.

; The template writes the uninstall entry's InstallLocation in quotes
; ("$\"$INSTDIR$\""), so «App e funzionalità» and the tools that read it get a
; path wrapped in quotes. This runs after the template's registry writes and
; puts the bare path back. Nothing in the template reads it again.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
!macroend
