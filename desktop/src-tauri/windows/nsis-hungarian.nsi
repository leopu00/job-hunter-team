; Hungarian for Tauri's NSIS template (bundle.windows.nsis.customLanguageFiles):
; Tauri 2.11 ships its LangStrings in six of the app's seven languages, not
; in Hungarian. Same ids as its English file; ${PRODUCTNAME} where Tauri's
; own files say {{product_name}}. UTF-8 WITHOUT a BOM: Tauri copies this file
; next to the installer script and writes its own BOM in front, and a second
; one becomes part of the first command («Invalid command: ";"»).

LangString addOrReinstall ${LANG_HUNGARIAN} "Összetevők hozzáadása/újratelepítése"
LangString alreadyInstalled ${LANG_HUNGARIAN} "Már telepítve"
LangString alreadyInstalledLong ${LANG_HUNGARIAN} "A(z) ${PRODUCTNAME} ${VERSION} már telepítve van. Válaszd ki a végrehajtandó műveletet, majd kattints a Tovább gombra."
LangString appRunning ${LANG_HUNGARIAN} "A(z) ${PRODUCTNAME} fut! Előbb zárd be, majd próbáld újra."
LangString appRunningOkKill ${LANG_HUNGARIAN} "A(z) ${PRODUCTNAME} fut!$\nKattints az OK gombra a bezárásához"
LangString chooseMaintenanceOption ${LANG_HUNGARIAN} "Válaszd ki a végrehajtandó karbantartási műveletet."
LangString choowHowToInstall ${LANG_HUNGARIAN} "Válaszd ki, hogyan szeretnéd telepíteni a(z) ${PRODUCTNAME} alkalmazást."
LangString createDesktop ${LANG_HUNGARIAN} "Parancsikon létrehozása az asztalon"
LangString dontUninstall ${LANG_HUNGARIAN} "Ne távolítsa el"
LangString dontUninstallDowngrade ${LANG_HUNGARIAN} "Ne távolítsa el (ez a telepítő eltávolítás nélkül nem enged régebbi verzióra váltani)"
LangString failedToKillApp ${LANG_HUNGARIAN} "Nem sikerült bezárni a(z) ${PRODUCTNAME} alkalmazást. Előbb zárd be, majd próbáld újra"
LangString installingWebview2 ${LANG_HUNGARIAN} "WebView2 telepítése..."
LangString newerVersionInstalled ${LANG_HUNGARIAN} "A(z) ${PRODUCTNAME} egy újabb verziója már telepítve van! Régebbi verziót telepíteni nem ajánlott. Ha mégis ezt a régebbi verziót szeretnéd, jobb előbb eltávolítani a jelenlegit. Válaszd ki a végrehajtandó műveletet, majd kattints a Tovább gombra."
LangString older ${LANG_HUNGARIAN} "régebbi"
LangString olderOrUnknownVersionInstalled ${LANG_HUNGARIAN} "A rendszeren a(z) ${PRODUCTNAME} egy $R4 verziója van telepítve. Telepítés előtt ajánlott eltávolítani a jelenlegi verziót. Válaszd ki a végrehajtandó műveletet, majd kattints a Tovább gombra."
LangString silentDowngrades ${LANG_HUNGARIAN} "Ez a telepítő nem enged régebbi verzióra váltani, a csendes telepítés nem folytatható: használd inkább a grafikus telepítőt.$\n"
LangString unableToUninstall ${LANG_HUNGARIAN} "Az eltávolítás nem sikerült!"
LangString uninstallApp ${LANG_HUNGARIAN} "A(z) ${PRODUCTNAME} eltávolítása"
LangString uninstallBeforeInstalling ${LANG_HUNGARIAN} "Eltávolítás a telepítés előtt"
LangString unknown ${LANG_HUNGARIAN} "ismeretlen"
LangString webview2AbortError ${LANG_HUNGARIAN} "A WebView2 telepítése nem sikerült! Az alkalmazás nem működik nélküle. Próbáld újraindítani a telepítőt."
LangString webview2DownloadError ${LANG_HUNGARIAN} "Hiba: a WebView2 letöltése nem sikerült - $0"
LangString webview2DownloadSuccess ${LANG_HUNGARIAN} "A WebView2 telepítője sikeresen letöltve"
LangString webview2Downloading ${LANG_HUNGARIAN} "A WebView2 telepítőjének letöltése..."
LangString webview2InstallError ${LANG_HUNGARIAN} "Hiba: a WebView2 telepítése a(z) $1 kilépési kóddal meghiúsult"
LangString webview2InstallSuccess ${LANG_HUNGARIAN} "A WebView2 sikeresen telepítve"
LangString deleteAppData ${LANG_HUNGARIAN} "Az alkalmazásadatok törlése"
