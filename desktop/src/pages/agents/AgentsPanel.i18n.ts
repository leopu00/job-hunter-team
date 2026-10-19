import type { Locale } from "@/i18n/config";

export interface AgentsPanelText {
  title: string;
  /** {where}: whereLocal or whereVps */
  intro: string;
  whereLocal: string;
  /** {label}: the VPS's address */
  whereVps: string;
  refresh: string;
  refreshing: string;
  reading: string;
  readAt: string; // {time}
  failed: string;
  failedAt: string; // {time}
  /** the line above the list: who needs the person first */
  summary: string; // {waiting} {working} {up} {total}
  up: string;
  down: string;
  heldByUser: string;
  heldBySafety: string;
  noneUp: string;
  started: string; // {time}
  activity: string; // {time}
  /** the second source of the state: the terminal changed a moment ago */
  screenMoving: string; // {seconds}
  statesUnknown: string;
  tabTerminal: string;
  tabChat: string;
  chatSoon: string; // {name}
  screenReading: string;
  screenAt: string; // {time}
  screenDown: string;
  screenEmpty: string;
  start: string;
  stop: string;
  restart: string;
  confirmStart: string; // {name} {where}
  confirmStop: string; // {name} {where}
  confirmRestart: string; // {name} {where}
  bodyStart: string; // {name}
  bodyStop: string; // {name}
  bodyStopCaptain: string;
  bodyStopAssistant: string;
  bodyRestart: string; // {name}
  confirm: string;
  cancel: string;
  working: string;
  resultStarted: string; // {name}
  resultAlreadyRunning: string; // {name}
  resultStopped: string; // {name}
  resultAlreadyStopped: string; // {name}
  resultRestarted: string; // {name}
  resultPaused: string;
  resultAlreadyPaused: string;
  resultResumed: string;
  resultNotPaused: string;
  teamActive: string;
  teamPausedUntil: string; // {time}
  teamPausedWeekly: string;
  teamPauseEnding: string;
  teamHalted: string;
  pause: string;
  resume: string;
  confirmPause: string; // {where}
  bodyPause: string;
  pauseHours1: string;
  pauseHours4: string;
  pauseTomorrow: string;
  pauseWeekly: string;
  confirmResume: string; // {where}
  bodyResume: string;
  readOnly: string;
  maintenance: string;
  reviewer: string;
}

const it: AgentsPanelText = {
  title: "Agenti",
  intro: "Gli agenti della squadra {where}: lo stato, il terminale e i comandi.",
  whereLocal: "su questo computer",
  whereVps: "sulla VPS {label}",
  refresh: "Aggiorna",
  refreshing: "Aggiorno…",
  reading: "Leggo gli agenti…",
  readAt: "Letto alle {time}",
  failed: "Non ho potuto leggere gli agenti.",
  failedAt: "Tentativo delle {time}",
  summary: "{waiting} ti aspettano · {working} al lavoro · {up} accesi su {total}",
  up: "acceso",
  down: "spento",
  heldByUser: "spento da te",
  heldBySafety: "messo in sicurezza dalla squadra",
  noneUp: "nessuna sessione accesa",
  started: "avviato {time}",
  activity: "ultima attività {time}",
  screenMoving: "il terminale è cambiato {seconds} s fa",
  statesUnknown:
    "La squadra non pubblica ancora lo stato degli agenti: si vedrà dopo un suo aggiornamento. Fino ad allora lo stato è «sconosciuto».",
  tabTerminal: "Terminale",
  tabChat: "Chat",
  chatSoon: "La chat con {name} arriva con il prossimo aggiornamento dell’app.",
  screenReading: "Leggo il terminale…",
  screenAt: "Ultime righe, lette alle {time}. Si aggiornano da sole finché il terminale è aperto.",
  screenDown: "La sessione non è accesa.",
  screenEmpty: "Il terminale è vuoto.",
  start: "Accendi",
  stop: "Spegni",
  restart: "Riavvia",
  confirmStart: "Accendere {name} {where}?",
  confirmStop: "Spegnere {name} {where}?",
  confirmRestart: "Riavviare {name} {where}?",
  bodyStart: "{name} si avvia e comincia a lavorare.",
  bodyStop: "{name} si spegne e resta spento finché non lo riaccendi da qui: la squadra non lo riaccende da sola.",
  bodyStopCaptain:
    "Con il Capitano si ferma il coordinamento: gli altri agenti finiscono quello che stanno facendo, ma non ricevono nuovi compiti.",
  bodyStopAssistant: "Con l’Assistente si ferma anche la chat con te.",
  bodyRestart: "{name} si chiude e riparte: perde la conversazione in corso, non il lavoro già salvato.",
  confirm: "Conferma",
  cancel: "Annulla",
  working: "In corso…",
  resultStarted: "{name} è acceso.",
  resultAlreadyRunning: "{name} era già acceso.",
  resultStopped: "{name} è spento e resta spento finché non lo riaccendi.",
  resultAlreadyStopped: "{name} era già spento: ora resta spento finché non lo riaccendi.",
  resultRestarted: "{name} è ripartito.",
  resultPaused: "La squadra è in pausa.",
  resultAlreadyPaused: "La squadra era già in pausa.",
  resultResumed: "La squadra ha ripreso il lavoro.",
  resultNotPaused: "La squadra non era in pausa.",
  teamActive: "Squadra attiva",
  teamPausedUntil: "Squadra in pausa fino alle {time}",
  teamPausedWeekly: "Squadra in pausa fino al reset del limite settimanale",
  teamPauseEnding: "La pausa è finita: la squadra si sta risvegliando",
  teamHalted: "Squadra fermata da te: non riparte da sola.",
  pause: "Pausa",
  resume: "Riprendi",
  confirmPause: "Mettere in pausa la squadra {where}?",
  bodyPause:
    "Gli agenti finiscono quello che stanno facendo e si fermano senza consumare. La squadra riprende da sola alla scadenza, oppure quando la riprendi da qui.",
  pauseHours1: "Per 1 ora",
  pauseHours4: "Per 4 ore",
  pauseTomorrow: "Fino a domani alle 8",
  pauseWeekly: "Fino al reset del limite settimanale",
  confirmResume: "Riprendere la squadra {where}?",
  bodyResume: "Gli agenti riprendono il lavoro da dove si erano fermati.",
  readOnly:
    "Sola lettura: per accendere, spegnere o mettere in pausa gli agenti collega la squadra con «Conferma e collega».",
  maintenance: "Agente di manutenzione: lo avvia e lo ferma la squadra.",
  reviewer: "Revisore dello Scrittore: si può solo spegnere, lo riavvia lo Scrittore quando serve.",
};

const en: AgentsPanelText = {
  title: "Agents",
  intro: "The team's agents {where}: their state, their terminal and the controls.",
  whereLocal: "on this computer",
  whereVps: "on the VPS {label}",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  reading: "Reading the agents…",
  readAt: "Read at {time}",
  failed: "I could not read the agents.",
  failedAt: "Attempt at {time}",
  summary: "{waiting} waiting for you · {working} working · {up} up of {total}",
  up: "up",
  down: "off",
  heldByUser: "stopped by you",
  heldBySafety: "put in safety by the team",
  noneUp: "no session up",
  started: "started {time}",
  activity: "last activity {time}",
  screenMoving: "the terminal changed {seconds} s ago",
  statesUnknown:
    "The team does not publish the agents' state yet: it will show after the team is updated. Until then the state is “unknown”.",
  tabTerminal: "Terminal",
  tabChat: "Chat",
  chatSoon: "The chat with {name} comes with the next update of the app.",
  screenReading: "Reading the terminal…",
  screenAt: "Last lines, read at {time}. They refresh by themselves while the terminal is open.",
  screenDown: "The session is not up.",
  screenEmpty: "The terminal is empty.",
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  confirmStart: "Start {name} {where}?",
  confirmStop: "Stop {name} {where}?",
  confirmRestart: "Restart {name} {where}?",
  bodyStart: "{name} starts and gets to work.",
  bodyStop: "{name} stops and stays off until you start it again from here: the team does not start it by itself.",
  bodyStopCaptain:
    "With the Captain the coordination stops: the other agents finish what they are doing, but get no new tasks.",
  bodyStopAssistant: "With the Assistant the chat with you stops too.",
  bodyRestart: "{name} closes and starts again: it loses the conversation in progress, not the work already saved.",
  confirm: "Confirm",
  cancel: "Cancel",
  working: "Working…",
  resultStarted: "{name} is up.",
  resultAlreadyRunning: "{name} was already up.",
  resultStopped: "{name} is off and stays off until you start it again.",
  resultAlreadyStopped: "{name} was already off: now it stays off until you start it again.",
  resultRestarted: "{name} started again.",
  resultPaused: "The team is paused.",
  resultAlreadyPaused: "The team was already paused.",
  resultResumed: "The team is back at work.",
  resultNotPaused: "The team was not paused.",
  teamActive: "Team active",
  teamPausedUntil: "Team paused until {time}",
  teamPausedWeekly: "Team paused until the weekly limit resets",
  teamPauseEnding: "The pause is over: the team is waking up",
  teamHalted: "Team stopped by you: it does not start again by itself.",
  pause: "Pause",
  resume: "Resume",
  confirmPause: "Pause the team {where}?",
  bodyPause:
    "The agents finish what they are doing and stop without spending. The team resumes by itself when the time is up, or when you resume it from here.",
  pauseHours1: "For 1 hour",
  pauseHours4: "For 4 hours",
  pauseTomorrow: "Until tomorrow at 8",
  pauseWeekly: "Until the weekly limit resets",
  confirmResume: "Resume the team {where}?",
  bodyResume: "The agents pick up their work where they stopped.",
  readOnly: "Read only: to start, stop or pause the agents, link the team with “Confirm and connect”.",
  maintenance: "Maintenance agent: the team starts and stops it.",
  reviewer: "The Writer's reviewer: it can only be stopped, the Writer starts it again when needed.",
};

const de: AgentsPanelText = {
  title: "Agenten",
  intro: "Die Agenten des Teams {where}: ihr Status, ihr Terminal und die Steuerung.",
  whereLocal: "auf diesem Computer",
  whereVps: "auf der VPS {label}",
  refresh: "Aktualisieren",
  refreshing: "Aktualisiere…",
  reading: "Ich lese die Agenten…",
  readAt: "Gelesen um {time}",
  failed: "Ich konnte die Agenten nicht lesen.",
  failedAt: "Versuch um {time}",
  summary: "{waiting} warten auf dich · {working} arbeiten · {up} von {total} aktiv",
  up: "aktiv",
  down: "aus",
  heldByUser: "von dir gestoppt",
  heldBySafety: "vom Team in Sicherheit gebracht",
  noneUp: "keine Sitzung aktiv",
  started: "gestartet {time}",
  activity: "letzte Aktivität {time}",
  screenMoving: "das Terminal hat sich vor {seconds} s geändert",
  statesUnknown:
    "Das Team veröffentlicht den Status der Agenten noch nicht: Er erscheint nach einem Update des Teams. Bis dahin ist der Status „unbekannt“.",
  tabTerminal: "Terminal",
  tabChat: "Chat",
  chatSoon: "Der Chat mit {name} kommt mit dem nächsten Update der App.",
  screenReading: "Ich lese das Terminal…",
  screenAt: "Letzte Zeilen, gelesen um {time}. Sie aktualisieren sich von selbst, solange das Terminal offen ist.",
  screenDown: "Die Sitzung ist nicht aktiv.",
  screenEmpty: "Das Terminal ist leer.",
  start: "Starten",
  stop: "Stoppen",
  restart: "Neu starten",
  confirmStart: "{name} {where} starten?",
  confirmStop: "{name} {where} stoppen?",
  confirmRestart: "{name} {where} neu starten?",
  bodyStart: "{name} startet und beginnt zu arbeiten.",
  bodyStop: "{name} stoppt und bleibt aus, bis du ihn hier wieder startest: Das Team startet ihn nicht von selbst.",
  bodyStopCaptain:
    "Mit dem Kapitän stoppt die Koordination: Die anderen Agenten beenden, was sie gerade tun, bekommen aber keine neuen Aufgaben.",
  bodyStopAssistant: "Mit dem Assistenten stoppt auch der Chat mit dir.",
  bodyRestart: "{name} schließt sich und startet neu: Er verliert das laufende Gespräch, nicht die bereits gespeicherte Arbeit.",
  confirm: "Bestätigen",
  cancel: "Abbrechen",
  working: "Läuft…",
  resultStarted: "{name} ist aktiv.",
  resultAlreadyRunning: "{name} war bereits aktiv.",
  resultStopped: "{name} ist aus und bleibt aus, bis du ihn wieder startest.",
  resultAlreadyStopped: "{name} war bereits aus: Jetzt bleibt er aus, bis du ihn wieder startest.",
  resultRestarted: "{name} ist neu gestartet.",
  resultPaused: "Das Team ist pausiert.",
  resultAlreadyPaused: "Das Team war bereits pausiert.",
  resultResumed: "Das Team arbeitet wieder.",
  resultNotPaused: "Das Team war nicht pausiert.",
  teamActive: "Team aktiv",
  teamPausedUntil: "Team pausiert bis {time}",
  teamPausedWeekly: "Team pausiert bis zum Zurücksetzen des Wochenlimits",
  teamPauseEnding: "Die Pause ist vorbei: Das Team wacht gerade auf",
  teamHalted: "Team von dir gestoppt: Es startet nicht von selbst wieder.",
  pause: "Pausieren",
  resume: "Fortsetzen",
  confirmPause: "Das Team {where} pausieren?",
  bodyPause:
    "Die Agenten beenden, was sie gerade tun, und halten an, ohne etwas zu verbrauchen. Das Team setzt von selbst fort, wenn die Zeit abgelaufen ist, oder wenn du es hier fortsetzt.",
  pauseHours1: "Für 1 Stunde",
  pauseHours4: "Für 4 Stunden",
  pauseTomorrow: "Bis morgen um 8 Uhr",
  pauseWeekly: "Bis das Wochenlimit zurückgesetzt wird",
  confirmResume: "Das Team {where} fortsetzen?",
  bodyResume: "Die Agenten machen dort weiter, wo sie aufgehört haben.",
  readOnly:
    "Nur Lesen: Um die Agenten zu starten, zu stoppen oder zu pausieren, verbinde das Team mit „Bestätigen und verbinden“.",
  maintenance: "Wartungsagent: Das Team startet und stoppt ihn.",
  reviewer: "Prüfer des Schreibers: Er kann nur gestoppt werden, der Schreiber startet ihn bei Bedarf wieder.",
};

const es: AgentsPanelText = {
  title: "Agentes",
  intro: "Los agentes del equipo {where}: su estado, su terminal y los controles.",
  whereLocal: "en este ordenador",
  whereVps: "en el VPS {label}",
  refresh: "Actualizar",
  refreshing: "Actualizando…",
  reading: "Leyendo los agentes…",
  readAt: "Leído a las {time}",
  failed: "No he podido leer los agentes.",
  failedAt: "Intento de las {time}",
  summary: "{waiting} te esperan · {working} trabajando · {up} activos de {total}",
  up: "activo",
  down: "apagado",
  heldByUser: "apagado por ti",
  heldBySafety: "puesto en seguridad por el equipo",
  noneUp: "ninguna sesión activa",
  started: "iniciado {time}",
  activity: "última actividad {time}",
  screenMoving: "el terminal cambió hace {seconds} s",
  statesUnknown:
    "El equipo todavía no publica el estado de los agentes: se verá tras una actualización del equipo. Hasta entonces el estado es «desconocido».",
  tabTerminal: "Terminal",
  tabChat: "Chat",
  chatSoon: "El chat con {name} llega con la próxima actualización de la app.",
  screenReading: "Leyendo el terminal…",
  screenAt: "Últimas líneas, leídas a las {time}. Se actualizan solas mientras el terminal está abierto.",
  screenDown: "La sesión no está activa.",
  screenEmpty: "El terminal está vacío.",
  start: "Encender",
  stop: "Apagar",
  restart: "Reiniciar",
  confirmStart: "¿Encender {name} {where}?",
  confirmStop: "¿Apagar {name} {where}?",
  confirmRestart: "¿Reiniciar {name} {where}?",
  bodyStart: "{name} se inicia y se pone a trabajar.",
  bodyStop: "{name} se apaga y sigue apagado hasta que lo vuelvas a encender desde aquí: el equipo no lo enciende por su cuenta.",
  bodyStopCaptain:
    "Con el Capitán se detiene la coordinación: los demás agentes terminan lo que están haciendo, pero no reciben tareas nuevas.",
  bodyStopAssistant: "Con el Asistente se detiene también el chat contigo.",
  bodyRestart: "{name} se cierra y vuelve a empezar: pierde la conversación en curso, no el trabajo ya guardado.",
  confirm: "Confirmar",
  cancel: "Cancelar",
  working: "En curso…",
  resultStarted: "{name} está encendido.",
  resultAlreadyRunning: "{name} ya estaba encendido.",
  resultStopped: "{name} está apagado y sigue apagado hasta que lo vuelvas a encender.",
  resultAlreadyStopped: "{name} ya estaba apagado: ahora sigue apagado hasta que lo vuelvas a encender.",
  resultRestarted: "{name} ha vuelto a empezar.",
  resultPaused: "El equipo está en pausa.",
  resultAlreadyPaused: "El equipo ya estaba en pausa.",
  resultResumed: "El equipo ha vuelto al trabajo.",
  resultNotPaused: "El equipo no estaba en pausa.",
  teamActive: "Equipo activo",
  teamPausedUntil: "Equipo en pausa hasta las {time}",
  teamPausedWeekly: "Equipo en pausa hasta que se restablezca el límite semanal",
  teamPauseEnding: "La pausa ha terminado: el equipo se está despertando",
  teamHalted: "Equipo detenido por ti: no vuelve a arrancar solo.",
  pause: "Pausa",
  resume: "Reanudar",
  confirmPause: "¿Poner en pausa el equipo {where}?",
  bodyPause:
    "Los agentes terminan lo que están haciendo y se detienen sin consumir. El equipo se reanuda solo al vencer el plazo, o cuando lo reanudes desde aquí.",
  pauseHours1: "Durante 1 hora",
  pauseHours4: "Durante 4 horas",
  pauseTomorrow: "Hasta mañana a las 8",
  pauseWeekly: "Hasta que se restablezca el límite semanal",
  confirmResume: "¿Reanudar el equipo {where}?",
  bodyResume: "Los agentes retoman el trabajo donde lo dejaron.",
  readOnly:
    "Solo lectura: para encender, apagar o poner en pausa los agentes, conecta el equipo con «Confirmar y conectar».",
  maintenance: "Agente de mantenimiento: lo inicia y lo detiene el equipo.",
  reviewer: "Revisor del Escritor: solo se puede apagar, el Escritor lo vuelve a iniciar cuando hace falta.",
};

const fr: AgentsPanelText = {
  title: "Agents",
  intro: "Les agents de l’équipe {where} : leur état, leur terminal et les commandes.",
  whereLocal: "sur cet ordinateur",
  whereVps: "sur le VPS {label}",
  refresh: "Actualiser",
  refreshing: "Actualisation…",
  reading: "Je lis les agents…",
  readAt: "Lu à {time}",
  failed: "Je n’ai pas pu lire les agents.",
  failedAt: "Tentative de {time}",
  summary: "{waiting} vous attendent · {working} au travail · {up} actifs sur {total}",
  up: "actif",
  down: "éteint",
  heldByUser: "arrêté par vous",
  heldBySafety: "mis en sécurité par l’équipe",
  noneUp: "aucune session active",
  started: "démarré {time}",
  activity: "dernière activité {time}",
  screenMoving: "le terminal a changé il y a {seconds} s",
  statesUnknown:
    "L’équipe ne publie pas encore l’état des agents : il apparaîtra après une mise à jour de l’équipe. D’ici là, l’état est « inconnu ».",
  tabTerminal: "Terminal",
  tabChat: "Chat",
  chatSoon: "Le chat avec {name} arrive avec la prochaine mise à jour de l’app.",
  screenReading: "Je lis le terminal…",
  screenAt: "Dernières lignes, lues à {time}. Elles se mettent à jour toutes seules tant que le terminal est ouvert.",
  screenDown: "La session n’est pas active.",
  screenEmpty: "Le terminal est vide.",
  start: "Démarrer",
  stop: "Arrêter",
  restart: "Redémarrer",
  confirmStart: "Démarrer {name} {where} ?",
  confirmStop: "Arrêter {name} {where} ?",
  confirmRestart: "Redémarrer {name} {where} ?",
  bodyStart: "{name} démarre et se met au travail.",
  bodyStop: "{name} s’arrête et reste éteint jusqu’à ce que vous le redémarriez d’ici : l’équipe ne le redémarre pas d’elle-même.",
  bodyStopCaptain:
    "Avec le Capitaine, la coordination s’arrête : les autres agents terminent ce qu’ils font, mais ne reçoivent plus de nouvelles tâches.",
  bodyStopAssistant: "Avec l’Assistant, le chat avec vous s’arrête aussi.",
  bodyRestart: "{name} se ferme et redémarre : il perd la conversation en cours, pas le travail déjà enregistré.",
  confirm: "Confirmer",
  cancel: "Annuler",
  working: "En cours…",
  resultStarted: "{name} est actif.",
  resultAlreadyRunning: "{name} était déjà actif.",
  resultStopped: "{name} est éteint et reste éteint jusqu’à ce que vous le redémarriez.",
  resultAlreadyStopped: "{name} était déjà éteint : il reste maintenant éteint jusqu’à ce que vous le redémarriez.",
  resultRestarted: "{name} a redémarré.",
  resultPaused: "L’équipe est en pause.",
  resultAlreadyPaused: "L’équipe était déjà en pause.",
  resultResumed: "L’équipe a repris le travail.",
  resultNotPaused: "L’équipe n’était pas en pause.",
  teamActive: "Équipe active",
  teamPausedUntil: "Équipe en pause jusqu’à {time}",
  teamPausedWeekly: "Équipe en pause jusqu’à la réinitialisation de la limite hebdomadaire",
  teamPauseEnding: "La pause est terminée : l’équipe se réveille",
  teamHalted: "Équipe arrêtée par vous : elle ne redémarre pas d’elle-même.",
  pause: "Pause",
  resume: "Reprendre",
  confirmPause: "Mettre en pause l’équipe {where} ?",
  bodyPause:
    "Les agents terminent ce qu’ils font et s’arrêtent sans rien consommer. L’équipe reprend d’elle-même à l’échéance, ou quand vous la reprenez d’ici.",
  pauseHours1: "Pendant 1 heure",
  pauseHours4: "Pendant 4 heures",
  pauseTomorrow: "Jusqu’à demain à 8 h",
  pauseWeekly: "Jusqu’à la réinitialisation de la limite hebdomadaire",
  confirmResume: "Reprendre l’équipe {where} ?",
  bodyResume: "Les agents reprennent le travail là où ils s’étaient arrêtés.",
  readOnly:
    "Lecture seule : pour démarrer, arrêter ou mettre en pause les agents, reliez l’équipe avec « Confirmer et relier ».",
  maintenance: "Agent de maintenance : c’est l’équipe qui le démarre et l’arrête.",
  reviewer: "Relecteur du Rédacteur : il ne peut qu’être arrêté, le Rédacteur le redémarre quand il le faut.",
};

const hu: AgentsPanelText = {
  title: "Ügynökök",
  intro: "A csapat ügynökei {where}: az állapotuk, a termináljuk és a vezérlés.",
  whereLocal: "ezen a számítógépen",
  whereVps: "a(z) {label} VPS-en",
  refresh: "Frissítés",
  refreshing: "Frissítés…",
  reading: "Beolvasom az ügynököket…",
  readAt: "Beolvasva: {time}",
  failed: "Nem tudtam beolvasni az ügynököket.",
  failedAt: "Próbálkozás: {time}",
  summary: "{waiting} rád vár · {working} dolgozik · {up} aktív / {total}",
  up: "aktív",
  down: "kikapcsolva",
  heldByUser: "te kapcsoltad ki",
  heldBySafety: "a csapat biztonsági okból leállította",
  noneUp: "nincs aktív munkamenet",
  started: "elindítva: {time}",
  activity: "utolsó tevékenység: {time}",
  screenMoving: "a terminál {seconds} mp-cel ezelőtt változott",
  statesUnknown:
    "A csapat még nem teszi közzé az ügynökök állapotát: a csapat frissítése után látszik majd. Addig az állapot „ismeretlen”.",
  tabTerminal: "Terminál",
  tabChat: "Csevegés",
  chatSoon: "A(z) {name} ügynökkel való csevegés az alkalmazás következő frissítésével érkezik.",
  screenReading: "Beolvasom a terminált…",
  screenAt: "Utolsó sorok, beolvasva: {time}. Amíg a terminál nyitva van, maguktól frissülnek.",
  screenDown: "A munkamenet nem aktív.",
  screenEmpty: "A terminál üres.",
  start: "Bekapcsolás",
  stop: "Kikapcsolás",
  restart: "Újraindítás",
  confirmStart: "Bekapcsolod: {name}, {where}?",
  confirmStop: "Kikapcsolod: {name}, {where}?",
  confirmRestart: "Újraindítod: {name}, {where}?",
  bodyStart: "{name} elindul és munkához lát.",
  bodyStop: "{name} leáll, és kikapcsolva marad, amíg innen újra be nem kapcsolod: a csapat magától nem indítja el.",
  bodyStopCaptain:
    "A Kapitánnyal leáll a koordináció: a többi ügynök befejezi, amin dolgozik, de nem kap új feladatot.",
  bodyStopAssistant: "Az Asszisztenssel a veled folytatott csevegés is leáll.",
  bodyRestart: "{name} bezárul és újraindul: elveszíti a folyamatban lévő beszélgetést, a már mentett munkát nem.",
  confirm: "Megerősítés",
  cancel: "Mégse",
  working: "Folyamatban…",
  resultStarted: "{name} aktív.",
  resultAlreadyRunning: "{name} már aktív volt.",
  resultStopped: "{name} kikapcsolva, és így marad, amíg újra be nem kapcsolod.",
  resultAlreadyStopped: "{name} már ki volt kapcsolva: most kikapcsolva marad, amíg újra be nem kapcsolod.",
  resultRestarted: "{name} újraindult.",
  resultPaused: "A csapat szünetel.",
  resultAlreadyPaused: "A csapat már szünetelt.",
  resultResumed: "A csapat folytatja a munkát.",
  resultNotPaused: "A csapat nem szünetelt.",
  teamActive: "A csapat aktív",
  teamPausedUntil: "A csapat szünetel eddig: {time}",
  teamPausedWeekly: "A csapat szünetel a heti limit visszaállásáig",
  teamPauseEnding: "A szünet véget ért: a csapat éppen ébred",
  teamHalted: "A csapatot te állítottad le: magától nem indul újra.",
  pause: "Szünet",
  resume: "Folytatás",
  confirmPause: "Szünetelteted a csapatot {where}?",
  bodyPause:
    "Az ügynökök befejezik, amin dolgoznak, és fogyasztás nélkül leállnak. A csapat a határidő lejártakor magától folytatja, vagy amikor innen folytatod.",
  pauseHours1: "1 órára",
  pauseHours4: "4 órára",
  pauseTomorrow: "Holnap 8 óráig",
  pauseWeekly: "A heti limit visszaállásáig",
  confirmResume: "Folytatod a csapatot {where}?",
  bodyResume: "Az ügynökök ott folytatják a munkát, ahol abbahagyták.",
  readOnly:
    "Csak olvasás: az ügynökök bekapcsolásához, kikapcsolásához vagy szüneteltetéséhez csatlakoztasd a csapatot a „Megerősítés és csatlakozás” gombbal.",
  maintenance: "Karbantartó ügynök: a csapat indítja és állítja le.",
  reviewer: "Az Író lektora: csak kikapcsolni lehet, szükség esetén az Író indítja újra.",
};

const pt: AgentsPanelText = {
  title: "Agentes",
  intro: "Os agentes da equipa {where}: o estado, o terminal e os comandos.",
  whereLocal: "neste computador",
  whereVps: "na VPS {label}",
  refresh: "Atualizar",
  refreshing: "A atualizar…",
  reading: "A ler os agentes…",
  readAt: "Lido às {time}",
  failed: "Não consegui ler os agentes.",
  failedAt: "Tentativa das {time}",
  summary: "{waiting} à tua espera · {working} a trabalhar · {up} ativos de {total}",
  up: "ativo",
  down: "desligado",
  heldByUser: "desligado por ti",
  heldBySafety: "posto em segurança pela equipa",
  noneUp: "nenhuma sessão ativa",
  started: "iniciado {time}",
  activity: "última atividade {time}",
  screenMoving: "o terminal mudou há {seconds} s",
  statesUnknown:
    "A equipa ainda não publica o estado dos agentes: aparecerá depois de uma atualização da equipa. Até lá, o estado é «desconhecido».",
  tabTerminal: "Terminal",
  tabChat: "Chat",
  chatSoon: "O chat com {name} chega com a próxima atualização da app.",
  screenReading: "A ler o terminal…",
  screenAt: "Últimas linhas, lidas às {time}. Atualizam-se sozinhas enquanto o terminal estiver aberto.",
  screenDown: "A sessão não está ativa.",
  screenEmpty: "O terminal está vazio.",
  start: "Ligar",
  stop: "Desligar",
  restart: "Reiniciar",
  confirmStart: "Ligar {name} {where}?",
  confirmStop: "Desligar {name} {where}?",
  confirmRestart: "Reiniciar {name} {where}?",
  bodyStart: "{name} arranca e começa a trabalhar.",
  bodyStop: "{name} desliga-se e fica desligado até o voltares a ligar daqui: a equipa não o liga sozinha.",
  bodyStopCaptain:
    "Com o Capitão para a coordenação: os outros agentes terminam o que estão a fazer, mas não recebem novas tarefas.",
  bodyStopAssistant: "Com o Assistente para também o chat contigo.",
  bodyRestart: "{name} fecha-se e volta a arrancar: perde a conversa em curso, não o trabalho já guardado.",
  confirm: "Confirmar",
  cancel: "Cancelar",
  working: "Em curso…",
  resultStarted: "{name} está ligado.",
  resultAlreadyRunning: "{name} já estava ligado.",
  resultStopped: "{name} está desligado e fica desligado até o voltares a ligar.",
  resultAlreadyStopped: "{name} já estava desligado: agora fica desligado até o voltares a ligar.",
  resultRestarted: "{name} voltou a arrancar.",
  resultPaused: "A equipa está em pausa.",
  resultAlreadyPaused: "A equipa já estava em pausa.",
  resultResumed: "A equipa voltou ao trabalho.",
  resultNotPaused: "A equipa não estava em pausa.",
  teamActive: "Equipa ativa",
  teamPausedUntil: "Equipa em pausa até às {time}",
  teamPausedWeekly: "Equipa em pausa até à reposição do limite semanal",
  teamPauseEnding: "A pausa terminou: a equipa está a acordar",
  teamHalted: "Equipa parada por ti: não volta a arrancar sozinha.",
  pause: "Pausa",
  resume: "Retomar",
  confirmPause: "Pôr em pausa a equipa {where}?",
  bodyPause:
    "Os agentes terminam o que estão a fazer e param sem consumir. A equipa retoma sozinha no fim do prazo, ou quando a retomares daqui.",
  pauseHours1: "Durante 1 hora",
  pauseHours4: "Durante 4 horas",
  pauseTomorrow: "Até amanhã às 8",
  pauseWeekly: "Até à reposição do limite semanal",
  confirmResume: "Retomar a equipa {where}?",
  bodyResume: "Os agentes retomam o trabalho onde o tinham deixado.",
  readOnly:
    "Só leitura: para ligar, desligar ou pôr em pausa os agentes, liga a equipa com «Confirmar e ligar».",
  maintenance: "Agente de manutenção: é a equipa que o arranca e o para.",
  reviewer: "Revisor do Escritor: só pode ser desligado, o Escritor volta a arrancá-lo quando for preciso.",
};

export const AGENTS_PANEL_TEXT: Record<Locale, AgentsPanelText> = { it, en, de, es, fr, hu, pt };
