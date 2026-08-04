// Dizionario di `WelcomeClient.tsx`.
//
// Le chiavi sono LOCALI a questo componente: lo stesso nome può valere
// tutt'altro altrove, quindi non vanno accorpate in un dizionario comune.
// `Record<Locale, Strings>` fa pretendere al compilatore tutte e sette le
// lingue: una voce a cui ne manca una non compila, invece di mostrare
// l'inglese all'utente sbagliato.
import type { Locale } from "@/i18n/config";

export type Strings = {
  title: string;
  subtitle: string;
  q_lang: string;
  q_status: string;
  opt_none: string;
  opt_none_d: string;
  opt_downloaded: string;
  opt_downloaded_d: string;
  opt_browsing: string;
  opt_browsing_d: string;
  opt_running: string;
  opt_running_d: string;
  back: string;
  continue_demo: string;
  skip: string;
  dl_title: string;
  dl_body: string;
  dl_modes: string;
  dl_mode1: string;
  dl_mode2: string;
  dl_mode3: string;
  dl_cta: string;
  dl_note: string;
  start_title: string;
  start_body: string;
  pair_title: string;
  pair_body: string;
  pair_s1: string;
  pair_s1_cta: string;
  pair_s2: string;
  pair_s3: string;
  demo_q: string;
  demo_hint: string;
  demo_note: string;
  synced_title: string;
  synced_body: string;
  synced_cta: string;
};

export const T: Record<Locale, Strings> = {
  it: {
    title: "Benvenuto su JHT",
    subtitle:
      "Il tuo team di agenti cerca, analizza e prepara le candidature al posto tuo. Questo sito è la finestra sui dati che il team genera.",
    q_lang: "In che lingua vuoi usare la piattaforma?",
    q_status: "A che punto sei?",
    opt_none: "Non ho ancora scaricato l'app desktop",
    opt_none_d: "Ti spieghiamo come funziona e dove scaricarla",
    opt_downloaded: "Ho scaricato l'app ma non ho avviato il team",
    opt_downloaded_d: "Ti guidiamo al primo avvio",
    opt_browsing: "Sto solo dando un'occhiata",
    opt_browsing_d: "Vai dritto alla demo interattiva della piattaforma",
    opt_running: "Il mio team è già attivo",
    opt_running_d: "Collegalo al tuo account con un token",
    back: "Indietro",
    continue_demo: "Continua",
    skip: "Salta, vai alla dashboard",
    dl_title: "Prima serve l'app desktop",
    dl_body:
      "Il team di agenti gira sul TUO computer (o su un server tuo), dentro l'app desktop: è lì che nascono posizioni, analisi e CV. Senza un team al lavoro, questa dashboard resterebbe vuota.",
    dl_modes: "Dove far girare il team",
    dl_mode1: "Sul tuo Mac di tutti i giorni — parte e si ferma quando vuoi",
    dl_mode2: "Su un computer dedicato sempre acceso — il team lavora 24/7",
    dl_mode3: "Su una VPS nel cloud — nessun hardware tuo, sempre attivo",
    dl_cta: "Scarica l'app",
    dl_note:
      "Quando il team sarà attivo, torna qui: in Impostazioni → Token dispositivi generi il codice per collegarlo a questo account.",
    start_title: "Avvia il tuo team",
    start_body:
      "Apri l'app desktop e completa la configurazione guidata: profilo, preferenze e primo avvio del team. Quando il team lavora, collegalo a questo account (passi qui sotto) per vedere i dati anche dal telefono o da un altro computer.",
    pair_title: "Collega il tuo team a questo account",
    pair_body:
      "Il team continua a girare dove sta: col pairing i dati vengono sincronizzati sul cloud e questa dashboard (telefono incluso) si popola da sola.",
    pair_s1: "Genera un token dispositivo da questo account",
    pair_s1_cta: "Apri Token dispositivi",
    pair_s2:
      "Sulla macchina dove gira il team, incolla il token nella sezione Cloud dell'app (oppure lancia il comando qui sotto)",
    pair_s3:
      "Torna qui: al primo sync la dashboard mostra i dati veri del tuo team",
    demo_q: "Nel frattempo, prova la demo",
    demo_hint:
      "Di che ambito ti occupi? Ti mostriamo una dashboard di esempio già popolata: puoi filtrare, aprire le posizioni e dare giudizi.",
    demo_note:
      "Sono dati fittizi generati per la demo, chiaramente etichettati: i tuoi appariranno quando collegherai il team.",
    synced_title: "Il tuo team è già collegato",
    synced_body:
      "Questo account riceve già dati sincronizzati: la dashboard mostra il lavoro del tuo team.",
    synced_cta: "Vai alla dashboard",
  },
  en: {
    title: "Welcome to JHT",
    subtitle:
      "Your team of agents searches, analyses and prepares applications for you. This site is the window on the data the team generates.",
    q_lang: "Which language do you want to use the platform in?",
    q_status: "Where are you at?",
    opt_none: "I haven't downloaded the desktop app yet",
    opt_none_d: "We'll explain how it works and where to get it",
    opt_downloaded: "I downloaded the app but haven't started the team",
    opt_downloaded_d: "We'll guide you through the first run",
    opt_browsing: "I'm just looking around",
    opt_browsing_d: "Jump straight to the interactive demo of the platform",
    opt_running: "My team is already running",
    opt_running_d: "Link it to your account with a token",
    back: "Back",
    continue_demo: "Continue",
    skip: "Skip, go to the dashboard",
    dl_title: "First you need the desktop app",
    dl_body:
      "The agent team runs on YOUR computer (or your own server), inside the desktop app: that's where positions, analyses and CVs are produced. Without a team at work, this dashboard would stay empty.",
    dl_modes: "Where to run the team",
    dl_mode1: "On your everyday Mac — start and stop it whenever you want",
    dl_mode2: "On a dedicated always-on computer — the team works 24/7",
    dl_mode3: "On a cloud VPS — no hardware of yours, always on",
    dl_cta: "Download the app",
    dl_note:
      "Once the team is running, come back here: in Settings → Device tokens you generate the code to link it to this account.",
    start_title: "Start your team",
    start_body:
      "Open the desktop app and complete the guided setup: profile, preferences and the team's first run. Once the team is working, link it to this account (steps below) to see the data from your phone or another computer too.",
    pair_title: "Link your team to this account",
    pair_body:
      "The team keeps running where it is: pairing syncs the data to the cloud and this dashboard (phone included) fills up by itself.",
    pair_s1: "Generate a device token from this account",
    pair_s1_cta: "Open Device tokens",
    pair_s2:
      "On the machine running the team, paste the token in the app's Cloud section (or run the command below)",
    pair_s3:
      "Come back here: at the first sync the dashboard shows your team's real data",
    demo_q: "Meanwhile, try the demo",
    demo_hint:
      "What field do you work in? We'll show you a pre-populated sample dashboard: you can filter, open positions and give feedback.",
    demo_note:
      "It's fictional data generated for the demo, clearly labelled: yours will appear once you connect the team.",
    synced_title: "Your team is already connected",
    synced_body:
      "This account already receives synced data: the dashboard shows your team's work.",
    synced_cta: "Go to the dashboard",
  },
  es: {
    title: "Bienvenido a JHT",
    subtitle:
      "Tu equipo de agentes busca, analiza y prepara candidaturas por ti. Este sitio es la ventana a los datos que genera el equipo.",
    q_lang: "¿En qué idioma quieres usar la plataforma?",
    q_status: "¿En qué punto estás?",
    opt_none: "Aún no he descargado la app de escritorio",
    opt_none_d: "Te explicamos cómo funciona y dónde conseguirla",
    opt_downloaded: "Descargué la app pero no he iniciado el equipo",
    opt_downloaded_d: "Te guiamos en el primer arranque",
    opt_browsing: "Solo estoy echando un vistazo",
    opt_browsing_d: "Ve directo a la demo interactiva de la plataforma",
    opt_running: "Mi equipo ya está activo",
    opt_running_d: "Vincúlalo a tu cuenta con un token",
    back: "Atrás",
    continue_demo: "Continuar",
    skip: "Saltar, ir al dashboard",
    dl_title: "Primero necesitas la app de escritorio",
    dl_body:
      "El equipo de agentes se ejecuta en TU ordenador (o en un servidor tuyo), dentro de la app de escritorio: ahí nacen posiciones, análisis y CV. Sin un equipo trabajando, este dashboard quedaría vacío.",
    dl_modes: "Dónde ejecutar el equipo",
    dl_mode1: "En tu Mac de siempre — arranca y para cuando quieras",
    dl_mode2: "En un ordenador dedicado siempre encendido — trabaja 24/7",
    dl_mode3: "En una VPS en la nube — sin hardware tuyo, siempre activo",
    dl_cta: "Descargar la app",
    dl_note:
      "Cuando el equipo esté activo, vuelve aquí: en Ajustes → Tokens de dispositivo generas el código para vincularlo a esta cuenta.",
    start_title: "Inicia tu equipo",
    start_body:
      "Abre la app de escritorio y completa la configuración guiada: perfil, preferencias y primer arranque del equipo. Cuando el equipo trabaje, vincúlalo a esta cuenta (pasos abajo) para ver los datos también desde el móvil u otro ordenador.",
    pair_title: "Vincula tu equipo a esta cuenta",
    pair_body:
      "El equipo sigue ejecutándose donde está: con el pairing los datos se sincronizan en la nube y este dashboard (móvil incluido) se llena solo.",
    pair_s1: "Genera un token de dispositivo desde esta cuenta",
    pair_s1_cta: "Abrir Tokens de dispositivo",
    pair_s2:
      "En la máquina donde corre el equipo, pega el token en la sección Cloud de la app (o ejecuta el comando de abajo)",
    pair_s3:
      "Vuelve aquí: en la primera sincronización el dashboard muestra los datos reales de tu equipo",
    demo_q: "Mientras tanto, prueba la demo",
    demo_hint:
      "¿A qué te dedicas? Te mostramos un dashboard de ejemplo ya poblado: puedes filtrar, abrir posiciones y dar tu opinión.",
    demo_note:
      "Son datos ficticios generados para la demo, claramente etiquetados: los tuyos aparecerán cuando conectes el equipo.",
    synced_title: "Tu equipo ya está conectado",
    synced_body:
      "Esta cuenta ya recibe datos sincronizados: el dashboard muestra el trabajo de tu equipo.",
    synced_cta: "Ir al dashboard",
  },
  fr: {
    title: "Bienvenue sur JHT",
    subtitle:
      "Votre équipe d'agents cherche, analyse et prépare les candidatures à votre place. Ce site est la fenêtre sur les données que l'équipe génère.",
    q_lang: "Dans quelle langue veux-tu utiliser la plateforme ?",
    q_status: "Où en êtes-vous ?",
    opt_none: "Je n'ai pas encore téléchargé l'app desktop",
    opt_none_d: "On vous explique comment ça marche et où la télécharger",
    opt_downloaded: "J'ai téléchargé l'app mais pas démarré l'équipe",
    opt_downloaded_d: "On vous guide pour le premier démarrage",
    opt_browsing: "Je jette juste un coup d'œil",
    opt_browsing_d: "Passez directement à la démo interactive de la plateforme",
    opt_running: "Mon équipe tourne déjà",
    opt_running_d: "Reliez-la à votre compte avec un token",
    back: "Retour",
    continue_demo: "Continuer",
    skip: "Passer, aller au dashboard",
    dl_title: "Il faut d'abord l'app desktop",
    dl_body:
      "L'équipe d'agents tourne sur VOTRE ordinateur (ou votre serveur), dans l'app desktop : c'est là que naissent postes, analyses et CV. Sans équipe au travail, ce dashboard resterait vide.",
    dl_modes: "Où faire tourner l'équipe",
    dl_mode1: "Sur votre Mac de tous les jours — démarrez et arrêtez à volonté",
    dl_mode2: "Sur un ordinateur dédié toujours allumé — l'équipe bosse 24/7",
    dl_mode3:
      "Sur un VPS dans le cloud — aucun matériel à vous, toujours actif",
    dl_cta: "Télécharger l'app",
    dl_note:
      "Quand l'équipe sera active, revenez ici : dans Paramètres → Tokens d'appareil vous générez le code pour la relier à ce compte.",
    start_title: "Démarrez votre équipe",
    start_body:
      "Ouvrez l'app desktop et terminez la configuration guidée : profil, préférences et premier démarrage de l'équipe. Quand l'équipe travaille, reliez-la à ce compte (étapes ci-dessous) pour voir les données depuis votre téléphone ou un autre ordinateur.",
    pair_title: "Reliez votre équipe à ce compte",
    pair_body:
      "L'équipe continue de tourner là où elle est : le pairing synchronise les données dans le cloud et ce dashboard (téléphone inclus) se remplit tout seul.",
    pair_s1: "Générez un token d'appareil depuis ce compte",
    pair_s1_cta: "Ouvrir Tokens d'appareil",
    pair_s2:
      "Sur la machine où tourne l'équipe, collez le token dans la section Cloud de l'app (ou lancez la commande ci-dessous)",
    pair_s3:
      "Revenez ici : à la première synchro le dashboard affiche les vraies données de votre équipe",
    demo_q: "En attendant, essayez la démo",
    demo_hint:
      "Dans quel domaine travaillez-vous ? On vous montre un dashboard d'exemple déjà rempli : filtrez, ouvrez les postes, donnez votre avis.",
    demo_note:
      "Ce sont des données fictives générées pour la démo, clairement étiquetées : les vôtres apparaîtront quand vous connecterez l'équipe.",
    synced_title: "Votre équipe est déjà connectée",
    synced_body:
      "Ce compte reçoit déjà des données synchronisées : le dashboard montre le travail de votre équipe.",
    synced_cta: "Aller au dashboard",
  },
  de: {
    title: "Willkommen bei JHT",
    subtitle:
      "Dein Agenten-Team sucht, analysiert und bereitet Bewerbungen für dich vor. Diese Seite ist das Fenster auf die Daten, die das Team erzeugt.",
    q_lang: "In welcher Sprache möchtest du die Plattform nutzen?",
    q_status: "Wo stehst du?",
    opt_none: "Ich habe die Desktop-App noch nicht heruntergeladen",
    opt_none_d: "Wir erklären, wie es funktioniert und wo du sie bekommst",
    opt_downloaded: "App heruntergeladen, Team noch nicht gestartet",
    opt_downloaded_d: "Wir begleiten dich beim ersten Start",
    opt_browsing: "Ich schaue mich nur um",
    opt_browsing_d: "Direkt zur interaktiven Demo der Plattform",
    opt_running: "Mein Team läuft bereits",
    opt_running_d: "Verknüpfe es mit einem Token mit deinem Konto",
    back: "Zurück",
    continue_demo: "Weiter",
    skip: "Überspringen, zum Dashboard",
    dl_title: "Zuerst brauchst du die Desktop-App",
    dl_body:
      "Das Agenten-Team läuft auf DEINEM Computer (oder deinem Server), in der Desktop-App: Dort entstehen Stellen, Analysen und Lebensläufe. Ohne arbeitendes Team bliebe dieses Dashboard leer.",
    dl_modes: "Wo das Team laufen kann",
    dl_mode1: "Auf deinem Alltags-Mac — starten und stoppen, wann du willst",
    dl_mode2: "Auf einem dedizierten Dauerläufer — das Team arbeitet 24/7",
    dl_mode3: "Auf einem Cloud-VPS — keine eigene Hardware, immer aktiv",
    dl_cta: "App herunterladen",
    dl_note:
      "Sobald das Team läuft, komm hierher zurück: Unter Einstellungen → Gerätetokens erzeugst du den Code, um es mit diesem Konto zu verknüpfen.",
    start_title: "Starte dein Team",
    start_body:
      "Öffne die Desktop-App und schließe die geführte Einrichtung ab: Profil, Präferenzen und erster Start des Teams. Wenn das Team arbeitet, verknüpfe es mit diesem Konto (Schritte unten), um die Daten auch vom Handy oder einem anderen Rechner zu sehen.",
    pair_title: "Verknüpfe dein Team mit diesem Konto",
    pair_body:
      "Das Team läuft weiter, wo es ist: Das Pairing synchronisiert die Daten in die Cloud und dieses Dashboard (auch am Handy) füllt sich von selbst.",
    pair_s1: "Erzeuge ein Gerätetoken über dieses Konto",
    pair_s1_cta: "Gerätetokens öffnen",
    pair_s2:
      "Füge das Token auf der Maschine, auf der das Team läuft, im Cloud-Bereich der App ein (oder führe den Befehl unten aus)",
    pair_s3:
      "Komm hierher zurück: Beim ersten Sync zeigt das Dashboard die echten Daten deines Teams",
    demo_q: "Probiere inzwischen die Demo",
    demo_hint:
      "In welchem Bereich arbeitest du? Wir zeigen dir ein vorbefülltes Beispiel-Dashboard: filtern, Stellen öffnen, Feedback geben.",
    demo_note:
      "Es sind fiktive, klar gekennzeichnete Demo-Daten: deine erscheinen, sobald du das Team verbindest.",
    synced_title: "Dein Team ist bereits verbunden",
    synced_body:
      "Dieses Konto empfängt bereits synchronisierte Daten: Das Dashboard zeigt die Arbeit deines Teams.",
    synced_cta: "Zum Dashboard",
  },
  hu: {
    title: "Üdvözlünk a JHT-n",
    subtitle:
      "Az ügynökcsapatod keres, elemez és előkészíti a jelentkezéseket helyetted. Ez az oldal ablak a csapat által generált adatokra.",
    q_lang: "Milyen nyelven szeretnéd használni a platformot?",
    q_status: "Hol tartasz?",
    opt_none: "Még nem töltöttem le az asztali appot",
    opt_none_d: "Elmagyarázzuk, hogyan működik és honnan szerezheted be",
    opt_downloaded: "Letöltöttem az appot, de nem indítottam el a csapatot",
    opt_downloaded_d: "Végigvezetünk az első indításon",
    opt_browsing: "Csak körülnézek",
    opt_browsing_d: "Ugorj egyenesen a platform interaktív demójához",
    opt_running: "A csapatom már fut",
    opt_running_d: "Kapcsold a fiókodhoz egy tokennel",
    back: "Vissza",
    continue_demo: "Tovább",
    skip: "Kihagyás, irány a dashboard",
    dl_title: "Először az asztali app kell",
    dl_body:
      "Az ügynökcsapat a TE gépeden (vagy saját szervereden) fut, az asztali appban: ott születnek a pozíciók, elemzések és önéletrajzok. Dolgozó csapat nélkül ez a dashboard üres maradna.",
    dl_modes: "Hol futhat a csapat",
    dl_mode1:
      "A mindennapi Maceden — akkor indítod és állítod le, amikor akarod",
    dl_mode2: "Egy dedikált, mindig bekapcsolt gépen — a csapat 24/7 dolgozik",
    dl_mode3: "Egy felhőbeli VPS-en — saját hardver nélkül, mindig aktív",
    dl_cta: "App letöltése",
    dl_note:
      "Amikor a csapat már fut, gyere vissza: a Beállítások → Eszköztokenek alatt generálod a kódot, amivel ehhez a fiókhoz kapcsolod.",
    start_title: "Indítsd el a csapatodat",
    start_body:
      "Nyisd meg az asztali appot és fejezd be az irányított beállítást: profil, preferenciák és a csapat első indítása. Amikor a csapat dolgozik, kapcsold ehhez a fiókhoz (lépések lent), hogy telefonról vagy másik gépről is lásd az adatokat.",
    pair_title: "Kapcsold a csapatodat ehhez a fiókhoz",
    pair_body:
      "A csapat ott fut tovább, ahol van: a párosítással az adatok a felhőbe szinkronizálódnak, és ez a dashboard (telefonon is) magától feltöltődik.",
    pair_s1: "Generálj eszköztokent ebből a fiókból",
    pair_s1_cta: "Eszköztokenek megnyitása",
    pair_s2:
      "A csapatot futtató gépen illeszd be a tokent az app Cloud szekciójába (vagy futtasd az alábbi parancsot)",
    pair_s3:
      "Gyere vissza: az első szinkronnál a dashboard a csapatod valódi adatait mutatja",
    demo_q: "Addig is próbáld ki a demót",
    demo_hint:
      "Milyen területen dolgozol? Mutatunk egy előre feltöltött minta-dashboardot: szűrhetsz, megnyithatod a pozíciókat és véleményezhetsz.",
    demo_note:
      "Ezek a demóhoz generált, egyértelműen jelölt fiktív adatok: a tieid akkor jelennek meg, amikor összekapcsolod a csapatot.",
    synced_title: "A csapatod már össze van kapcsolva",
    synced_body:
      "Ez a fiók már kap szinkronizált adatokat: a dashboard a csapatod munkáját mutatja.",
    synced_cta: "Irány a dashboard",
  },
  pt: {
    title: "Bem-vindo ao JHT",
    subtitle:
      "A tua equipa de agentes procura, analisa e prepara candidaturas por ti. Este site é a janela para os dados que a equipa gera.",
    q_lang: "Em que língua queres usar a plataforma?",
    q_status: "Em que ponto estás?",
    opt_none: "Ainda não descarreguei a app desktop",
    opt_none_d: "Explicamos como funciona e onde a obter",
    opt_downloaded: "Descarreguei a app mas não iniciei a equipa",
    opt_downloaded_d: "Guiamos-te no primeiro arranque",
    opt_browsing: "Estou só a dar uma olhada",
    opt_browsing_d: "Vai direto para a demo interativa da plataforma",
    opt_running: "A minha equipa já está ativa",
    opt_running_d: "Liga-a à tua conta com um token",
    back: "Voltar",
    continue_demo: "Continuar",
    skip: "Saltar, ir para o dashboard",
    dl_title: "Primeiro precisas da app desktop",
    dl_body:
      "A equipa de agentes corre no TEU computador (ou num servidor teu), dentro da app desktop: é lá que nascem posições, análises e CV. Sem uma equipa a trabalhar, este dashboard ficaria vazio.",
    dl_modes: "Onde correr a equipa",
    dl_mode1: "No teu Mac do dia a dia — arranca e para quando quiseres",
    dl_mode2: "Num computador dedicado sempre ligado — a equipa trabalha 24/7",
    dl_mode3: "Numa VPS na nuvem — sem hardware teu, sempre ativa",
    dl_cta: "Descarregar a app",
    dl_note:
      "Quando a equipa estiver ativa, volta aqui: em Definições → Tokens de dispositivo geras o código para a ligar a esta conta.",
    start_title: "Inicia a tua equipa",
    start_body:
      "Abre a app desktop e completa a configuração guiada: perfil, preferências e primeiro arranque da equipa. Quando a equipa trabalhar, liga-a a esta conta (passos abaixo) para veres os dados também do telemóvel ou de outro computador.",
    pair_title: "Liga a tua equipa a esta conta",
    pair_body:
      "A equipa continua a correr onde está: com o pairing os dados sincronizam-se na nuvem e este dashboard (telemóvel incluído) preenche-se sozinho.",
    pair_s1: "Gera um token de dispositivo a partir desta conta",
    pair_s1_cta: "Abrir Tokens de dispositivo",
    pair_s2:
      "Na máquina onde corre a equipa, cola o token na secção Cloud da app (ou executa o comando abaixo)",
    pair_s3:
      "Volta aqui: na primeira sincronização o dashboard mostra os dados reais da tua equipa",
    demo_q: "Entretanto, experimenta a demo",
    demo_hint:
      "Em que área trabalhas? Mostramos-te um dashboard de exemplo já preenchido: podes filtrar, abrir posições e dar feedback.",
    demo_note:
      "São dados fictícios gerados para a demo, claramente etiquetados: os teus vão aparecer quando ligares a equipa.",
    synced_title: "A tua equipa já está ligada",
    synced_body:
      "Esta conta já recebe dados sincronizados: o dashboard mostra o trabalho da tua equipa.",
    synced_cta: "Ir para o dashboard",
  },
};
