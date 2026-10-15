; Hooks of the Windows installer: bundle.windows.nsis.installerHooks in
; tauri.conf.json. Tauri's NSIS template !includes this file (the extension
; does not matter to NSIS; .nsi is the one the repository accepts) and inserts
; the macros; its own defines and variables (UNINSTKEY, PRODUCTNAME,
; MAINBINARYNAME, $PassiveMode, $UpdateMode, $NoShortcutMode) are visible in
; them. LangString cannot be used here: this file comes before the template
; loads its languages, so the texts below are picked by $LANGUAGE.

; ── The v0.3.9 game ─────────────────────────────────────────────────────
; The Godot game (v0.3.9 and earlier) installed itself with
; game/installer/windows.nsi: uninstall entry JobHunterTeam in HKCU, desktop
; shortcut "Job Hunter Team.lnk" (which its uninstaller deletes by name),
; Start menu folder "Job Hunter Team". The template would write this app's
; desktop shortcut on that very file. So when the game is there:
; - with the wizard, the person is asked whether to uninstall it now (its own
;   uninstaller, silent: it keeps ~/.jht and its data);
; - if they keep it, and always when silent or passive, this app installs
;   next to it without touching any of its files: its shortcuts take another
;   name, and a window says not to use the two apps on the same data.
!define JHT_GAME_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\JobHunterTeam"
!define JHT_SIDE_BY_SIDE_NAME "Job Hunter Team App"
Var JhtGameKept

; Sets $R9 to the text of the installer's language (English otherwise).
!macro JHT_TEXT IT EN DE ES FR HU PT
  StrCpy $R9 "${EN}"
  ${If} $LANGUAGE = ${LANG_ITALIAN}
    StrCpy $R9 "${IT}"
  ${ElseIf} $LANGUAGE = ${LANG_GERMAN}
    StrCpy $R9 "${DE}"
  ${ElseIf} $LANGUAGE = ${LANG_SPANISH}
    StrCpy $R9 "${ES}"
  ${ElseIf} $LANGUAGE = ${LANG_FRENCH}
    StrCpy $R9 "${FR}"
  ${ElseIf} $LANGUAGE = ${LANG_HUNGARIAN}
    StrCpy $R9 "${HU}"
  ${ElseIf} $LANGUAGE = ${LANG_PORTUGUESE}
    StrCpy $R9 "${PT}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCpy $JhtGameKept 0
  ReadRegStr $R0 HKCU "${JHT_GAME_UNINSTKEY}" "UninstallString"
  ${If} $R0 != ""
    StrCpy $JhtGameKept 1
    ${If} $PassiveMode <> 1
    ${AndIfNot} ${Silent}
      !insertmacro JHT_TEXT \
        "Su questo computer c’è Job Hunter Team v0.3.9 (il gioco): questa versione lo sostituisce.$\n$\nVuoi disinstallarlo adesso? I tuoi dati (~/.jht e Documenti › Job Hunter Team) restano dove sono, e la nuova app li riprende.$\n$\nCon No la nuova app si installa accanto al gioco, senza toccarlo." \
        "Job Hunter Team v0.3.9 (the game) is on this computer: this version replaces it.$\n$\nDo you want to uninstall it now? Your data (~/.jht and Documents › Job Hunter Team) stays where it is, and the new app picks it up.$\n$\nWith No, the new app is installed next to the game, without touching it." \
        "Auf diesem Computer ist Job Hunter Team v0.3.9 (das Spiel): Diese Version ersetzt es.$\n$\nMöchtest du es jetzt deinstallieren? Deine Daten (~/.jht und Dokumente › Job Hunter Team) bleiben, wo sie sind, und die neue App übernimmt sie.$\n$\nMit Nein wird die neue App neben dem Spiel installiert, ohne es anzurühren." \
        "En este ordenador está Job Hunter Team v0.3.9 (el juego): esta versión lo sustituye.$\n$\n¿Quieres desinstalarlo ahora? Tus datos (~/.jht y Documentos › Job Hunter Team) se quedan donde están, y la nueva aplicación los retoma.$\n$\nCon No, la nueva aplicación se instala junto al juego, sin tocarlo." \
        "Job Hunter Team v0.3.9 (le jeu) est sur cet ordinateur : cette version le remplace.$\n$\nVeux-tu le désinstaller maintenant ? Tes données (~/.jht et Documents › Job Hunter Team) restent où elles sont, et la nouvelle application les reprend.$\n$\nAvec Non, la nouvelle application s’installe à côté du jeu, sans y toucher." \
        "Ezen a számítógépen ott van a Job Hunter Team v0.3.9 (a játék): ez a verzió felváltja.$\n$\nEltávolítod most? Az adataid (~/.jht és Dokumentumok › Job Hunter Team) a helyükön maradnak, és az új alkalmazás átveszi őket.$\n$\nA Nem választásával az új alkalmazás a játék mellé települ, anélkül hogy hozzányúlna." \
        "Neste computador está o Job Hunter Team v0.3.9 (o jogo): esta versão substitui-o.$\n$\nQueres desinstalá-lo agora? Os teus dados (~/.jht e Documentos › Job Hunter Team) ficam onde estão, e a nova aplicação retoma-os.$\n$\nCom Não, a nova aplicação instala-se ao lado do jogo, sem lhe tocar."
      ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION "$R9" IDYES`
        ReadRegStr $R1 HKCU "${JHT_GAME_UNINSTKEY}" "InstallLocation"
        DetailPrint "Job Hunter Team v0.3.9: $R1\Uninstall.exe /S"
        ; _? runs it in place and waits; it cannot delete itself from there.
        ExecWait '"$R1\Uninstall.exe" /S _?=$R1' $R2
        ReadRegStr $R0 HKCU "${JHT_GAME_UNINSTKEY}" "UninstallString"
        ${If} $R0 != ""
          !insertmacro JHT_TEXT \
            "Job Hunter Team v0.3.9 non è stato disinstallato, e l’installazione si ferma.$\n$\nPuoi toglierlo da Impostazioni › App › App installate (la voce Job Hunter Team con versione 0.3.9) e poi rilanciare questa installazione." \
            "Job Hunter Team v0.3.9 was not uninstalled, and the installation stops.$\n$\nYou can remove it from Settings › Apps › Installed apps (the Job Hunter Team entry with version 0.3.9) and then run this installation again." \
            "Job Hunter Team v0.3.9 wurde nicht deinstalliert, und die Installation wird beendet.$\n$\nDu kannst es unter Einstellungen › Apps › Installierte Apps entfernen (der Eintrag Job Hunter Team mit Version 0.3.9) und diese Installation dann erneut starten." \
            "Job Hunter Team v0.3.9 no se ha desinstalado, y la instalación se detiene.$\n$\nPuedes quitarlo desde Configuración › Aplicaciones › Aplicaciones instaladas (la entrada Job Hunter Team con versión 0.3.9) y volver a ejecutar esta instalación." \
            "Job Hunter Team v0.3.9 n’a pas été désinstallé, et l’installation s’arrête.$\n$\nTu peux le retirer depuis Paramètres › Applications › Applications installées (l’entrée Job Hunter Team en version 0.3.9), puis relancer cette installation." \
            "A Job Hunter Team v0.3.9 nem lett eltávolítva, és a telepítés leáll.$\n$\nEltávolíthatod a Gépház › Alkalmazások › Telepített alkalmazások menüben (a 0.3.9-es verziójú Job Hunter Team bejegyzés), majd újra elindíthatod ezt a telepítést." \
            "O Job Hunter Team v0.3.9 não foi desinstalado, e a instalação para.$\n$\nPodes removê-lo em Definições › Aplicações › Aplicações instaladas (a entrada Job Hunter Team com a versão 0.3.9) e depois voltar a executar esta instalação."
          MessageBox MB_OK|MB_ICONSTOP "$R9"
          Abort
        ${EndIf}
        Delete "$R1\Uninstall.exe"
        RMDir "$R1"
        StrCpy $JhtGameKept 0
      ${EndIf}
    ${Else}
      DetailPrint "Job Hunter Team v0.3.9 is installed: kept, untouched."
    ${EndIf}
  ${EndIf}
  ${If} $JhtGameKept = 1
    ; The template's shortcuts would take the game's names: this app makes its own.
    StrCpy $NoShortcutMode 1
  ${EndIf}
!macroend

; The template writes the uninstall entry's InstallLocation in quotes
; ("$\"$INSTDIR$\""), so «App e funzionalità» and the tools that read it get a
; path wrapped in quotes. This runs after the template's registry writes and
; puts the bare path back. Nothing in the template reads it again.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  ${If} $JhtGameKept = 1
  ${AndIf} $UpdateMode <> 1
    CreateShortcut "$SMPROGRAMS\${JHT_SIDE_BY_SIDE_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${JHT_SIDE_BY_SIDE_NAME}.lnk"
    CreateShortcut "$DESKTOP\${JHT_SIDE_BY_SIDE_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${JHT_SIDE_BY_SIDE_NAME}.lnk"
  ${EndIf}
  ${If} $JhtGameKept = 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    !insertmacro JHT_TEXT \
      "Job Hunter Team è installato accanto al gioco v0.3.9, che non è stato toccato. Il collegamento della nuova app si chiama «${JHT_SIDE_BY_SIDE_NAME}».$\n$\nNon usare le due app insieme: lavorano sugli stessi dati (~/.jht), e due team sugli stessi dati si intralciano.$\n$\nPer togliere il gioco più tardi: Impostazioni › App › App installate, la voce Job Hunter Team con versione 0.3.9." \
      "Job Hunter Team is installed next to the game v0.3.9, which was not touched. The new app’s shortcut is called “${JHT_SIDE_BY_SIDE_NAME}”.$\n$\nDo not use the two apps together: they work on the same data (~/.jht), and two teams on the same data get in each other’s way.$\n$\nTo remove the game later: Settings › Apps › Installed apps, the Job Hunter Team entry with version 0.3.9." \
      "Job Hunter Team ist neben dem Spiel v0.3.9 installiert, das nicht angerührt wurde. Die Verknüpfung der neuen App heißt „${JHT_SIDE_BY_SIDE_NAME}“.$\n$\nVerwende die beiden Apps nicht zusammen: Sie arbeiten mit denselben Daten (~/.jht), und zwei Teams auf denselben Daten kommen sich in die Quere.$\n$\nUm das Spiel später zu entfernen: Einstellungen › Apps › Installierte Apps, der Eintrag Job Hunter Team mit Version 0.3.9." \
      "Job Hunter Team está instalado junto al juego v0.3.9, que no se ha tocado. El acceso directo de la nueva aplicación se llama «${JHT_SIDE_BY_SIDE_NAME}».$\n$\nNo uses las dos aplicaciones a la vez: trabajan con los mismos datos (~/.jht), y dos equipos con los mismos datos se estorban.$\n$\nPara quitar el juego más tarde: Configuración › Aplicaciones › Aplicaciones instaladas, la entrada Job Hunter Team con versión 0.3.9." \
      "Job Hunter Team est installé à côté du jeu v0.3.9, qui n’a pas été touché. Le raccourci de la nouvelle application s’appelle « ${JHT_SIDE_BY_SIDE_NAME} ».$\n$\nN’utilise pas les deux applications ensemble : elles travaillent sur les mêmes données (~/.jht), et deux équipes sur les mêmes données se gênent.$\n$\nPour retirer le jeu plus tard : Paramètres › Applications › Applications installées, l’entrée Job Hunter Team en version 0.3.9." \
      "A Job Hunter Team a v0.3.9-es játék mellé települt, amelyhez nem nyúlt. Az új alkalmazás parancsikonjának neve „${JHT_SIDE_BY_SIDE_NAME}”.$\n$\nNe használd együtt a két alkalmazást: ugyanazokkal az adatokkal dolgoznak (~/.jht), és két csapat ugyanazokon az adatokon zavarja egymást.$\n$\nA játék későbbi eltávolítása: Gépház › Alkalmazások › Telepített alkalmazások, a 0.3.9-es verziójú Job Hunter Team bejegyzés." \
      "O Job Hunter Team está instalado ao lado do jogo v0.3.9, que não foi tocado. O atalho da nova aplicação chama-se «${JHT_SIDE_BY_SIDE_NAME}».$\n$\nNão uses as duas aplicações ao mesmo tempo: trabalham com os mesmos dados (~/.jht), e duas equipas com os mesmos dados atrapalham-se.$\n$\nPara remover o jogo mais tarde: Definições › Aplicações › Aplicações instaladas, a entrada Job Hunter Team com a versão 0.3.9."
    MessageBox MB_OK|MB_ICONINFORMATION "$R9"
  ${EndIf}
!macroend

; The shortcuts this app made next to the game: only its own names. The
; template removes its usual ones only when they point at this app.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    Delete "$SMPROGRAMS\${JHT_SIDE_BY_SIDE_NAME}.lnk"
    Delete "$DESKTOP\${JHT_SIDE_BY_SIDE_NAME}.lnk"
  ${EndIf}
!macroend
