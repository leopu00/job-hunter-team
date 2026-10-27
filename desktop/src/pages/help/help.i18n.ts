import type { Locale } from "@/i18n/config";

/**
 * The «Guide» page: what the app does today, for a team that runs on this
 * computer or on a VPS. It says only what the app really has (the pages it
 * lists are the ones of READ_ONLY_ROUTES) and promises nothing else. The page
 * names are not written here: the page takes them from the navigation's own
 * dictionaries so the guide never names a page differently from the bar.
 * {refresh} and {back} are the labels of the navbar's buttons. 7 languages;
 * Italian is the source and its shape is the type.
 */
const it = {
  navLabel: "Guida",
  title: "Guida",
  intro: "Come seguire la tua squadra da questa app. Qui trovi solo ciò che l’app fa oggi, per una squadra che gira su questo computer o su una VPS.",
  whatTitle: "A cosa serve",
  what: "L’app mostra il lavoro della tua squadra: le posizioni trovate e valutate, il tuo profilo e lo stato dei suoi agenti. I dati restano dove gira la squadra, sul tuo computer o su una VPS.",
  pagesTitle: "Le pagine",
  pages: {
    dashboard: "I numeri della squadra: le posizioni per stato, come sono distribuiti i punteggi, le fonti e le posizioni valutate più di recente.",
    map: "Dove si trovano le posizioni.",
    positions: "L’elenco delle posizioni, con ricerca, filtri e ordinamento. Aprine una per vederla nel dettaglio.",
    team: "Lo stato che la squadra riporta di sé. Da qui si può avviare l’assistente, dopo una conferma.",
    profile: "Il profilo del candidato che la squadra conserva.",
    office: "L’ufficio, disegnato con ciò che la squadra riporta di sé.",
    agents: "Le sessioni degli agenti. Su questo computer hai anche i comandi (pausa, stop); una squadra su una VPS si apre in sola lettura finché non la colleghi con «Collega in scrittura».",
    settings: "La lingua dell’app e la valuta in cui vedi gli stipendi. Restano su questo computer.",
  },
  readOnlyTitle: "Sola lettura",
  readOnly: [
    "Una squadra su una VPS si apre in sola lettura finché non la colleghi con «Collega in scrittura»: puoi guardare posizioni, profilo e stato, ma non cambiarli. Ciò che modificherebbe qualcosa non c’è, oppure resta disattivato e dice perché.",
    "Avviare l’assistente è separato e chiede sempre una conferma.",
  ],
  troubleTitle: "Se una pagina non si carica",
  trouble: "Una pagina che non si riesce a leggere lo dice. Controlla che il computer o la VPS della squadra sia acceso e connesso, poi premi «{refresh}». «{back}» ti riporta alla configurazione.",
};

export type HelpText = typeof it;

export const HELP_TEXT: Record<Locale, HelpText> = {
  it,
  en: {
    navLabel: "Help",
    title: "Help",
    intro: "How to follow your team from this app. This guide covers only what the app does today, for a team that runs on this computer or on a VPS.",
    whatTitle: "What it is for",
    what: "The app shows your team’s work: the positions it found and scored, your profile and the state of its agents. The data stays where the team runs, on your computer or on a VPS.",
    pagesTitle: "The pages",
    pages: {
      dashboard: "The team’s numbers: positions by status, how the scores are spread, the sources and the most recently scored positions.",
      map: "Where the positions are.",
      positions: "The list of positions, with search, filters and sorting. Open one to see it in detail.",
      team: "The state the team reports about itself. The assistant can be started from here, after a confirmation.",
      profile: "The candidate profile the team holds.",
      office: "The office, drawn from what the team reports about itself.",
      agents: "The agent sessions. On this computer you also get the controls (pause, stop); a team on a VPS opens read only until you connect it with “Connect with write access”.",
      settings: "The app’s language and the currency salaries are shown in. They stay on this computer.",
    },
    readOnlyTitle: "Read only",
    readOnly: [
      "A team on a VPS opens read only until you connect it with “Connect with write access”: you can look at positions, profile and state, but not change them. What would change something is not there, or stays disabled and says why.",
      "Starting the assistant is separate and always asks for a confirmation.",
    ],
    troubleTitle: "If a page does not load",
    trouble: "A page that cannot be read says so. Check that the team’s computer or VPS is on and connected, then press “{refresh}”. “{back}” takes you back to the setup.",
  },
  de: {
    navLabel: "Hilfe",
    title: "Hilfe",
    intro: "So verfolgst du dein Team in dieser App. Diese Anleitung beschreibt nur, was die App heute kann – für ein Team, das auf diesem Computer oder auf einer VPS läuft.",
    whatTitle: "Wozu die App dient",
    what: "Die App zeigt die Arbeit deines Teams: die gefundenen und bewerteten Stellen, dein Profil und den Zustand seiner Agenten. Die Daten bleiben dort, wo das Team läuft, auf deinem Computer oder auf einer VPS.",
    pagesTitle: "Die Seiten",
    pages: {
      dashboard: "Die Zahlen des Teams: Stellen nach Status, die Verteilung der Bewertungen, die Quellen und die zuletzt bewerteten Stellen.",
      map: "Wo die Stellen liegen.",
      positions: "Die Liste der Stellen mit Suche, Filtern und Sortierung. Öffne eine, um sie im Detail zu sehen.",
      team: "Der Zustand, den das Team über sich meldet. Von hier aus lässt sich der Assistent nach einer Bestätigung starten.",
      profile: "Das Kandidatenprofil, das das Team aufbewahrt.",
      office: "Das Büro, gezeichnet aus dem, was das Team über sich meldet.",
      agents: "Die Agenten-Sitzungen. Auf diesem Computer hast du auch die Steuerung (Pause, Stopp); ein Team auf einer VPS öffnet sich nur lesend, bis du es mit „Mit Schreibzugriff verbinden“ verbindest.",
      settings: "Die Sprache der App und die Währung, in der Gehälter angezeigt werden. Beides bleibt auf diesem Computer.",
    },
    readOnlyTitle: "Nur lesen",
    readOnly: [
      "Ein Team auf einer VPS öffnet sich nur lesend, bis du es mit „Mit Schreibzugriff verbinden“ verbindest: Du kannst Stellen, Profil und Zustand ansehen, aber nicht ändern. Was etwas ändern würde, gibt es nicht, oder es bleibt deaktiviert und nennt den Grund.",
      "Das Starten des Assistenten ist davon getrennt und verlangt immer eine Bestätigung.",
    ],
    troubleTitle: "Wenn eine Seite nicht lädt",
    trouble: "Eine Seite, die sich nicht lesen lässt, sagt es. Prüfe, ob der Computer oder die VPS des Teams eingeschaltet und verbunden ist, und drücke dann „{refresh}“. „{back}“ bringt dich zurück zur Einrichtung.",
  },
  fr: {
    navLabel: "Aide",
    title: "Aide",
    intro: "Comment suivre ton équipe depuis cette app. Ce guide ne couvre que ce que l’app fait aujourd’hui, pour une équipe qui tourne sur cet ordinateur ou sur un VPS.",
    whatTitle: "À quoi elle sert",
    what: "L’app montre le travail de ton équipe : les postes trouvés et évalués, ton profil et l’état de ses agents. Les données restent là où tourne l’équipe, sur ton ordinateur ou sur un VPS.",
    pagesTitle: "Les pages",
    pages: {
      dashboard: "Les chiffres de l’équipe : les postes par statut, la répartition des scores, les sources et les postes évalués le plus récemment.",
      map: "Où se trouvent les postes.",
      positions: "La liste des postes, avec recherche, filtres et tri. Ouvres-en un pour le voir en détail.",
      team: "L’état que l’équipe rapporte sur elle-même. L’assistant peut être démarré d’ici, après une confirmation.",
      profile: "Le profil du candidat que l’équipe conserve.",
      office: "Le bureau, dessiné à partir de ce que l’équipe rapporte sur elle-même.",
      agents: "Les sessions des agents. Sur cet ordinateur, tu as aussi les commandes (pause, arrêt) ; une équipe sur un VPS s’ouvre en lecture seule tant que tu ne la relies pas avec « Connecter en écriture ».",
      settings: "La langue de l’app et la devise dans laquelle les salaires s’affichent. Elles restent sur cet ordinateur.",
    },
    readOnlyTitle: "Lecture seule",
    readOnly: [
      "Une équipe sur un VPS s’ouvre en lecture seule tant que tu ne la relies pas avec « Connecter en écriture » : tu peux consulter les postes, le profil et l’état, mais pas les changer. Ce qui modifierait quelque chose n’y est pas, ou reste désactivé et en donne la raison.",
      "Démarrer l’assistant est distinct et demande toujours une confirmation.",
    ],
    troubleTitle: "Si une page ne se charge pas",
    trouble: "Une page qui ne peut pas être lue le dit. Vérifie que l’ordinateur ou le VPS de l’équipe est allumé et connecté, puis appuie sur « {refresh} ». « {back} » te ramène à la configuration.",
  },
  es: {
    navLabel: "Ayuda",
    title: "Ayuda",
    intro: "Cómo seguir a tu equipo desde esta app. Esta guía cubre solo lo que la app hace hoy, para un equipo que funciona en este ordenador o en un VPS.",
    whatTitle: "Para qué sirve",
    what: "La app muestra el trabajo de tu equipo: las posiciones que encontró y valoró, tu perfil y el estado de sus agentes. Los datos se quedan donde funciona el equipo, en tu ordenador o en un VPS.",
    pagesTitle: "Las páginas",
    pages: {
      dashboard: "Los números del equipo: posiciones por estado, cómo se reparten las puntuaciones, las fuentes y las posiciones valoradas más recientemente.",
      map: "Dónde están las posiciones.",
      positions: "La lista de posiciones, con búsqueda, filtros y orden. Abre una para verla en detalle.",
      team: "El estado que el equipo informa de sí mismo. Desde aquí se puede iniciar el asistente, tras una confirmación.",
      profile: "El perfil del candidato que guarda el equipo.",
      office: "La oficina, dibujada con lo que el equipo informa de sí mismo.",
      agents: "Las sesiones de los agentes. En este ordenador tienes también los controles (pausa, parada); un equipo en un VPS se abre en solo lectura hasta que lo conectes con «Conectar con escritura».",
      settings: "El idioma de la app y la moneda en la que se muestran los salarios. Se quedan en este ordenador.",
    },
    readOnlyTitle: "Solo lectura",
    readOnly: [
      "Un equipo en un VPS se abre en solo lectura hasta que lo conectes con «Conectar con escritura»: puedes mirar posiciones, perfil y estado, pero no modificarlos. Lo que cambiaría algo no está, o sigue desactivado y dice por qué.",
      "Iniciar el asistente es aparte y siempre pide una confirmación.",
    ],
    troubleTitle: "Si una página no carga",
    trouble: "Una página que no se puede leer lo dice. Comprueba que el ordenador o el VPS del equipo esté encendido y conectado, y pulsa «{refresh}». «{back}» te devuelve a la configuración.",
  },
  pt: {
    navLabel: "Ajuda",
    title: "Ajuda",
    intro: "Como acompanhar a tua equipa a partir desta app. Este guia cobre só o que a app faz hoje, para uma equipa que corre neste computador ou numa VPS.",
    whatTitle: "Para que serve",
    what: "A app mostra o trabalho da tua equipa: as vagas que encontrou e avaliou, o teu perfil e o estado dos seus agentes. Os dados ficam onde a equipa corre, no teu computador ou numa VPS.",
    pagesTitle: "As páginas",
    pages: {
      dashboard: "Os números da equipa: vagas por estado, como se distribuem as pontuações, as fontes e as vagas avaliadas mais recentemente.",
      map: "Onde estão as vagas.",
      positions: "A lista de vagas, com pesquisa, filtros e ordenação. Abre uma para a ver em detalhe.",
      team: "O estado que a equipa reporta sobre si própria. A partir daqui pode iniciar-se o assistente, depois de uma confirmação.",
      profile: "O perfil do candidato que a equipa guarda.",
      office: "O escritório, desenhado com o que a equipa reporta sobre si própria.",
      agents: "As sessões dos agentes. Neste computador tens também os comandos (pausa, paragem); uma equipa numa VPS abre-se só para leitura até a ligares com «Ligar com escrita».",
      settings: "O idioma da app e a moeda em que os salários são mostrados. Ficam neste computador.",
    },
    readOnlyTitle: "Só leitura",
    readOnly: [
      "Uma equipa numa VPS abre-se só para leitura até a ligares com «Ligar com escrita»: podes ver vagas, perfil e estado, mas não os mudar. O que alteraria algo não existe, ou fica desativado e diz porquê.",
      "Iniciar o assistente é à parte e pede sempre uma confirmação.",
    ],
    troubleTitle: "Se uma página não carrega",
    trouble: "Uma página que não se consegue ler di-lo. Verifica se o computador ou a VPS da equipa está ligado e com ligação, e carrega em «{refresh}». «{back}» leva-te de volta à configuração.",
  },
  hu: {
    navLabel: "Súgó",
    title: "Súgó",
    intro: "Így követheted a csapatodat ebből az appból. Ez az útmutató csak azt írja le, amit az app ma tud, olyan csapathoz, amely ezen a számítógépen vagy egy VPS-en fut.",
    whatTitle: "Mire jó",
    what: "Az app a csapatod munkáját mutatja: a megtalált és értékelt állásokat, a profilodat és az ügynökök állapotát. Az adatok ott maradnak, ahol a csapat fut: a te számítógépeden vagy egy VPS-en.",
    pagesTitle: "Az oldalak",
    pages: {
      dashboard: "A csapat számai: az állások állapot szerint, a pontszámok eloszlása, a források és a legutóbb értékelt állások.",
      map: "Hol vannak az állások.",
      positions: "Az állások listája kereséssel, szűrőkkel és rendezéssel. Nyiss meg egyet a részletekért.",
      team: "Az állapot, amelyet a csapat magáról jelent. Innen megerősítés után indítható az asszisztens.",
      profile: "A jelölt profilja, amelyet a csapat tárol.",
      office: "Az iroda, abból rajzolva, amit a csapat magáról jelent.",
      agents: "Az ügynökök munkamenetei. Ezen a számítógépen a vezérlők is megvannak (szünet, leállítás); a VPS-en futó csapat csak olvasásra nyílik meg, amíg a „Csatlakozás írási joggal” gombbal nem csatlakoztatod.",
      settings: "Az app nyelve és a fizetések megjelenítési pénzneme. Ezek ezen a számítógépen maradnak.",
    },
    readOnlyTitle: "Csak olvasható",
    readOnly: [
      "A VPS-en futó csapat csak olvasásra nyílik meg, amíg a „Csatlakozás írási joggal” gombbal nem csatlakoztatod: megnézheted az állásokat, a profilt és az állapotot, de nem változtathatod meg őket. Ami módosítana valamit, vagy nincs ott, vagy letiltva marad, és megmondja az okot.",
      "Az asszisztens indítása külön dolog, és mindig megerősítést kér.",
    ],
    troubleTitle: "Ha egy oldal nem töltődik be",
    trouble: "Az az oldal, amelyet nem sikerül beolvasni, ezt jelzi. Ellenőrizd, hogy a csapat számítógépe vagy VPS-e be van-e kapcsolva és kapcsolódik-e, majd nyomd meg a „{refresh}” gombot. A „{back}” visszavisz a beállításhoz.",
  },
};
