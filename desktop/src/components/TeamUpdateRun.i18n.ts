import type { Locale } from "@/i18n/config";
import type { TeamUpdatePhase, TeamUpdateReason } from "../lib/team-update";

/**
 * The words of «Update the team» done by the app and of the notice that the team is older than the app, in plain
 * language: no «runtime», no «image», no «host». 7 languages; Italian is the source and its shape is the type.
 * {from}, {to} and {where} are filled by the page.
 */
const it = {
  notice: "La squadra gira su una versione più vecchia di questa app.",
  noticeLater: "Più tardi",
  button: "Aggiorna la squadra",
  confirm:
    "Scarico la versione nuova e la squadra si ferma per qualche minuto. I tuoi dati restano dove sono. Se qualcosa va storto, torna la versione di prima.",
  start: "Aggiorna ora",
  cancel: "Annulla",
  running: "Aggiornamento in corso… Può volerci qualche minuto. Non chiudere l’app.",
  done: "Squadra aggiornata.",
  doneVersions: "Dalla versione {from} alla {to}.",
  already: "La squadra era già aggiornata.",
  restart: "Se la squadra non riparte da sola, avviala dalla pagina Squadra.",
  failed: "Aggiornamento non riuscito.",
  stoppedAt: "Si è fermato {where}.",
  where: {
    start: "prima di cominciare",
    download: "durante il download",
    switch: "mentre avviava la versione nuova",
    verify: "durante la verifica",
  },
  rolledBack: "La versione di prima è stata rimessa: la squadra funziona come prima.",
  notRolledBack: "Non so dirti se la squadra sia ripartita. Riprova; se si ripete, riavvia Job Hunter Team.",
  retry: "Riprova",
  close: "Chiudi",
  reasons: {
    test_channel: "Questa è un’installazione di prova: si aggiorna reinstallando dalla build di prova.",
    disk_low: "C’è poco spazio sul disco. Libera spazio e riprova.",
    in_progress: "Un altro aggiornamento è già in corso.",
    download_failed: "Non sono riuscito a scaricare la versione nuova. Controlla la connessione e riprova.",
    engine_unavailable: "Il programma che fa girare la squadra non è acceso.",
    release_unreachable: "Non riesco a raggiungere il server delle versioni. Controlla la connessione e riprova.",
    podman_machine_mounts: "La macchina virtuale vede più cartelle del necessario e va ricreata prima di aggiornare.",
  } satisfies Record<TeamUpdateReason, string>,
};

export type TeamUpdateRunText = typeof it;

const en: TeamUpdateRunText = {
  notice: "The team runs an older version than this app.",
  noticeLater: "Later",
  button: "Update the team",
  confirm:
    "I download the new version and the team stops for a few minutes. Your data stays where it is. If something goes wrong, the previous version comes back.",
  start: "Update now",
  cancel: "Cancel",
  running: "Updating… It can take a few minutes. Do not close the app.",
  done: "Team updated.",
  doneVersions: "From version {from} to {to}.",
  already: "The team was already up to date.",
  restart: "If the team does not start by itself, start it from the Team page.",
  failed: "The update did not succeed.",
  stoppedAt: "It stopped {where}.",
  where: {
    start: "before it began",
    download: "during the download",
    switch: "while starting the new version",
    verify: "during the check",
  },
  rolledBack: "The previous version is back: the team works as before.",
  notRolledBack: "I cannot tell whether the team started again. Try again; if it happens again, restart Job Hunter Team.",
  retry: "Try again",
  close: "Close",
  reasons: {
    test_channel: "This is a test installation: it is updated by installing again from the test build.",
    disk_low: "There is little space left on the disk. Free up space and try again.",
    in_progress: "Another update is already running.",
    download_failed: "I could not download the new version. Check your connection and try again.",
    engine_unavailable: "The program that runs the team is not on.",
    release_unreachable: "I cannot reach the server that has the versions. Check your connection and try again.",
    podman_machine_mounts: "The virtual machine sees more folders than it needs and must be recreated before updating.",
  },
};

const de: TeamUpdateRunText = {
  notice: "Das Team läuft in einer älteren Version als diese App.",
  noticeLater: "Später",
  button: "Team aktualisieren",
  confirm:
    "Ich lade die neue Version herunter und das Team hält einige Minuten an. Deine Daten bleiben, wo sie sind. Geht etwas schief, kommt die vorherige Version zurück.",
  start: "Jetzt aktualisieren",
  cancel: "Abbrechen",
  running: "Aktualisierung läuft… Das kann einige Minuten dauern. Schließe die App nicht.",
  done: "Team aktualisiert.",
  doneVersions: "Von Version {from} auf {to}.",
  already: "Das Team war schon auf dem neuesten Stand.",
  restart: "Startet das Team nicht von selbst, starte es auf der Seite „Team“.",
  failed: "Die Aktualisierung ist fehlgeschlagen.",
  stoppedAt: "Sie ist {where} stehen geblieben.",
  where: {
    start: "vor dem Start",
    download: "beim Herunterladen",
    switch: "beim Starten der neuen Version",
    verify: "bei der Prüfung",
  },
  rolledBack: "Die vorherige Version ist wieder da: Das Team arbeitet wie vorher.",
  notRolledBack: "Ich kann nicht sagen, ob das Team wieder gestartet ist. Versuche es erneut; wenn es wieder passiert, starte Job Hunter Team neu.",
  retry: "Erneut versuchen",
  close: "Schließen",
  reasons: {
    test_channel: "Das ist eine Testinstallation: Sie wird aktualisiert, indem du aus dem Test-Build neu installierst.",
    disk_low: "Auf der Festplatte ist wenig Platz. Schaffe Platz und versuche es erneut.",
    in_progress: "Eine andere Aktualisierung läuft bereits.",
    download_failed: "Ich konnte die neue Version nicht herunterladen. Prüfe deine Verbindung und versuche es erneut.",
    engine_unavailable: "Das Programm, das das Team ausführt, ist nicht eingeschaltet.",
    release_unreachable: "Ich erreiche den Server mit den Versionen nicht. Prüfe deine Verbindung und versuche es erneut.",
    podman_machine_mounts: "Die virtuelle Maschine sieht mehr Ordner als nötig und muss vor der Aktualisierung neu erstellt werden.",
  },
};

const es: TeamUpdateRunText = {
  notice: "El equipo funciona con una versión más antigua que esta app.",
  noticeLater: "Más tarde",
  button: "Actualizar el equipo",
  confirm:
    "Descargo la versión nueva y el equipo se detiene unos minutos. Tus datos se quedan donde están. Si algo sale mal, vuelve la versión anterior.",
  start: "Actualizar ahora",
  cancel: "Cancelar",
  running: "Actualizando… Puede tardar unos minutos. No cierres la app.",
  done: "Equipo actualizado.",
  doneVersions: "De la versión {from} a la {to}.",
  already: "El equipo ya estaba actualizado.",
  restart: "Si el equipo no arranca solo, arráncalo desde la página Equipo.",
  failed: "La actualización no se ha completado.",
  stoppedAt: "Se detuvo {where}.",
  where: {
    start: "antes de empezar",
    download: "durante la descarga",
    switch: "al arrancar la versión nueva",
    verify: "durante la comprobación",
  },
  rolledBack: "La versión anterior ha vuelto: el equipo funciona como antes.",
  notRolledBack: "No sé decirte si el equipo ha vuelto a arrancar. Inténtalo de nuevo; si se repite, reinicia Job Hunter Team.",
  retry: "Reintentar",
  close: "Cerrar",
  reasons: {
    test_channel: "Es una instalación de prueba: se actualiza reinstalando desde la build de prueba.",
    disk_low: "Queda poco espacio en el disco. Libera espacio y vuelve a intentarlo.",
    in_progress: "Ya hay otra actualización en curso.",
    download_failed: "No he podido descargar la versión nueva. Revisa la conexión y vuelve a intentarlo.",
    engine_unavailable: "El programa que ejecuta el equipo no está encendido.",
    release_unreachable: "No consigo llegar al servidor de las versiones. Revisa la conexión y vuelve a intentarlo.",
    podman_machine_mounts: "La máquina virtual ve más carpetas de las necesarias y hay que recrearla antes de actualizar.",
  },
};

const fr: TeamUpdateRunText = {
  notice: "L’équipe tourne sur une version plus ancienne que cette app.",
  noticeLater: "Plus tard",
  button: "Mettre à jour l’équipe",
  confirm:
    "Je télécharge la nouvelle version et l’équipe s’arrête quelques minutes. Tes données restent où elles sont. Si quelque chose se passe mal, la version précédente revient.",
  start: "Mettre à jour maintenant",
  cancel: "Annuler",
  running: "Mise à jour en cours… Cela peut prendre quelques minutes. Ne ferme pas l’app.",
  done: "Équipe mise à jour.",
  doneVersions: "De la version {from} à la {to}.",
  already: "L’équipe était déjà à jour.",
  restart: "Si l’équipe ne repart pas toute seule, démarre-la depuis la page Équipe.",
  failed: "La mise à jour a échoué.",
  stoppedAt: "Elle s’est arrêtée {where}.",
  where: {
    start: "avant de commencer",
    download: "pendant le téléchargement",
    switch: "au démarrage de la nouvelle version",
    verify: "pendant la vérification",
  },
  rolledBack: "La version précédente est revenue : l’équipe fonctionne comme avant.",
  notRolledBack: "Je ne peux pas dire si l’équipe a redémarré. Réessaie ; si cela se reproduit, redémarre Job Hunter Team.",
  retry: "Réessayer",
  close: "Fermer",
  reasons: {
    test_channel: "C’est une installation de test : elle se met à jour en réinstallant depuis la build de test.",
    disk_low: "Il reste peu de place sur le disque. Libère de l’espace et réessaie.",
    in_progress: "Une autre mise à jour est déjà en cours.",
    download_failed: "Je n’ai pas pu télécharger la nouvelle version. Vérifie ta connexion et réessaie.",
    engine_unavailable: "Le programme qui fait tourner l’équipe n’est pas allumé.",
    release_unreachable: "Je n’arrive pas à joindre le serveur des versions. Vérifie ta connexion et réessaie.",
    podman_machine_mounts: "La machine virtuelle voit plus de dossiers que nécessaire et doit être recréée avant la mise à jour.",
  },
};

const hu: TeamUpdateRunText = {
  notice: "A csapat régebbi verzión fut, mint ez az app.",
  noticeLater: "Később",
  button: "A csapat frissítése",
  confirm:
    "Letöltöm az új verziót, és a csapat pár percre leáll. Az adataid ott maradnak, ahol vannak. Ha valami félresikerül, visszatér az előző verzió.",
  start: "Frissítés most",
  cancel: "Mégse",
  running: "Frissítés folyamatban… Eltarthat néhány percig. Ne zárd be az appot.",
  done: "A csapat frissítve.",
  doneVersions: "A(z) {from} verzióról a(z) {to} verzióra.",
  already: "A csapat már naprakész volt.",
  restart: "Ha a csapat magától nem indul újra, indítsd el a Csapat oldalról.",
  failed: "A frissítés nem sikerült.",
  stoppedAt: "Megállt: {where}.",
  where: {
    start: "kezdés előtt",
    download: "letöltés közben",
    switch: "az új verzió indításakor",
    verify: "ellenőrzés közben",
  },
  rolledBack: "Visszatért az előző verzió: a csapat úgy dolgozik, mint korábban.",
  notRolledBack: "Nem tudom megmondani, hogy a csapat újraindult-e. Próbáld újra; ha ismét megtörténik, indítsd újra a Job Hunter Teamet.",
  retry: "Újra",
  close: "Bezárás",
  reasons: {
    test_channel: "Ez egy tesztbeépítés: a tesztverzióból újratelepítve frissül.",
    disk_low: "Kevés a szabad hely a lemezen. Szabadíts fel helyet, és próbáld újra.",
    in_progress: "Már fut egy másik frissítés.",
    download_failed: "Nem sikerült letölteni az új verziót. Ellenőrizd a kapcsolatot, és próbáld újra.",
    engine_unavailable: "A csapatot futtató program nincs bekapcsolva.",
    release_unreachable: "Nem érem el a verziókat tartalmazó szervert. Ellenőrizd a kapcsolatot, és próbáld újra.",
    podman_machine_mounts: "A virtuális gép a szükségesnél több mappát lát, ezért a frissítés előtt újra kell készíteni.",
  },
};

const pt: TeamUpdateRunText = {
  notice: "A equipa funciona com uma versão mais antiga do que esta app.",
  noticeLater: "Mais tarde",
  button: "Atualizar a equipa",
  confirm:
    "Descarrego a versão nova e a equipa pára durante alguns minutos. Os teus dados ficam onde estão. Se algo correr mal, volta a versão anterior.",
  start: "Atualizar agora",
  cancel: "Cancelar",
  running: "A atualizar… Pode demorar alguns minutos. Não feches a app.",
  done: "Equipa atualizada.",
  doneVersions: "Da versão {from} para a {to}.",
  already: "A equipa já estava atualizada.",
  restart: "Se a equipa não arrancar sozinha, arranca-a na página Equipa.",
  failed: "A atualização não foi concluída.",
  stoppedAt: "Parou {where}.",
  where: {
    start: "antes de começar",
    download: "durante o descarregamento",
    switch: "ao arrancar a versão nova",
    verify: "durante a verificação",
  },
  rolledBack: "A versão anterior voltou: a equipa funciona como antes.",
  notRolledBack: "Não sei dizer se a equipa voltou a arrancar. Tenta novamente; se voltar a acontecer, reinicia o Job Hunter Team.",
  retry: "Tentar novamente",
  close: "Fechar",
  reasons: {
    test_channel: "Esta é uma instalação de teste: atualiza-se reinstalando a partir da build de teste.",
    disk_low: "Há pouco espaço no disco. Liberta espaço e tenta novamente.",
    in_progress: "Já há outra atualização em curso.",
    download_failed: "Não consegui descarregar a versão nova. Verifica a ligação e tenta novamente.",
    engine_unavailable: "O programa que executa a equipa não está ligado.",
    release_unreachable: "Não consigo chegar ao servidor das versões. Verifica a ligação e tenta novamente.",
    podman_machine_mounts: "A máquina virtual vê mais pastas do que o necessário e tem de ser recriada antes de atualizar.",
  },
};

export const TEAM_UPDATE_RUN_TEXT: Record<Locale, TeamUpdateRunText> = { it, en, de, es, fr, hu, pt };

/** The group of words a phase is told in. A finished or unknown phase has none. */
export function whereKey(phase: TeamUpdatePhase): keyof TeamUpdateRunText["where"] | null {
  switch (phase) {
    case "preflight":
    case "recovery":
    case "check":
      return "start";
    case "pull":
    case "candidate_metadata":
      return "download";
    case "activate":
    case "commit":
      return "switch";
    case "verify":
      return "verify";
    default:
      return null;
  }
}
