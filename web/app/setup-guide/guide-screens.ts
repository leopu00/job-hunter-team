// Registro delle schermate della guida.
//
// Ogni schermata sta qui UNA volta, con il suo file, la sua alt text e la
// sua didascalia di default. Le fasi la richiamano per `id`: così la stessa
// schermata può comparire in due fasi diverse — cosa esplicitamente ammessa
// dal brief — senza duplicare né il file né la traduzione dell'alt.
//
// Le schermate non ancora riprese esistono comunque come voce, con `assets`
// vuoto e `pending` che dice cosa devono mostrare. La pagina renderizza uno
// slot al posto dell'immagine: la guida si legge lo stesso e l'elenco di ciò
// che manca si ricava dal codice invece che da una lista a parte.
//
// ⚠️ Zero dati personali nelle schermate: niente nomi, email, CV veri, path
// con dati dell'operatore, token. Una schermata che li contiene si rifà in
// ambiente pulito — mai sfocature, mai ricostruzioni.

import type { GuideScreen } from "./guide-types";

const SCREEN_LIST: GuideScreen[] = [
  {
    id: "download-page",
    alt: {
      en: "The site's Download page with the three platform buttons.",
      it: "La pagina Download del sito con i tre pulsanti per piattaforma.",
      es: "La página de Descarga del sitio con los tres botones de plataforma.",
      fr: "La page de téléchargement du site avec les trois boutons de plateforme.",
      de: "Die Download-Seite der Website mit den drei Plattform-Buttons.",
      pt: "A página de Download do site com os três botões de plataforma.",
      hu: "A webhely Letöltés oldala a három platformgombbal.",
    },
    caption: {
      en: "Pick your system: the download starts right away.",
      it: "Scegli il tuo sistema: il download parte subito.",
      es: "Elige tu sistema: la descarga empieza enseguida.",
      fr: "Choisissez votre système : le téléchargement démarre aussitôt.",
      de: "Wähle dein System: Der Download startet sofort.",
      pt: "Escolhe o teu sistema: a transferência começa logo.",
      hu: "Válaszd ki a rendszered: a letöltés azonnal elindul.",
    },
    assets: {},
    pending: "Pagina /download del sito, una ripresa per OS selezionato.",
  },
  {
    id: "language-choice",
    alt: {
      en: "First launch: the interface language choice, English preselected.",
      it: "Primo avvio: la scelta della lingua dell'interfaccia, inglese preselezionato.",
      es: "Primer inicio: la elección del idioma de la interfaz, con inglés preseleccionado.",
      fr: "Premier lancement : le choix de la langue de l'interface, anglais présélectionné.",
      de: "Erster Start: die Wahl der Oberflächensprache, Englisch vorausgewählt.",
      pt: "Primeiro arranque: a escolha do idioma da interface, com inglês pré-selecionado.",
      hu: "Első indítás: a felület nyelvének kiválasztása, az angol előre kijelölve.",
    },
    caption: {
      en: "Confirming a language is required — it is saved for later launches.",
      it: "Confermare una lingua è obbligatorio: resta salvata per gli avvii successivi.",
      es: "Confirmar un idioma es obligatorio: queda guardado para los siguientes inicios.",
      fr: "Confirmer une langue est obligatoire : elle est conservée pour les lancements suivants.",
      de: "Eine Sprache zu bestätigen ist Pflicht — sie bleibt für spätere Starts gespeichert.",
      pt: "Confirmar um idioma é obrigatório: fica guardado para os arranques seguintes.",
      hu: "A nyelv megerősítése kötelező — a program elmenti a későbbi indításokhoz.",
    },
    assets: {},
    pending: "Schermata di scelta lingua al primo avvio, per i tre OS.",
  },
  {
    id: "office-overview",
    alt: {
      en: "The office seen from above, with the team's desks.",
      it: "L'ufficio visto dall'alto, con le scrivanie della squadra.",
      es: "La oficina vista desde arriba, con los escritorios del equipo.",
      fr: "Le bureau vu d'en haut, avec les postes de l'équipe.",
      de: "Das Büro von oben, mit den Schreibtischen des Teams.",
      pt: "O escritório visto de cima, com as secretárias da equipa.",
      hu: "Az iroda felülnézetből, a csapat asztalaival.",
    },
    caption: {
      en: "You can walk around before any setup: nothing here starts a live team.",
      it: "Puoi girare prima di qualsiasi setup: da qui non parte nessun team vero.",
      es: "Puedes moverte antes de cualquier configuración: aquí no arranca ningún equipo real.",
      fr: "Vous pouvez circuler avant toute configuration : rien ici ne lance une équipe réelle.",
      de: "Du kannst dich vor jeder Einrichtung umsehen: Hier startet kein echtes Team.",
      pt: "Podes andar por aqui antes de qualquer configuração: nada aqui arranca uma equipa real.",
      hu: "A beállítás előtt is körbejárhatsz: innen semmi nem indít valódi csapatot.",
    },
    assets: {
      shared: {
        src: "/tutorials/game/office-overview.png",
        width: 1600,
        height: 900,
      },
    },
  },
  {
    id: "departments",
    alt: {
      en: "The office departments, each with the role that works there.",
      it: "I reparti dell'ufficio, ognuno con il ruolo che ci lavora.",
      es: "Los departamentos de la oficina, cada uno con el rol que trabaja allí.",
      fr: "Les services du bureau, chacun avec le rôle qui y travaille.",
      de: "Die Abteilungen des Büros, jede mit der Rolle, die dort arbeitet.",
      pt: "Os departamentos do escritório, cada um com o papel que ali trabalha.",
      hu: "Az iroda részlegei, mindegyik a benne dolgozó szereppel.",
    },
    caption: {
      en: "Each desk is a role: scouting, scoring, writing, review.",
      it: "Ogni scrivania è un ruolo: ricerca, punteggio, scrittura, revisione.",
      es: "Cada escritorio es un rol: búsqueda, puntuación, redacción, revisión.",
      fr: "Chaque poste est un rôle : recherche, notation, rédaction, relecture.",
      de: "Jeder Schreibtisch ist eine Rolle: Suche, Bewertung, Schreiben, Prüfung.",
      pt: "Cada secretária é um papel: procura, pontuação, escrita, revisão.",
      hu: "Minden asztal egy szerep: keresés, pontozás, írás, ellenőrzés.",
    },
    assets: {
      shared: {
        src: "/tutorials/game/departments.png",
        width: 1600,
        height: 900,
      },
    },
  },
  {
    id: "setup-checklist",
    alt: {
      en: "The setup checklist, with each requirement and its state.",
      it: "La checklist di setup, con ogni requisito e il suo stato.",
      es: "La lista de configuración, con cada requisito y su estado.",
      fr: "La liste de configuration, avec chaque prérequis et son état.",
      de: "Die Einrichtungs-Checkliste, mit jeder Voraussetzung und ihrem Status.",
      pt: "A lista de configuração, com cada requisito e o seu estado.",
      hu: "A beállítási ellenőrzőlista, minden követelménnyel és állapotával.",
    },
    caption: {
      en: "The checklist is the map of the whole setup: it tells you what is missing.",
      it: "La checklist è la mappa di tutto il setup: dice cosa manca.",
      es: "La lista es el mapa de toda la configuración: dice qué falta.",
      fr: "La liste est la carte de toute la configuration : elle dit ce qui manque.",
      de: "Die Checkliste ist die Karte der gesamten Einrichtung: Sie zeigt, was fehlt.",
      pt: "A lista é o mapa de toda a configuração: diz o que falta.",
      hu: "Az ellenőrzőlista a teljes beállítás térképe: megmutatja, mi hiányzik.",
    },
    assets: {},
    pending: "Pannello checklist di setup, una ripresa per OS.",
  },
  {
    id: "docker-check",
    alt: {
      en: "The Docker check inside the setup panel.",
      it: "Il controllo di Docker dentro il pannello di setup.",
      es: "La comprobación de Docker dentro del panel de configuración.",
      fr: "La vérification de Docker dans le panneau de configuration.",
      de: "Die Docker-Prüfung im Einrichtungsfenster.",
      pt: "A verificação do Docker dentro do painel de configuração.",
      hu: "A Docker ellenőrzése a beállítási panelen.",
    },
    caption: {
      en: "Docker is the only real dependency: without it the team cannot start.",
      it: "Docker è l'unica vera dipendenza: senza, il team non parte.",
      es: "Docker es la única dependencia real: sin él el equipo no arranca.",
      fr: "Docker est la seule vraie dépendance : sans lui, l'équipe ne démarre pas.",
      de: "Docker ist die einzige echte Abhängigkeit: Ohne es startet das Team nicht.",
      pt: "O Docker é a única dependência real: sem ele a equipa não arranca.",
      hu: "A Docker az egyetlen valódi függőség: nélküle a csapat nem indul el.",
    },
    assets: {},
    pending: "Riga Docker della checklist, stato mancante e stato verde.",
  },
  {
    id: "provider-auth",
    alt: {
      en: "Provider authorization in the office terminal.",
      it: "L'autorizzazione del provider nel terminale dell'ufficio.",
      es: "La autorización del proveedor en el terminal de la oficina.",
      fr: "L'autorisation du fournisseur dans le terminal du bureau.",
      de: "Die Anbieter-Autorisierung im Terminal des Büros.",
      pt: "A autorização do provedor no terminal do escritório.",
      hu: "A szolgáltató engedélyezése az iroda termináljában.",
    },
    caption: {
      en: "The link opens in your browser; the code stays in the terminal.",
      it: "Il link si apre nel browser; il codice resta nel terminale.",
      es: "El enlace se abre en el navegador; el código se queda en el terminal.",
      fr: "Le lien s'ouvre dans le navigateur ; le code reste dans le terminal.",
      de: "Der Link öffnet sich im Browser; der Code bleibt im Terminal.",
      pt: "O link abre no navegador; o código fica no terminal.",
      hu: "A hivatkozás a böngészőben nyílik meg; a kód a terminálban marad.",
    },
    assets: {},
    pending:
      "Terminale con l'autorizzazione provider — nessun token a schermo.",
  },
  {
    id: "cv-upload",
    alt: {
      en: "Uploading the CV that the team will work from.",
      it: "Il caricamento del CV da cui la squadra lavora.",
      es: "La carga del CV con el que trabajará el equipo.",
      fr: "Le téléversement du CV à partir duquel l'équipe travaille.",
      de: "Das Hochladen des Lebenslaufs, mit dem das Team arbeitet.",
      pt: "O carregamento do CV a partir do qual a equipa trabalha.",
      hu: "Az önéletrajz feltöltése, amelyből a csapat dolgozik.",
    },
    caption: {
      en: "The CV stays on your machine: it is what the team reads to score jobs.",
      it: "Il CV resta sulla tua macchina: è ciò che il team legge per dare i punteggi.",
      es: "El CV se queda en tu equipo: es lo que el equipo lee para puntuar ofertas.",
      fr: "Le CV reste sur votre machine : c'est ce que l'équipe lit pour noter les offres.",
      de: "Der Lebenslauf bleibt auf deinem Rechner: Danach bewertet das Team die Stellen.",
      pt: "O CV fica na tua máquina: é o que a equipa lê para pontuar as vagas.",
      hu: "Az önéletrajz a gépeden marad: ebből pontozza a csapat az állásokat.",
    },
    assets: {},
    pending: "Caricamento CV — usare un CV fittizio, mai uno reale.",
  },
  {
    id: "team-running",
    alt: {
      en: "The team at work, with the first positions arriving.",
      it: "Il team al lavoro, con le prime posizioni che arrivano.",
      es: "El equipo trabajando, con las primeras posiciones llegando.",
      fr: "L'équipe au travail, avec les premières offres qui arrivent.",
      de: "Das Team bei der Arbeit, die ersten Stellen treffen ein.",
      pt: "A equipa a trabalhar, com as primeiras posições a chegar.",
      hu: "A csapat munkában, érkeznek az első pozíciók.",
    },
    caption: {
      en: "From here on the team works on its own — you can close the window.",
      it: "Da qui in poi il team lavora da solo: puoi chiudere la finestra.",
      es: "A partir de aquí el equipo trabaja solo: puedes cerrar la ventana.",
      fr: "À partir d'ici l'équipe travaille seule : vous pouvez fermer la fenêtre.",
      de: "Ab hier arbeitet das Team allein — du kannst das Fenster schließen.",
      pt: "A partir daqui a equipa trabalha sozinha: podes fechar a janela.",
      hu: "Innentől a csapat magától dolgozik — bezárhatod az ablakot.",
    },
    assets: {},
    pending: "Team avviato con posizioni reali anonimizzate.",
  },
  {
    id: "google-sign-in",
    alt: {
      en: "Signing in to the site with a Google account.",
      it: "L'accesso al sito con un account Google.",
      es: "El inicio de sesión en el sitio con una cuenta de Google.",
      fr: "La connexion au site avec un compte Google.",
      de: "Die Anmeldung auf der Website mit einem Google-Konto.",
      pt: "O início de sessão no site com uma conta Google.",
      hu: "Bejelentkezés a webhelyre Google-fiókkal.",
    },
    caption: {
      en: "The same account links your local team to the web dashboard.",
      it: "Lo stesso account collega il team locale alla dashboard web.",
      es: "La misma cuenta enlaza tu equipo local con el panel web.",
      fr: "Le même compte relie votre équipe locale au tableau de bord web.",
      de: "Dasselbe Konto verbindet dein lokales Team mit dem Web-Dashboard.",
      pt: "A mesma conta liga a tua equipa local ao painel web.",
      hu: "Ugyanaz a fiók köti össze a helyi csapatot a webes irányítópulttal.",
    },
    assets: {},
    pending: "Login Google sul sito — account di prova, mai quello reale.",
  },
  {
    id: "sync-authorizations",
    alt: {
      en: "The permissions granted to the sync between the local team and the web.",
      it: "Le autorizzazioni concesse alla sincronizzazione fra team locale e web.",
      es: "Los permisos concedidos a la sincronización entre el equipo local y la web.",
      fr: "Les autorisations accordées à la synchronisation entre l'équipe locale et le web.",
      de: "Die Berechtigungen für die Synchronisierung zwischen lokalem Team und Web.",
      pt: "As permissões concedidas à sincronização entre a equipa local e a web.",
      hu: "A helyi csapat és a web közötti szinkronizálásnak adott engedélyek.",
    },
    caption: {
      en: "You choose what is synced, and you can revoke it at any time.",
      it: "Scegli tu cosa si sincronizza, e puoi revocarlo quando vuoi.",
      es: "Tú eliges qué se sincroniza y puedes revocarlo cuando quieras.",
      fr: "Vous choisissez ce qui est synchronisé et pouvez le révoquer à tout moment.",
      de: "Du entscheidest, was synchronisiert wird, und kannst es jederzeit widerrufen.",
      pt: "Escolhes o que é sincronizado e podes revogar quando quiseres.",
      hu: "Te döntöd el, mi szinkronizálódik, és bármikor visszavonhatod.",
    },
    assets: {},
    pending: "Pannello autorizzazioni sync — nessun user_id a schermo.",
  },
  {
    id: "web-dashboard",
    alt: {
      en: "The web dashboard with the positions found by the team.",
      it: "La dashboard web con le posizioni trovate dal team.",
      es: "El panel web con las posiciones encontradas por el equipo.",
      fr: "Le tableau de bord web avec les offres trouvées par l'équipe.",
      de: "Das Web-Dashboard mit den vom Team gefundenen Stellen.",
      pt: "O painel web com as posições encontradas pela equipa.",
      hu: "A webes irányítópult a csapat által talált pozíciókkal.",
    },
    caption: {
      en: "The same results, readable from your phone.",
      it: "Gli stessi risultati, leggibili dal telefono.",
      es: "Los mismos resultados, legibles desde el móvil.",
      fr: "Les mêmes résultats, lisibles depuis votre téléphone.",
      de: "Dieselben Ergebnisse, lesbar vom Telefon aus.",
      pt: "Os mesmos resultados, legíveis a partir do telemóvel.",
      hu: "Ugyanazok az eredmények, telefonról is olvashatóan.",
    },
    assets: {},
    pending: "Dashboard web con dati demo, nessun dato di beta tester.",
  },
];

/** Le schermate indicizzate per id. */
export const SCREENS: Record<string, GuideScreen> = Object.fromEntries(
  SCREEN_LIST.map((screen) => [screen.id, screen]),
);

/** Elenco delle schermate ancora da riprendere — usato dal test che tiene
 *  onesto il conto di ciò che manca. */
export function pendingScreens(): GuideScreen[] {
  return SCREEN_LIST.filter(
    (screen) => Object.keys(screen.assets).length === 0,
  );
}
