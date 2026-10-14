import type { Locale } from "@/i18n/config";

export interface ExistingTeamAssistantText {
  title: string;
  active: string; // {when}
  inactive: string; // {when}
  unknown: string;
  whenConnection: string; // {time}
  whenStart: string; // {time}
  activate: string;
  confirmTitle: string;
  /** Cost and effects, read before the confirmation. */
  effects: string;
  noStop: string;
  confirm: string;
  cancel: string;
  starting: string;
  started: string; // {time}
  alreadyActive: string; // {time}
  timedOut: string; // {code}
  failed: string; // {code}
}

export const EXISTING_TEAM_ASSISTANT_TEXT: Record<Locale, ExistingTeamAssistantText> = {
  it: {
    title: "Assistente",
    active: "Attivo ({when}).",
    inactive: "Non attivo ({when}).",
    unknown: "Stato dell’assistente non letto dal collegamento.",
    whenConnection: "al collegamento delle {time}",
    whenStart: "verificato dopo l’avvio alle {time}",
    activate: "Attiva assistente",
    confirmTitle: "Attivare l’assistente di questa squadra?",
    effects:
      "Avvia la sola sessione ASSISTENTE sulla VPS della squadra e apre il provider della squadra con il suo account: consuma token del suo abbonamento. Lo script di avvio invia all’assistente il messaggio [WELCOME-USER] (una volta sola: se ha già accolto l’utente non risponde) e lo mette al lavoro. Non cambia provider e non tocca il capitano né le altre sessioni. Lo script crea anche la cartella di lavoro dell’assistente, la directory utente e i file di lock e di log in /jht_home sulla VPS. Se la sessione esiste già, non succede niente.",
    noStop:
      "Da qui non c’è un pulsante per fermarlo, e fermarlo non annulla l’avvio: se la squadra ha un watchdog, un assistente fermato a mano rinasce in circa 30 secondi.",
    confirm: "Conferma e avvia",
    cancel: "Annulla",
    starting: "Avvio in corso…",
    started: "Assistente avviato e verificato alle {time}.",
    alreadyActive: "Era già attivo: nessun comando di avvio è stato inviato (verificato alle {time}).",
    timedOut:
      "L’avvio è stato richiesto ma l’assistente non risulta attivo nel tempo previsto ({code}). Non è stato abilitato niente e il comando non è stato rilanciato. Puoi riprovare «Attiva assistente»: è sicuro, se l’assistente è già partito la prima verifica lo vede e non viene inviato nessun nuovo avvio. Oppure riconnetti la squadra.",
    failed: "Avvio non riuscito ({code}). Non è stato abilitato niente.",
  },
  en: {
    title: "Assistant",
    active: "Running ({when}).",
    inactive: "Not running ({when}).",
    unknown: "The assistant’s state was not read by the connection.",
    whenConnection: "at the connection at {time}",
    whenStart: "checked after the start at {time}",
    activate: "Start assistant",
    confirmTitle: "Start this team’s assistant?",
    effects:
      "It starts the ASSISTENTE session alone on the team’s VPS and opens the team’s provider with its account: it spends tokens of its subscription. The start script sends the assistant the [WELCOME-USER] message (once only: if it has already welcomed the user it does not answer) and puts it to work. It does not change provider and does not touch the captain or the other sessions. The script also creates the assistant’s working folder, the user directory and the lock and log files in /jht_home on the VPS. If the session already exists, nothing happens.",
    noStop:
      "There is no button to stop it from here, and stopping it does not undo the start: if the team has a watchdog, an assistant stopped by hand comes back in about 30 seconds.",
    confirm: "Confirm and start",
    cancel: "Cancel",
    starting: "Starting…",
    started: "Assistant started and checked at {time}.",
    alreadyActive: "It was already running: no start command was sent (checked at {time}).",
    timedOut:
      "The start was requested but the assistant is not running within the expected time ({code}). Nothing was enabled and the command was not sent again. You can try “Start assistant” again: it is safe, if the assistant has already started the first check sees it and no new start is sent. Or connect the team again.",
    failed: "The start did not succeed ({code}). Nothing was enabled.",
  },
  de: {
    title: "Assistent",
    active: "Läuft ({when}).",
    inactive: "Läuft nicht ({when}).",
    unknown: "Der Zustand des Assistenten wurde beim Verbinden nicht gelesen.",
    whenConnection: "beim Verbinden um {time}",
    whenStart: "nach dem Start geprüft um {time}",
    activate: "Assistent starten",
    confirmTitle: "Den Assistenten dieses Teams starten?",
    effects:
      "Es startet nur die Sitzung ASSISTENTE auf dem VPS des Teams und öffnet den Anbieter des Teams mit dessen Konto: Es verbraucht Token seines Abonnements. Das Startskript sendet dem Assistenten die Nachricht [WELCOME-USER] (nur einmal: Hat er den Nutzer schon begrüßt, antwortet er nicht) und setzt ihn an die Arbeit. Es wechselt den Anbieter nicht und berührt weder den Kapitän noch die anderen Sitzungen. Das Skript legt außerdem den Arbeitsordner des Assistenten, das Benutzerverzeichnis sowie Lock- und Logdateien in /jht_home auf dem VPS an. Existiert die Sitzung schon, passiert nichts.",
    noStop:
      "Von hier gibt es keine Schaltfläche zum Stoppen, und Stoppen macht den Start nicht rückgängig: Hat das Team einen Watchdog, kommt ein von Hand gestoppter Assistent nach etwa 30 Sekunden zurück.",
    confirm: "Bestätigen und starten",
    cancel: "Abbrechen",
    starting: "Start läuft…",
    started: "Assistent um {time} gestartet und geprüft.",
    alreadyActive: "Er lief schon: Es wurde kein Startbefehl gesendet (geprüft um {time}).",
    timedOut:
      "Der Start wurde angefordert, aber der Assistent läuft nicht in der erwarteten Zeit ({code}). Nichts wurde aktiviert und der Befehl wurde nicht erneut gesendet. Du kannst „Assistent starten“ erneut versuchen: Das ist sicher, denn ist der Assistent schon gestartet, sieht ihn die erste Prüfung und es wird kein neuer Start gesendet. Oder verbinde das Team erneut.",
    failed: "Der Start ist fehlgeschlagen ({code}). Nichts wurde aktiviert.",
  },
  fr: {
    title: "Assistant",
    active: "Actif ({when}).",
    inactive: "Inactif ({when}).",
    unknown: "L’état de l’assistant n’a pas été lu à la connexion.",
    whenConnection: "à la connexion de {time}",
    whenStart: "vérifié après le démarrage à {time}",
    activate: "Activer l’assistant",
    confirmTitle: "Activer l’assistant de cette équipe ?",
    effects:
      "Cela démarre la seule session ASSISTENTE sur le VPS de l’équipe et ouvre le fournisseur de l’équipe avec son compte : cela consomme des jetons de son abonnement. Le script de démarrage envoie à l’assistant le message [WELCOME-USER] (une seule fois : s’il a déjà accueilli l’utilisateur, il ne répond pas) et le met au travail. Cela ne change pas de fournisseur et ne touche ni le capitaine ni les autres sessions. Le script crée aussi le dossier de travail de l’assistant, le répertoire utilisateur et les fichiers de verrou et de journal dans /jht_home sur le VPS. Si la session existe déjà, rien ne se passe.",
    noStop:
      "Il n’y a pas de bouton pour l’arrêter d’ici, et l’arrêter n’annule pas le démarrage : si l’équipe a un watchdog, un assistant arrêté à la main revient en 30 secondes environ.",
    confirm: "Confirmer et démarrer",
    cancel: "Annuler",
    starting: "Démarrage…",
    started: "Assistant démarré et vérifié à {time}.",
    alreadyActive: "Il était déjà actif : aucune commande de démarrage n’a été envoyée (vérifié à {time}).",
    timedOut:
      "Le démarrage a été demandé mais l’assistant n’est pas actif dans le délai prévu ({code}). Rien n’a été activé et la commande n’a pas été renvoyée. Tu peux réessayer « Activer l’assistant » : c’est sans risque, si l’assistant a déjà démarré la première vérification le voit et aucun nouveau démarrage n’est envoyé. Ou reconnecte l’équipe.",
    failed: "Le démarrage a échoué ({code}). Rien n’a été activé.",
  },
  es: {
    title: "Asistente",
    active: "Activo ({when}).",
    inactive: "No activo ({when}).",
    unknown: "El estado del asistente no se leyó en la conexión.",
    whenConnection: "en la conexión de las {time}",
    whenStart: "comprobado tras el arranque a las {time}",
    activate: "Activar asistente",
    confirmTitle: "¿Activar el asistente de este equipo?",
    effects:
      "Arranca solo la sesión ASSISTENTE en la VPS del equipo y abre el proveedor del equipo con su cuenta: consume tokens de su suscripción. El script de arranque envía al asistente el mensaje [WELCOME-USER] (una sola vez: si ya dio la bienvenida al usuario, no responde) y lo pone a trabajar. No cambia de proveedor ni toca al capitán ni a las demás sesiones. El script también crea la carpeta de trabajo del asistente, el directorio de usuario y los archivos de bloqueo y de registro en /jht_home de la VPS. Si la sesión ya existe, no pasa nada.",
    noStop:
      "Desde aquí no hay botón para pararlo, y pararlo no deshace el arranque: si el equipo tiene un watchdog, un asistente parado a mano reaparece en unos 30 segundos.",
    confirm: "Confirmar y arrancar",
    cancel: "Cancelar",
    starting: "Arrancando…",
    started: "Asistente arrancado y comprobado a las {time}.",
    alreadyActive: "Ya estaba activo: no se envió ningún comando de arranque (comprobado a las {time}).",
    timedOut:
      "Se pidió el arranque pero el asistente no está activo en el tiempo previsto ({code}). No se activó nada y el comando no se reenvió. Puedes reintentar «Activar asistente»: es seguro, si el asistente ya arrancó la primera comprobación lo ve y no se envía ningún arranque nuevo. O vuelve a conectar el equipo.",
    failed: "El arranque no tuvo éxito ({code}). No se activó nada.",
  },
  pt: {
    title: "Assistente",
    active: "Ativo ({when}).",
    inactive: "Não ativo ({when}).",
    unknown: "O estado do assistente não foi lido na ligação.",
    whenConnection: "na ligação das {time}",
    whenStart: "verificado após o arranque às {time}",
    activate: "Ativar assistente",
    confirmTitle: "Ativar o assistente desta equipa?",
    effects:
      "Arranca apenas a sessão ASSISTENTE na VPS da equipa e abre o fornecedor da equipa com a sua conta: consome tokens da sua subscrição. O script de arranque envia ao assistente a mensagem [WELCOME-USER] (uma só vez: se já deu as boas-vindas ao utilizador, não responde) e põe-no a trabalhar. Não muda de fornecedor e não toca no capitão nem nas outras sessões. O script também cria a pasta de trabalho do assistente, o diretório do utilizador e os ficheiros de bloqueio e de registo em /jht_home na VPS. Se a sessão já existe, não acontece nada.",
    noStop:
      "A partir daqui não há botão para o parar, e pará-lo não desfaz o arranque: se a equipa tem um watchdog, um assistente parado à mão regressa em cerca de 30 segundos.",
    confirm: "Confirmar e arrancar",
    cancel: "Cancelar",
    starting: "A arrancar…",
    started: "Assistente arrancado e verificado às {time}.",
    alreadyActive: "Já estava ativo: nenhum comando de arranque foi enviado (verificado às {time}).",
    timedOut:
      "O arranque foi pedido mas o assistente não está ativo no tempo previsto ({code}). Nada foi ativado e o comando não foi reenviado. Podes tentar de novo «Ativar assistente»: é seguro, se o assistente já arrancou a primeira verificação vê-o e não é enviado nenhum novo arranque. Ou volta a ligar a equipa.",
    failed: "O arranque não teve êxito ({code}). Nada foi ativado.",
  },
  hu: {
    title: "Asszisztens",
    active: "Fut ({when}).",
    inactive: "Nem fut ({when}).",
    unknown: "Az asszisztens állapotát a kapcsolódáskor nem olvastuk be.",
    whenConnection: "a {time}-i kapcsolódáskor",
    whenStart: "az indítás után ellenőrizve: {time}",
    activate: "Asszisztens indítása",
    confirmTitle: "Elindítod a csapat asszisztensét?",
    effects:
      "Csak az ASSISTENTE munkamenetet indítja el a csapat VPS-én, és megnyitja a csapat szolgáltatóját annak fiókjával: az előfizetés tokenjeit használja el. Az indítószkript elküldi az asszisztensnek a [WELCOME-USER] üzenetet (csak egyszer: ha már üdvözölte a felhasználót, nem válaszol), és munkára fogja. Nem vált szolgáltatót, és nem nyúl a kapitányhoz vagy a többi munkamenethez. A szkript létrehozza az asszisztens munkamappáját, a felhasználói könyvtárat, valamint a zár- és naplófájlokat is a VPS /jht_home könyvtárában. Ha a munkamenet már létezik, semmi nem történik.",
    noStop:
      "Innen nincs gomb a leállításához, és a leállítás nem vonja vissza az indítást: ha a csapatnak van watchdogja, a kézzel leállított asszisztens körülbelül 30 másodperc múlva visszatér.",
    confirm: "Megerősítés és indítás",
    cancel: "Mégse",
    starting: "Indítás…",
    started: "Az asszisztens elindult és ellenőrizve: {time}.",
    alreadyActive: "Már futott: nem küldtünk indítási parancsot (ellenőrizve: {time}).",
    timedOut:
      "Az indítást kértük, de az asszisztens a várt időn belül nem fut ({code}). Semmit nem engedélyeztünk, és a parancsot nem küldtük újra. Újra megpróbálhatod az „Asszisztens indítása” gombot: biztonságos, ha az asszisztens már elindult, az első ellenőrzés látja, és nem megy új indítás. Vagy csatlakoztasd újra a csapatot.",
    failed: "Az indítás nem sikerült ({code}). Semmit nem engedélyeztünk.",
  },
};
