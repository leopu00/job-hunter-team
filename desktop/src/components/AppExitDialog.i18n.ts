import type { Locale } from "@/i18n/config";

export interface AppExitText {
  /** The navbar button that asks how to leave. Not «Sign out»: that one leaves the account, this one the app. */
  menu: string;
  title: string;
  /** What closing the window does not do: the team lives in the container, not in the window. */
  body: string;
  ordered: string;
  orderedHint: string;
  forced: string;
  forcedHint: string;
  detach: string;
  detachHint: string;
  remember: string;
  /** Stays in the app. */
  stay: string;
  /** While the agents write down where they were: `{count}` sessions are still open. */
  waiting: string;
  /** While the container and the machine stop. */
  stopping: string;
  /** The agents take longer than expected. */
  slow: string;
  forceNow: string;
  /** A step failed and the app stayed open. */
  failed: string;
  /** The state of the machine could not be read: it is not said to be off, and nothing of it was stopped. */
  machineUnknown: string;
  /** Containers that are not the team's run on its machine (`{count}`): stopping the team leaves the machine on for them. */
  othersKept: string;
}

export const APP_EXIT_TEXT: Record<Locale, AppExitText> = {
  it: {
    menu: "Esci da Job Hunter Team",
    title: "Chiudere l’app?",
    body: "La squadra non vive nella finestra: lavora in un container sul tuo computer, e chiudere la finestra non la ferma. Continua a lavorare e a consumare.",
    ordered: "Fermali in ordine",
    orderedHint: "Ogni agente annota a che punto era, poi la squadra e il motore si fermano. Domani il lavoro riprende da lì.",
    forced: "Ferma subito",
    forcedHint: "La squadra e il motore si fermano ora, senza aspettare gli agenti: il lavoro in corso può andare perso.",
    detach: "Lascia lavorare",
    detachHint: "Si chiude solo la finestra. La squadra continua.",
    remember: "Ricorda la scelta",
    stay: "Resta nell’app",
    waiting: "Aspetto che gli agenti finiscano. Sessioni ancora aperte: {count}.",
    stopping: "Fermo la squadra e il motore…",
    slow: "Gli agenti ci mettono più del previsto.",
    forceNow: "Forza lo stop",
    failed: "Non sono riuscito a fermare tutto, e l’app resta aperta. Puoi riprovare, forzare lo stop o lasciare la squadra al lavoro.",
    othersKept: "Sullo stesso motore girano anche {count} container che non sono di Job Hunter Team: se fermi la squadra, il motore resta acceso per loro.",
    machineUnknown: "Lo stato della macchina è sconosciuto: non riesco a leggere se è accesa, quindi non ho fermato niente e l’app resta aperta. Puoi riprovare o lasciare la squadra al lavoro.",
  },
  en: {
    menu: "Quit Job Hunter Team",
    title: "Close the app?",
    body: "The team does not live in the window: it works in a container on your computer, and closing the window does not stop it. It keeps working and spending.",
    ordered: "Stop them in order",
    orderedHint: "Each agent notes where it had got to, then the team and the engine stop. Tomorrow the work picks up from there.",
    forced: "Stop now",
    forcedHint: "The team and the engine stop right away, without waiting for the agents: work in progress may be lost.",
    detach: "Leave them working",
    detachHint: "Only the window closes. The team goes on.",
    remember: "Remember my choice",
    stay: "Stay in the app",
    waiting: "Waiting for the agents to finish. Sessions still open: {count}.",
    stopping: "Stopping the team and the engine…",
    slow: "The agents are taking longer than expected.",
    forceNow: "Force the stop",
    failed: "I could not stop everything, and the app stays open. You can try again, force the stop or leave the team working.",
    othersKept: "{count} other container(s) that are not Job Hunter Team’s run on the same engine: if you stop the team, the engine stays on for them.",
    machineUnknown: "The state of the machine is unknown: I cannot read whether it is on, so I stopped nothing and the app stays open. You can try again or leave the team working.",
  },
  hu: {
    menu: "Kilépés a Job Hunter Teamből",
    title: "Bezárod az alkalmazást?",
    body: "A csapat nem az ablakban él: egy konténerben dolgozik a számítógépeden, és az ablak bezárása nem állítja le. Tovább dolgozik és költ.",
    ordered: "Rendezett leállítás",
    orderedHint: "Minden ügynök feljegyzi, hol tartott, majd a csapat és a konténermotor leáll. Holnap onnan folytatódik a munka.",
    forced: "Azonnali leállítás",
    forcedHint: "A csapat és a konténermotor azonnal leáll, nem várunk az ügynökökre: a folyamatban lévő munka elveszhet.",
    detach: "Dolgozzanak tovább",
    detachHint: "Csak az ablak záródik be. A csapat folytatja.",
    remember: "Választás megjegyzése",
    stay: "Maradok az alkalmazásban",
    waiting: "Várom, hogy az ügynökök befejezzék. Még nyitott munkamenetek: {count}.",
    stopping: "Leállítom a csapatot és a konténermotort…",
    slow: "Az ügynököknek a vártnál tovább tart.",
    forceNow: "Kényszerített leállítás",
    failed: "Nem sikerült mindent leállítani, az alkalmazás nyitva marad. Próbálhatod újra, erőltetheted a leállítást, vagy hagyhatod dolgozni a csapatot.",
    othersKept: "Ugyanezen a motoron {count} nem a Job Hunter Team-hez tartozó konténer is fut: ha leállítod a csapatot, a motor értük bekapcsolva marad.",
    machineUnknown: "A gép állapota ismeretlen: nem tudom kiolvasni, hogy be van-e kapcsolva, ezért nem állítottam le semmit, és az alkalmazás nyitva marad. Próbálhatod újra, vagy hagyhatod dolgozni a csapatot.",
  },
  es: {
    menu: "Salir de Job Hunter Team",
    title: "¿Cerrar la app?",
    body: "El equipo no vive en la ventana: trabaja en un contenedor de tu ordenador, y cerrar la ventana no lo detiene. Sigue trabajando y gastando.",
    ordered: "Detenerlos en orden",
    orderedHint: "Cada agente anota en qué punto estaba, y luego se detienen el equipo y el motor. Mañana el trabajo sigue desde ahí.",
    forced: "Detener ya",
    forcedHint: "El equipo y el motor se detienen ahora, sin esperar a los agentes: el trabajo en curso puede perderse.",
    detach: "Dejarlos trabajando",
    detachHint: "Solo se cierra la ventana. El equipo sigue.",
    remember: "Recordar la elección",
    stay: "Quedarme en la app",
    waiting: "Espero a que los agentes terminen. Sesiones aún abiertas: {count}.",
    stopping: "Detengo el equipo y el motor…",
    slow: "Los agentes tardan más de lo previsto.",
    forceNow: "Forzar la parada",
    failed: "No he podido detenerlo todo, y la app sigue abierta. Puedes reintentar, forzar la parada o dejar el equipo trabajando.",
    othersKept: "En el mismo motor se ejecutan también {count} contenedor(es) que no son de Job Hunter Team: si detienes el equipo, el motor sigue encendido para ellos.",
    machineUnknown: "El estado de la máquina es desconocido: no puedo leer si está encendida, así que no he detenido nada y la app sigue abierta. Puedes reintentar o dejar el equipo trabajando.",
  },
  de: {
    menu: "Job Hunter Team beenden",
    title: "App schließen?",
    body: "Das Team lebt nicht im Fenster: Es arbeitet in einem Container auf deinem Computer, und das Schließen des Fensters hält es nicht an. Es arbeitet weiter und verbraucht weiter.",
    ordered: "Der Reihe nach anhalten",
    orderedHint: "Jeder Agent notiert, wo er stand, dann halten das Team und die Container-Engine an. Morgen geht die Arbeit dort weiter.",
    forced: "Sofort anhalten",
    forcedHint: "Das Team und die Container-Engine halten sofort an, ohne auf die Agenten zu warten: Laufende Arbeit kann verloren gehen.",
    detach: "Weiterarbeiten lassen",
    detachHint: "Nur das Fenster wird geschlossen. Das Team macht weiter.",
    remember: "Auswahl merken",
    stay: "In der App bleiben",
    waiting: "Ich warte, bis die Agenten fertig sind. Noch offene Sitzungen: {count}.",
    stopping: "Ich halte das Team und die Container-Engine an…",
    slow: "Die Agenten brauchen länger als erwartet.",
    forceNow: "Anhalten erzwingen",
    failed: "Ich konnte nicht alles anhalten, und die App bleibt offen. Du kannst es erneut versuchen, das Anhalten erzwingen oder das Team weiterarbeiten lassen.",
    othersKept: "Auf demselben Motor laufen auch {count} Container, die nicht zu Job Hunter Team gehören: Wenn du das Team anhältst, bleibt der Motor für sie an.",
    machineUnknown: "Der Zustand der Maschine ist unbekannt: Ich kann nicht lesen, ob sie an ist, deshalb habe ich nichts angehalten, und die App bleibt offen. Du kannst es erneut versuchen oder das Team weiterarbeiten lassen.",
  },
  fr: {
    menu: "Quitter Job Hunter Team",
    title: "Fermer l’app ?",
    body: "L’équipe ne vit pas dans la fenêtre : elle travaille dans un conteneur sur ton ordinateur, et fermer la fenêtre ne l’arrête pas. Elle continue de travailler et de consommer.",
    ordered: "Les arrêter dans l’ordre",
    orderedHint: "Chaque agent note où il en était, puis l’équipe et le moteur s’arrêtent. Demain le travail reprend de là.",
    forced: "Arrêter tout de suite",
    forcedHint: "L’équipe et le moteur s’arrêtent maintenant, sans attendre les agents : le travail en cours peut être perdu.",
    detach: "Les laisser travailler",
    detachHint: "Seule la fenêtre se ferme. L’équipe continue.",
    remember: "Mémoriser le choix",
    stay: "Rester dans l’app",
    waiting: "J’attends que les agents terminent. Sessions encore ouvertes : {count}.",
    stopping: "J’arrête l’équipe et le moteur…",
    slow: "Les agents mettent plus de temps que prévu.",
    forceNow: "Forcer l’arrêt",
    failed: "Je n’ai pas pu tout arrêter, et l’app reste ouverte. Tu peux réessayer, forcer l’arrêt ou laisser l’équipe travailler.",
    othersKept: "{count} autre(s) conteneur(s) qui ne sont pas ceux de Job Hunter Team tournent sur le même moteur : si tu arrêtes l’équipe, le moteur reste allumé pour eux.",
    machineUnknown: "L’état de la machine est inconnu : je ne peux pas lire si elle est allumée, donc je n’ai rien arrêté et l’app reste ouverte. Tu peux réessayer ou laisser l’équipe travailler.",
  },
  pt: {
    menu: "Sair de Job Hunter Team",
    title: "Fechar a app?",
    body: "A equipa não vive na janela: trabalha num contentor no teu computador, e fechar a janela não a pára. Continua a trabalhar e a gastar.",
    ordered: "Pará-los por ordem",
    orderedHint: "Cada agente anota em que ponto estava, e depois a equipa e o motor param. Amanhã o trabalho continua daí.",
    forced: "Parar já",
    forcedHint: "A equipa e o motor param agora, sem esperar pelos agentes: o trabalho em curso pode perder-se.",
    detach: "Deixá-los a trabalhar",
    detachHint: "Só a janela se fecha. A equipa continua.",
    remember: "Lembrar a escolha",
    stay: "Ficar na app",
    waiting: "Espero que os agentes terminem. Sessões ainda abertas: {count}.",
    stopping: "A parar a equipa e o motor…",
    slow: "Os agentes demoram mais do que o previsto.",
    forceNow: "Forçar a paragem",
    failed: "Não consegui parar tudo, e a app fica aberta. Podes tentar de novo, forçar a paragem ou deixar a equipa a trabalhar.",
    othersKept: "No mesmo motor correm também {count} contentor(es) que não são do Job Hunter Team: se paras a equipa, o motor fica ligado para eles.",
    machineUnknown: "O estado da máquina é desconhecido: não consigo ler se está ligada, por isso não parei nada e a app fica aberta. Podes tentar de novo ou deixar a equipa a trabalhar.",
  },
};
