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

; ── Uninstall: the team and its data ───────────────────────────────────
; Before the template deletes the app's files, scripts/jht-uninstall-windows.ps1
; (a resource of this app, same version) decides about the team and its data:
; - never when the updater runs this uninstaller (/UPDATE): nothing is touched;
; - silent (/S) or passive (/P): Keep. The data stays, our Podman machine is
;   stopped normally, a report says what stays and how to remove it;
; - with the wizard, a question with No as the default. No = Keep; Yes =
;   Remove, with the list of what goes and what stays in the question itself.
; The template's checkbox «Delete the application data» follows the answer:
; it is set to 0 when silent or passive, and to 1 only by a Yes.
!define JHT_UNINSTALL_SCRIPT "jht-uninstall-windows.ps1"
!define JHT_REMOVE_REPORT "$TEMP\Job Hunter Team - disinstallazione.txt"
Var JhtUninstallMode

; Sets $R6 to the script's code for the uninstaller's language.
!macro JHT_LANGUAGE_CODE
  StrCpy $R6 "en"
  ${If} $LANGUAGE = ${LANG_ITALIAN}
    StrCpy $R6 "it"
  ${ElseIf} $LANGUAGE = ${LANG_GERMAN}
    StrCpy $R6 "de"
  ${ElseIf} $LANGUAGE = ${LANG_SPANISH}
    StrCpy $R6 "es"
  ${ElseIf} $LANGUAGE = ${LANG_FRENCH}
    StrCpy $R6 "fr"
  ${ElseIf} $LANGUAGE = ${LANG_HUNGARIAN}
    StrCpy $R6 "hu"
  ${ElseIf} $LANGUAGE = ${LANG_PORTUGUESE}
    StrCpy $R6 "pt"
  ${EndIf}
!macroend

; $R0 = 0 when the app is running (as the template's CheckIfAppIsRunning reads it).
!macro JHT_FIND_APP
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}.exe"
  !else
    nsis_tauri_utils::FindProcess "${MAINBINARYNAME}.exe"
  !endif
  Pop $R0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ; The app is closed first, as the template does right after this hook: a
    ; Cancel stops the uninstall before anything of the team is touched.
    !insertmacro JHT_FIND_APP
    ${If} $R0 = 0
      ${If} $PassiveMode <> 1
      ${AndIfNot} ${Silent}
        nsis_tauri_utils::StrReplace "$(appRunningOkKill)" "{{product_name}}" "${PRODUCTNAME}"
        Pop $R2
        ${IfNot} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$R2" IDOK`
          Abort
        ${EndIf}
      ${EndIf}
      !if "${INSTALLMODE}" == "currentUser"
        nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}.exe"
      !else
        nsis_tauri_utils::KillProcess "${MAINBINARYNAME}.exe"
      !endif
      Pop $R0
      Sleep 500
      !insertmacro JHT_FIND_APP
      ${If} $R0 = 0
        nsis_tauri_utils::StrReplace "$(failedToKillApp)" "{{product_name}}" "${PRODUCTNAME}"
        Pop $R2
        DetailPrint "$R2"
        ${IfNot} ${Silent}
          MessageBox MB_OK|MB_ICONSTOP "$R2"
        ${EndIf}
        Abort
      ${EndIf}
    ${EndIf}

    StrCpy $JhtUninstallMode "Keep"
    StrCpy $DeleteAppDataCheckboxState 0
    ${If} $PassiveMode <> 1
    ${AndIfNot} ${Silent}
      ReadRegStr $R0 HKCU "${JHT_GAME_UNINSTKEY}" "UninstallString"
      ${If} $R0 != ""
        !insertmacro JHT_TEXT \
          "Vuoi togliere anche la squadra e i dati di Job Hunter Team?$\n$\nCon Sì spariscono: la macchina Podman jht-podman con i suoi volumi, il runtime locale, i comandi jht, l’avvio automatico, le impostazioni e le credenziali salvate dall’app (password della posta, sessione LinkedIn, token di Telegram).$\n$\nRestano sempre: i tuoi documenti (Documenti › Job Hunter Team), Podman e la squadra su una VPS. Con il gioco v0.3.9 installato, la cartella dei dati resta perché la usa anche il gioco: per toglierla disinstalla anche il gioco (~/.jht).$\n$\nCon No (la scelta predefinita) i dati restano e la squadra locale si ferma. La casella della pagina precedente segue questa risposta." \
          "Do you also want to remove the Job Hunter Team team and its data?$\n$\nWith Yes these go: the Podman machine jht-podman with its volumes, the local runtime, the jht commands, the automatic start, the settings and credentials saved by the app (mail password, LinkedIn session, Telegram tokens).$\n$\nAlways kept: your documents (Documents › Job Hunter Team), Podman and a team on a VPS. With the game v0.3.9 installed, the data folder stays because the game uses it too: to remove it, uninstall the game as well (~/.jht).$\n$\nWith No (the default) the data stays and the local team stops. The checkbox on the previous page follows this answer." \
          "Möchtest du auch das Team und die Daten von Job Hunter Team entfernen?$\n$\nMit Ja wird entfernt: die Podman-Maschine jht-podman mit ihren Volumes, die lokale Laufzeit, die jht-Befehle, der automatische Start, die von der App gespeicherten Einstellungen und Zugangsdaten (Mail-Passwort, LinkedIn-Sitzung, Telegram-Tokens).$\n$\nImmer bleiben: deine Dokumente (Dokumente › Job Hunter Team), Podman und ein Team auf einem VPS. Mit dem installierten Spiel v0.3.9 bleibt der Datenordner, weil ihn auch das Spiel verwendet: Um ihn zu entfernen, deinstalliere auch das Spiel (~/.jht).$\n$\nMit Nein (Standard) bleiben die Daten, und das lokale Team wird angehalten. Das Kontrollkästchen der vorigen Seite folgt dieser Antwort." \
          "¿Quieres quitar también el equipo y los datos de Job Hunter Team?$\n$\nCon Sí se eliminan: la máquina Podman jht-podman con sus volúmenes, el entorno local, los comandos jht, el inicio automático, los ajustes y credenciales guardados por la aplicación (contraseña del correo, sesión de LinkedIn, tokens de Telegram).$\n$\nSiempre se quedan: tus documentos (Documentos › Job Hunter Team), Podman y un equipo en un VPS. Con el juego v0.3.9 instalado, la carpeta de datos se queda porque también la usa el juego: para quitarla, desinstala también el juego (~/.jht).$\n$\nCon No (predeterminado) los datos se quedan y el equipo local se detiene. La casilla de la página anterior sigue esta respuesta." \
          "Veux-tu aussi retirer l’équipe et les données de Job Hunter Team ?$\n$\nAvec Oui, sont supprimés : la machine Podman jht-podman avec ses volumes, l’environnement local, les commandes jht, le démarrage automatique, les réglages et identifiants enregistrés par l’application (mot de passe de la messagerie, session LinkedIn, jetons Telegram).$\n$\nRestent toujours : tes documents (Documents › Job Hunter Team), Podman et une équipe sur un VPS. Avec le jeu v0.3.9 installé, le dossier de données reste car le jeu l’utilise aussi : pour le retirer, désinstalle aussi le jeu (~/.jht).$\n$\nAvec Non (par défaut), les données restent et l’équipe locale s’arrête. La case de la page précédente suit cette réponse." \
          "Eltávolítod a Job Hunter Team csapatát és adatait is?$\n$\nIgen esetén törlődik: a jht-podman Podman-gép a köteteivel, a helyi futtatókörnyezet, a jht parancsok, az automatikus indítás, az alkalmazás által mentett beállítások és hitelesítő adatok (levelezési jelszó, LinkedIn-munkamenet, Telegram-tokenek).$\n$\nMindig megmarad: a dokumentumaid (Dokumentumok › Job Hunter Team), a Podman és a VPS-en futó csapat. A telepített v0.3.9-es játék mellett az adatmappa marad, mert a játék is használja: az eltávolításához a játékot is távolítsd el (~/.jht).$\n$\nNem esetén (alapértelmezett) az adatok megmaradnak, és a helyi csapat leáll. Az előző oldal jelölőnégyzete ezt a választ követi." \
          "Queres remover também a equipa e os dados do Job Hunter Team?$\n$\nCom Sim são removidos: a máquina Podman jht-podman com os seus volumes, o ambiente local, os comandos jht, o arranque automático, as definições e credenciais guardadas pela aplicação (palavra-passe do correio, sessão do LinkedIn, tokens do Telegram).$\n$\nFicam sempre: os teus documentos (Documentos › Job Hunter Team), o Podman e uma equipa numa VPS. Com o jogo v0.3.9 instalado, a pasta de dados fica porque o jogo também a usa: para a remover, desinstala também o jogo (~/.jht).$\n$\nCom Não (predefinido) os dados ficam e a equipa local para. A caixa da página anterior segue esta resposta."
      ${Else}
        !insertmacro JHT_TEXT \
          "Vuoi togliere anche la squadra e i dati di Job Hunter Team?$\n$\nCon Sì spariscono: la macchina Podman jht-podman con i suoi volumi, il runtime locale, i comandi jht, l’avvio automatico, le impostazioni e le credenziali salvate dall’app (password della posta, sessione LinkedIn, token di Telegram) e la cartella dei dati ~/.jht.$\n$\nRestano sempre: i tuoi documenti (Documenti › Job Hunter Team), Podman e la squadra su una VPS.$\n$\nCon No (la scelta predefinita) i dati restano e la squadra locale si ferma. La casella della pagina precedente segue questa risposta." \
          "Do you also want to remove the Job Hunter Team team and its data?$\n$\nWith Yes these go: the Podman machine jht-podman with its volumes, the local runtime, the jht commands, the automatic start, the settings and credentials saved by the app (mail password, LinkedIn session, Telegram tokens) and the data folder ~/.jht.$\n$\nAlways kept: your documents (Documents › Job Hunter Team), Podman and a team on a VPS.$\n$\nWith No (the default) the data stays and the local team stops. The checkbox on the previous page follows this answer." \
          "Möchtest du auch das Team und die Daten von Job Hunter Team entfernen?$\n$\nMit Ja wird entfernt: die Podman-Maschine jht-podman mit ihren Volumes, die lokale Laufzeit, die jht-Befehle, der automatische Start, die von der App gespeicherten Einstellungen und Zugangsdaten (Mail-Passwort, LinkedIn-Sitzung, Telegram-Tokens) und der Datenordner ~/.jht.$\n$\nImmer bleiben: deine Dokumente (Dokumente › Job Hunter Team), Podman und ein Team auf einem VPS.$\n$\nMit Nein (Standard) bleiben die Daten, und das lokale Team wird angehalten. Das Kontrollkästchen der vorigen Seite folgt dieser Antwort." \
          "¿Quieres quitar también el equipo y los datos de Job Hunter Team?$\n$\nCon Sí se eliminan: la máquina Podman jht-podman con sus volúmenes, el entorno local, los comandos jht, el inicio automático, los ajustes y credenciales guardados por la aplicación (contraseña del correo, sesión de LinkedIn, tokens de Telegram) y la carpeta de datos ~/.jht.$\n$\nSiempre se quedan: tus documentos (Documentos › Job Hunter Team), Podman y un equipo en un VPS.$\n$\nCon No (predeterminado) los datos se quedan y el equipo local se detiene. La casilla de la página anterior sigue esta respuesta." \
          "Veux-tu aussi retirer l’équipe et les données de Job Hunter Team ?$\n$\nAvec Oui, sont supprimés : la machine Podman jht-podman avec ses volumes, l’environnement local, les commandes jht, le démarrage automatique, les réglages et identifiants enregistrés par l’application (mot de passe de la messagerie, session LinkedIn, jetons Telegram) et le dossier de données ~/.jht.$\n$\nRestent toujours : tes documents (Documents › Job Hunter Team), Podman et une équipe sur un VPS.$\n$\nAvec Non (par défaut), les données restent et l’équipe locale s’arrête. La case de la page précédente suit cette réponse." \
          "Eltávolítod a Job Hunter Team csapatát és adatait is?$\n$\nIgen esetén törlődik: a jht-podman Podman-gép a köteteivel, a helyi futtatókörnyezet, a jht parancsok, az automatikus indítás, az alkalmazás által mentett beállítások és hitelesítő adatok (levelezési jelszó, LinkedIn-munkamenet, Telegram-tokenek) és a ~/.jht adatmappa.$\n$\nMindig megmarad: a dokumentumaid (Dokumentumok › Job Hunter Team), a Podman és a VPS-en futó csapat.$\n$\nNem esetén (alapértelmezett) az adatok megmaradnak, és a helyi csapat leáll. Az előző oldal jelölőnégyzete ezt a választ követi." \
          "Queres remover também a equipa e os dados do Job Hunter Team?$\n$\nCom Sim são removidos: a máquina Podman jht-podman com os seus volumes, o ambiente local, os comandos jht, o arranque automático, as definições e credenciais guardadas pela aplicação (palavra-passe do correio, sessão do LinkedIn, tokens do Telegram) e a pasta de dados ~/.jht.$\n$\nFicam sempre: os teus documentos (Documentos › Job Hunter Team), o Podman e uma equipa numa VPS.$\n$\nCom Não (predefinido) os dados ficam e a equipa local para. A caixa da página anterior segue esta resposta."
      ${EndIf}
      ${If} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$R9" IDYES`
        StrCpy $JhtUninstallMode "Remove"
        StrCpy $DeleteAppDataCheckboxState 1
      ${EndIf}
    ${EndIf}

    ; Windows PowerShell 5.1, the 64-bit one on 64-bit Windows (this uninstaller is 32-bit).
    !insertmacro JHT_LANGUAGE_CODE
    DetailPrint "Job Hunter Team: $JhtUninstallMode"
    ${If} ${RunningX64}
      ${DisableX64FSRedirection}
    ${EndIf}
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\${JHT_UNINSTALL_SCRIPT}" -Mode $JhtUninstallMode -Language $R6'
    Pop $R0
    ${If} ${RunningX64}
      ${EnableX64FSRedirection}
    ${EndIf}
    DetailPrint "${JHT_UNINSTALL_SCRIPT}: $R0"

    ; After a Yes, the last window says where the report is (its folder is gone).
    ${If} $JhtUninstallMode == "Remove"
      ${If} $R0 == "0"
        !insertmacro JHT_TEXT \
          "Fatto: Job Hunter Team è stato tolto, con la squadra e i dati.$\n$\nIl resoconto, voce per voce, è in:$\n${JHT_REMOVE_REPORT}" \
          "Done: Job Hunter Team was removed, with the team and the data.$\n$\nThe report, item by item, is in:$\n${JHT_REMOVE_REPORT}" \
          "Fertig: Job Hunter Team wurde entfernt, mit dem Team und den Daten.$\n$\nDer Bericht, Eintrag für Eintrag, liegt in:$\n${JHT_REMOVE_REPORT}" \
          "Hecho: Job Hunter Team se ha quitado, con el equipo y los datos.$\n$\nEl informe, entrada por entrada, está en:$\n${JHT_REMOVE_REPORT}" \
          "Terminé : Job Hunter Team a été retiré, avec l’équipe et les données.$\n$\nLe compte rendu, élément par élément, est dans :$\n${JHT_REMOVE_REPORT}" \
          "Kész: a Job Hunter Team eltávolítva, a csapattal és az adatokkal együtt.$\n$\nA tételenkénti jelentés itt található:$\n${JHT_REMOVE_REPORT}" \
          "Feito: o Job Hunter Team foi removido, com a equipa e os dados.$\n$\nO relatório, item a item, está em:$\n${JHT_REMOVE_REPORT}"
        MessageBox MB_OK|MB_ICONINFORMATION "$R9"
      ${Else}
        !insertmacro JHT_TEXT \
          "Qualcosa non è stato tolto. Le voci rimaste sono nel resoconto, con il loro percorso:$\n${JHT_REMOVE_REPORT}" \
          "Something was not removed. The items left are in the report, with their path:$\n${JHT_REMOVE_REPORT}" \
          "Etwas wurde nicht entfernt. Die verbliebenen Einträge stehen mit ihrem Pfad im Bericht:$\n${JHT_REMOVE_REPORT}" \
          "Algo no se ha quitado. Las entradas que quedan están en el informe, con su ruta:$\n${JHT_REMOVE_REPORT}" \
          "Quelque chose n’a pas été retiré. Les éléments restants sont dans le compte rendu, avec leur chemin :$\n${JHT_REMOVE_REPORT}" \
          "Valami nem lett eltávolítva. A megmaradt tételek az elérési útjukkal együtt a jelentésben vannak:$\n${JHT_REMOVE_REPORT}" \
          "Algo não foi removido. Os itens que ficaram estão no relatório, com o seu caminho:$\n${JHT_REMOVE_REPORT}"
        MessageBox MB_OK|MB_ICONEXCLAMATION "$R9"
      ${EndIf}
    ${EndIf}
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
