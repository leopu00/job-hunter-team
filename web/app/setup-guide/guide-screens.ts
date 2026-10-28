// Registro delle schermate della guida.
//
// Gli id sono quelli del contratto del team docs
// (`docs/internal/2026-08-07-setup-guide-content-contract.md`): `G00`,
// `S01`–`S17`, `W01`–`W04`. Adottarli alla radice, invece di mappare due
// nomenclature, fa sì che i file consegnati dai collaudatori si aggancino
// da soli: il nome del file contiene già l'id.
//
// Convenzione del contratto: `<ID>-<slug>-<os>.png` sotto
// `web/public/setup-guide/`, con `os` fra `macos`, `windows`, `linux`.
// Quando l'immagine è identica sui tre sistemi si usa `shared`.
//
// Ogni schermata sta qui UNA volta, con la sua alt text e la sua didascalia.
// Le fasi la richiamano per id: la stessa schermata può quindi comparire in
// due fasi diverse — richiesta esplicita — senza duplicare né il file né la
// traduzione. `S06-choose-language` compare due volte.
//
// Le schermate non ancora riprese esistono comunque come voce, con `assets`
// vuoto e `pending` che dice cosa devono mostrare. `pending` non raggiunge mai
// l'interfaccia pubblica: l'elenco di ciò che manca si ricava dal codice
// invece che da una lista a parte.
//
// ⚠️ Zero dati personali: niente nomi, email, CV veri, path, identificativi
// di account o dispositivo, user id, token, codici di autorizzazione. Una
// schermata che li contiene si rifà in ambiente pulito — mai sfocature, mai
// ricostruzioni (regola del contratto, § Screenshot rules).

import type { GuideScreen, OsId } from "./guide-types";

const SCREEN_LIST: GuideScreen[] = [
  {
    id: "G00-guide-index",
    alt: {
      en: "The guide index with the operating system selector.",
      it: "L'indice della guida con il selettore del sistema operativo.",
      es: "El índice de la guía con el selector de sistema operativo.",
      fr: "L'index du guide avec le sélecteur de système d'exploitation.",
      de: "Das Inhaltsverzeichnis der Anleitung mit der Systemauswahl.",
      pt: "O índice do guia com o seletor de sistema operativo.",
      hu: "Az útmutató tartalomjegyzéke az operációsrendszer-választóval.",
    },
    caption: {
      en: "The system you pick here stays selected through every chapter.",
      it: "Il sistema che scegli qui resta selezionato in tutti i capitoli.",
      es: "El sistema que elijas aquí queda seleccionado en todos los capítulos.",
      fr: "Le système choisi ici reste sélectionné dans tous les chapitres.",
      de: "Das hier gewählte System bleibt in allen Kapiteln ausgewählt.",
      pt: "O sistema que escolheres aqui fica selecionado em todos os capítulos.",
      hu: "Az itt választott rendszer minden fejezetben kijelölve marad.",
    },
    assets: {},
    nativeSurface:
      "Superficie nativa: l'indice dei capitoli e il selettore OS sono dal vivo in cima alla pagina. Il team docs ha cancellato la richiesta PNG il 7 agosto 2026 — niente screenshot della pagina dentro sé stessa e niente duplicato mobile. Nessuna ripresa da fare per E2E.",
  },
  {
    id: "S01-prerequisites",
    alt: {
      en: "The requirement card: container engine, memory, disk, internet and provider subscription.",
      it: "La scheda dei requisiti: motore dei container, memoria, disco, internet e abbonamento al provider.",
      es: "La tarjeta de requisitos: motor de contenedores, memoria, disco, internet y suscripción al proveedor.",
      fr: "La fiche des prérequis : moteur de conteneurs, mémoire, disque, internet et abonnement au fournisseur.",
      de: "Die Voraussetzungskarte: Container-Engine, Arbeitsspeicher, Festplatte, Internet und Anbieter-Abo.",
      pt: "O cartão de requisitos: motor de contentores, memória, disco, internet e subscrição do provedor.",
      hu: "A követelménykártya: konténermotor, memória, lemez, internet és szolgáltatói előfizetés.",
    },
    caption: {
      en: "Measured figures only: where nothing was measured, nothing is claimed.",
      it: "Solo numeri misurati: dove non è stato misurato nulla, non si dichiara nulla.",
      es: "Solo cifras medidas: donde no se midió nada, no se afirma nada.",
      fr: "Uniquement des chiffres mesurés : là où rien n'a été mesuré, rien n'est affirmé.",
      de: "Nur gemessene Zahlen: Wo nichts gemessen wurde, wird nichts behauptet.",
      pt: "Só números medidos: onde nada foi medido, nada é afirmado.",
      hu: "Csak mért számok: ahol nem mértünk, ott nem állítunk semmit.",
    },
    assets: {},
    nativeSurface:
      "Superficie nativa: la scheda è `RequirementsCard`, costruita nella pagina. Il team docs ha cancellato la richiesta PNG il 7 agosto 2026 — resta la fase, non l'immagine. Nessuna ripresa da fare per E2E.",
  },
  {
    id: "S03-artifact-download",
    alt: {
      en: "The official release download for this system.",
      it: "Il download della release ufficiale per questo sistema.",
      es: "La descarga de la versión oficial para este sistema.",
      fr: "Le téléchargement de la version officielle pour ce système.",
      de: "Der offizielle Release-Download für dieses System.",
      pt: "A transferência da versão oficial para este sistema.",
      hu: "A hivatalos kiadás letöltése ehhez a rendszerhez.",
    },
    caption: {
      en: "On Windows the installer is the primary path; the portable build is the alternative.",
      it: "Su Windows l'installer è la via principale; la versione portable è l'alternativa.",
      es: "En Windows el instalador es la vía principal; la versión portable es la alternativa.",
      fr: "Sous Windows, l'installeur est la voie principale ; la version portable est l'alternative.",
      de: "Unter Windows ist der Installer der Hauptweg; der portable Build ist die Alternative.",
      pt: "No Windows o instalador é o caminho principal; a versão portátil é a alternativa.",
      hu: "Windowson a telepítő az elsődleges út; a hordozható változat az alternatíva.",
    },
    assets: {},
    pending:
      "Windows: tolta, la 0.4 non ha Windows. Linux: revocata dall'audit. macOS: Da rifare con l'app 0.4, dati finti, build 2. File: web/public/setup-guide/S03-artifact-download-macos.jpg (1506×825 px), poi rimettere la voce in assets.",
  },
  {
    id: "S04-installation-macos",
    alt: {
      en: "The extracted app ready to open on macOS.",
      it: "L'app estratta e pronta da aprire su macOS.",
      es: "La aplicación extraída y lista para abrir en macOS.",
      fr: "L'application extraite, prête à être ouverte sur macOS.",
      de: "Die entpackte App, bereit zum Öffnen unter macOS.",
      pt: "A aplicação extraída e pronta a abrir no macOS.",
      hu: "A kicsomagolt alkalmazás, megnyitásra készen macOS-en.",
    },
    caption: {
      en: "The macOS build is signed and notarized: a double click is enough.",
      it: "La build macOS è firmata e notarizzata: basta un doppio clic.",
      es: "La versión de macOS está firmada y notarizada: basta un doble clic.",
      fr: "La version macOS est signée et notariée : un double clic suffit.",
      de: "Der macOS-Build ist signiert und notarisiert: Ein Doppelklick genügt.",
      pt: "A versão macOS está assinada e notarizada: basta um duplo clique.",
      hu: "A macOS-változat aláírt és hitelesített: elég egy dupla kattintás.",
    },
    assets: {},
    pending:
      "Da rifare con l'app 0.4 su Mac, dati finti, build 2. File in web/public/setup-guide/: S04-installation-macos.png (2064×1096 px); poi rimettere le voci in assets.",
  },
  {
    id: "S04-installation-windows",
    alt: {
      en: "The downloaded Windows build ready to open.",
      it: "La build Windows scaricata, pronta da aprire.",
      es: "La versión de Windows descargada, lista para abrir.",
      fr: "La version Windows téléchargée, prête à être ouverte.",
      de: "Der heruntergeladene Windows-Build, bereit zum Öffnen.",
      pt: "A versão Windows transferida, pronta a abrir.",
      hu: "A letöltött Windows-változat, megnyitásra készen.",
    },
    caption: {
      en: "A SmartScreen warning is expected: check where the file came from.",
      it: "Un avviso SmartScreen è previsto: controlla da dove viene il file.",
      es: "Un aviso de SmartScreen es esperable: comprueba de dónde viene el archivo.",
      fr: "Un avertissement SmartScreen est attendu : vérifiez l'origine du fichier.",
      de: "Eine SmartScreen-Warnung ist zu erwarten: Prüfe die Herkunft der Datei.",
      pt: "Um aviso do SmartScreen é esperado: verifica a origem do ficheiro.",
      hu: "A SmartScreen-figyelmeztetés várható: ellenőrizd a fájl forrását.",
    },
    assets: {},
    pending: "Tolta: la 0.4 non ha Windows. Nessuna ripresa da fare.",
  },
  {
    id: "S04-installation-linux",
    alt: {
      en: "The extracted Linux binary ready to run.",
      it: "Il binario Linux estratto, pronto all'esecuzione.",
      es: "El binario de Linux extraído, listo para ejecutarse.",
      fr: "Le binaire Linux extrait, prêt à être lancé.",
      de: "Die entpackte Linux-Binärdatei, bereit zum Start.",
      pt: "O binário Linux extraído, pronto a executar.",
      hu: "A kicsomagolt Linux-bináris, futtatásra készen.",
    },
    caption: {
      en: "Allow it to run: the executable permission may need enabling first.",
      it: "Consentine l'esecuzione: il permesso di eseguire può richiedere un passaggio in più.",
      es: "Permite su ejecución: puede que antes haya que activar el permiso de ejecución.",
      fr: "Autorisez son exécution : le droit d'exécution peut devoir être activé d'abord.",
      de: "Erlaube die Ausführung: Das Ausführungsrecht muss eventuell erst gesetzt werden.",
      pt: "Permite a execução: pode ser preciso ativar antes a permissão de execução.",
      hu: "Engedélyezd a futtatást: előbb szükség lehet a futtatási jog beállítására.",
    },
    assets: {
      linux: {
        src: "/setup-guide/S04-installation-linux.png",
        width: 1920,
        height: 1080,
      },
    },
  },
  {
    id: "S05-first-launch",
    alt: {
      en: "The first clean launch of the app.",
      it: "Il primo avvio pulito dell'app.",
      es: "El primer inicio limpio de la aplicación.",
      fr: "Le premier lancement propre de l'application.",
      de: "Der erste saubere Start der App.",
      pt: "O primeiro arranque limpo da aplicação.",
      hu: "Az alkalmazás első tiszta indítása.",
    },
    caption: {
      en: "The language picker comes first.",
      it: "La scelta della lingua viene per prima.",
      es: "El selector de idioma aparece primero.",
      fr: "Le choix de la langue vient en premier.",
      de: "Die Sprachauswahl kommt zuerst.",
      pt: "O seletor de idioma aparece primeiro.",
      hu: "A nyelvválasztó jelenik meg elsőként.",
    },
    assets: {
      // Stesso file di S06, non una copia: il contratto ammette il riuso
      // perché il selettore lingua È la prima schermata di un avvio
      // pulito. Una voce in più nel registro, non un file in più sul
      // disco — che è esattamente a cosa serve il registro.
    },
    pending:
      "Usa la stessa ripresa di S06 (S06-choose-language-macos.png e -linux.png): tolte entrambe, si rifanno con S06. Poi rimettere le voci in assets.",
  },
  {
    id: "S06-choose-language",
    alt: {
      en: "The interface language picker, English preselected.",
      it: "La scelta della lingua dell'interfaccia, inglese preselezionato.",
      es: "El selector de idioma de la interfaz, con inglés preseleccionado.",
      fr: "Le sélecteur de langue de l'interface, anglais présélectionné.",
      de: "Die Sprachauswahl der Oberfläche, Englisch vorausgewählt.",
      pt: "O seletor de idioma da interface, com inglês pré-selecionado.",
      hu: "A felület nyelvválasztója, az angol előre kijelölve.",
    },
    caption: {
      en: "Seven languages; confirming saves the choice on this device.",
      it: "Sette lingue; la conferma salva la scelta su questo dispositivo.",
      es: "Siete idiomas; confirmar guarda la elección en este dispositivo.",
      fr: "Sept langues ; la confirmation enregistre le choix sur cet appareil.",
      de: "Sieben Sprachen; die Bestätigung speichert die Wahl auf diesem Gerät.",
      pt: "Sete idiomas; confirmar guarda a escolha neste dispositivo.",
      hu: "Hét nyelv; a megerősítés elmenti a választást ezen az eszközön.",
    },
    assets: {},
    pending:
      "Da rifare con l'app 0.4 su Mac, dati finti, build 2. File in web/public/setup-guide/: S06-choose-language-linux.png (624×486 px), S06-choose-language-macos.png (3024×1898 px); poi rimettere le voci in assets. Linux: da rifare quando c'è un collaudo Linux.",
  },
  {
    id: "S07a-start-screen",
    alt: {
      en: "The start screen: “How would you like to start?” with Use locally and the Google option.",
      it: "La schermata iniziale: «Come vuoi iniziare?» con Usa in locale e l'opzione Google.",
      es: "La pantalla inicial: «¿Cómo quieres empezar?» con Usar en local y la opción de Google.",
      fr: "L'écran de départ : « Comment souhaitez-vous commencer ? » avec Utiliser en local et l'option Google.",
      de: "Der Startbildschirm: „Wie möchten Sie starten?“ mit Lokal verwenden und der Google-Option.",
      pt: "O ecrã inicial: «Como pretende começar?» com Usar localmente e a opção Google.",
      hu: "A kezdőképernyő: „Hogyan szeretne kezdeni?” a(z) Helyi használat és a Google lehetőséggel.",
    },
    caption: {
      en: "Use locally starts a profile that stays on this device.",
      it: "Usa in locale avvia un profilo che resta su questo dispositivo.",
      es: "Usar en local inicia un perfil que se queda en este dispositivo.",
      fr: "Utiliser en local crée un profil qui reste sur cet appareil.",
      de: "Lokal verwenden legt ein Profil an, das auf diesem Gerät bleibt.",
      pt: "Usar localmente cria um perfil que fica neste dispositivo.",
      hu: "A(z) Helyi használat egy olyan profilt indít, amely ezen az eszközön marad.",
    },
    assets: {},
    pending:
      "Ripresa del collaudo da rifare pulita, senza il dialogo di sistema in alto, con profilo e dati finti. File: web/public/setup-guide/S07a-start-screen-macos.png (3024×1898 px), poi rimettere la voce in assets.",
  },
  {
    id: "S07b-display-name",
    alt: {
      en: "The Display name field filled in, with Continue locally ready.",
      it: "Il campo Nome visualizzato compilato, con Continua in locale attivo.",
      es: "El campo Nombre visible rellenado, con Continuar en local activo.",
      fr: "Le champ Nom affiché rempli, avec Continuer en local actif.",
      de: "Das Feld Anzeigename ausgefüllt, Lokal fortfahren ist aktiv.",
      pt: "O campo Nome apresentado preenchido, com Continuar localmente ativo.",
      hu: "A(z) Megjelenített név mező kitöltve, a(z) Folytatás helyben gomb aktív.",
    },
    caption: {
      en: "The name stays only on this device.",
      it: "Il nome resta solo su questo dispositivo.",
      es: "El nombre se queda solo en este dispositivo.",
      fr: "Le nom reste uniquement sur cet appareil.",
      de: "Der Name bleibt nur auf diesem Gerät.",
      pt: "O nome fica só neste dispositivo.",
      hu: "A név csak ezen az eszközön marad meg.",
    },
    assets: {},
    pending:
      "Ripresa del collaudo da rifare pulita, senza il dialogo di sistema in alto, con profilo e dati finti. File: web/public/setup-guide/S07b-display-name-macos.png (3024×1898 px), poi rimettere la voce in assets.",
  },
  {
    id: "S07-enter-office",
    alt: {
      en: "Step 1, Welcome: the Profile name and Start the setup.",
      it: "Passaggio 1, Benvenuto: il Nome del profilo e Inizia la configurazione.",
      es: "Paso 1, Bienvenida: el Nombre del perfil y Empezar la configuración.",
      fr: "Étape 1, Bienvenue : le Nom du profil et Commencer la configuration.",
      de: "Schritt 1, Willkommen: der Profilname und Einrichtung starten.",
      pt: "Passo 1, Boas-vindas: o Nome do perfil e Começar a configuração.",
      hu: "1. lépés, Üdvözlés: a(z) Profil neve és a(z) A beállítás indítása gomb.",
    },
    caption: {
      en: "The profile name can be changed; it stays only on this device.",
      it: "Il nome del profilo si può cambiare; resta solo su questo dispositivo.",
      es: "El nombre del perfil se puede cambiar; se queda solo en este dispositivo.",
      fr: "Le nom du profil peut être modifié ; il reste uniquement sur cet appareil.",
      de: "Der Profilname lässt sich ändern; er bleibt nur auf diesem Gerät.",
      pt: "O nome do perfil pode ser alterado; fica só neste dispositivo.",
      hu: "A profil neve megváltoztatható; csak ezen az eszközön marad meg.",
    },
    assets: {},
    pending:
      "Ripresa del collaudo da rifare pulita, senza il dialogo di sistema in alto, con profilo e dati finti. File: web/public/setup-guide/S07-enter-office-macos.png (3024×1898 px), poi rimettere la voce in assets.",
  },
  {
    id: "S08-environment",
    alt: {
      en: "Step 2: This computer or VPS server.",
      it: "Passaggio 2: Questo computer oppure Server VPS.",
      es: "Paso 2: Este ordenador o Servidor VPS.",
      fr: "Étape 2 : Cet ordinateur ou Serveur VPS.",
      de: "Schritt 2: Dieser Computer oder VPS-Server.",
      pt: "Passo 2: Este computador ou Servidor VPS.",
      hu: "2. lépés: Ez a számítógép vagy VPS-szerver.",
    },
    caption: {
      en: "This guide follows This computer.",
      it: "Questa guida segue Questo computer.",
      es: "Esta guía sigue Este ordenador.",
      fr: "Ce guide suit Cet ordinateur.",
      de: "Diese Anleitung folgt Dieser Computer.",
      pt: "Este guia segue Este computador.",
      hu: "Ez az útmutató a(z) Ez a számítógép lehetőséget követi.",
    },
    assets: {},
    pending:
      "Ripresa del collaudo da rifare pulita, senza il dialogo di sistema in alto, con profilo e dati finti. File: web/public/setup-guide/S08-environment-macos.png (3024×1898 px), poi rimettere la voce in assets.",
  },
  {
    id: "S08-provider",
    alt: {
      en: "Step 3: Codex, with “No API key needed”.",
      it: "Passaggio 3: Codex, con «Nessuna chiave API richiesta».",
      es: "Paso 3: Codex, con «No hace falta clave API».",
      fr: "Étape 3 : Codex, avec « Aucune clé API requise ».",
      de: "Schritt 3: Codex, mit „Kein API-Schlüssel nötig“.",
      pt: "Passo 3: Codex, com «Não é preciso chave API».",
      hu: "3. lépés: Codex, „Nem kell API-kulcs” felirattal.",
    },
    caption: {
      en: "Access is through your subscription, never an API key.",
      it: "L'accesso passa dal tuo abbonamento, mai da una chiave API.",
      es: "El acceso es con tu suscripción, nunca con una clave de API.",
      fr: "L'accès passe par votre abonnement, jamais par une clé d'API.",
      de: "Der Zugang läuft über dein Abonnement, nie über einen API-Schlüssel.",
      pt: "O acesso é pela tua subscrição, nunca por uma chave de API.",
      hu: "A hozzáférés az előfizetéseden keresztül történik, soha nem API-kulccsal.",
    },
    assets: {},
    pending:
      "Ripresa del collaudo da rifare pulita, senza il dialogo di sistema in alto, con profilo e dati finti. File: web/public/setup-guide/S08-provider-macos.png (3024×1898 px), poi rimettere la voce in assets.",
  },
  {
    id: "S08-confirm",
    alt: {
      en: "Step 4, “All set to start”: the environment and the provider chosen, and Prepare the team.",
      it: "Passaggio 4, «Tutto pronto per partire»: l'ambiente e il provider scelti, e Prepara la squadra.",
      es: "Paso 4, «Todo listo para empezar»: el entorno y el proveedor elegidos, y Preparar el equipo.",
      fr: "Étape 4, « Tout est prêt pour démarrer » : l'environnement et le fournisseur choisis, et Préparer l’équipe.",
      de: "Schritt 4, „Alles bereit zum Start“: die gewählte Umgebung und der gewählte Anbieter, und Team vorbereiten.",
      pt: "Passo 4, «Tudo pronto para começar»: o ambiente e o fornecedor escolhidos, e Preparar a equipa.",
      hu: "4. lépés, „Minden készen áll az indulásra”: a kiválasztott környezet és szolgáltató, valamint a(z) A csapat előkészítése gomb.",
    },
    caption: {
      en: "Nothing starts until you select Prepare the team.",
      it: "Non parte nulla finché non selezioni Prepara la squadra.",
      es: "No empieza nada hasta que selecciones Preparar el equipo.",
      fr: "Rien ne démarre avant que vous sélectionniez Préparer l’équipe.",
      de: "Nichts startet, bevor du Team vorbereiten wählst.",
      pt: "Nada começa até selecionares Preparar a equipa.",
      hu: "Semmi nem indul el, amíg nem választod a(z) A csapat előkészítése gombot.",
    },
    assets: {},
    pending:
      "Ripresa del collaudo da rifare pulita, senza il dialogo di sistema in alto, con profilo e dati finti. File: web/public/setup-guide/S08-confirm-macos.png (3024×1898 px), poi rimettere la voce in assets.",
  },
  {
    id: "S09-start-container",
    alt: {
      en: "The automatic start with its stages: Runtime, Container, Provider, Provider login, Team, Assistant.",
      it: "L'avvio automatico con le sue fasi: Runtime, Container, Provider, Accesso provider, Squadra, Assistente.",
      es: "El inicio automático con sus fases: Runtime, Contenedor, Proveedor, Acceso al proveedor, Equipo, Asistente.",
      fr: "Le démarrage automatique et ses étapes : Runtime, Conteneur, Fournisseur, Connexion au fournisseur, Équipe, Assistant.",
      de: "Der automatische Start mit seinen Phasen: Runtime, Container, Anbieter, Anbieter-Anmeldung, Team, Assistent.",
      pt: "O arranque automático com as suas fases: Runtime, Contentor, Fornecedor, Acesso ao fornecedor, Equipa, Assistente.",
      hu: "Az automatikus indítás a fázisaival: Runtime, Konténer, Szolgáltató, Szolgáltatói bejelentkezés, Csapat, Asszisztens.",
    },
    caption: {
      en: "Each stage shows its state; the first run takes several minutes.",
      it: "Ogni fase mostra il suo stato; il primo avvio richiede diversi minuti.",
      es: "Cada fase muestra su estado; el primer inicio tarda varios minutos.",
      fr: "Chaque étape affiche son état ; le premier lancement prend plusieurs minutes.",
      de: "Jede Phase zeigt ihren Zustand; der erste Start dauert mehrere Minuten.",
      pt: "Cada fase mostra o seu estado; o primeiro arranque demora vários minutos.",
      hu: "Minden fázis mutatja az állapotát; az első indítás több percig tart.",
    },
    assets: {},
    pending:
      "Ripresa del collaudo da rifare pulita, senza il dialogo di sistema in alto, con profilo e dati finti. File: web/public/setup-guide/S09-start-container-macos.png (3024×1898 px), poi rimettere la voce in assets.",
  },
  {
    id: "S11-authorize-provider",
    alt: {
      en: "Provider authorization in the embedded console.",
      it: "L'autorizzazione del provider nella console incorporata.",
      es: "La autorización del proveedor en la consola integrada.",
      fr: "L'autorisation du fournisseur dans la console intégrée.",
      de: "Die Autorisierung beim Anbieter in der integrierten Konsole.",
      pt: "A autorização do fornecedor na consola incorporada.",
      hu: "A szolgáltatói engedélyezés a beágyazott konzolban.",
    },
    caption: {
      en: "Follow only the requests the app shows; nothing else is asked of you.",
      it: "Segui solo le richieste che l'app mostra; non ti viene chiesto altro.",
      es: "Sigue solo las solicitudes que muestra la aplicación; no se te pide nada más.",
      fr: "Suivez uniquement les demandes affichées par l'application ; rien d'autre ne vous est demandé.",
      de: "Folge nur den Aufforderungen der App; mehr wird nicht von dir verlangt.",
      pt: "Segue apenas os pedidos que a aplicação mostra; não te é pedido mais nada.",
      hu: "Csak az alkalmazás által mutatott kéréseket kövesd; más nem kérnek tőled.",
    },
    assets: {},
    pending:
      "Console di autorizzazione dell'accesso al provider. Nessun codice o token a schermo: fermarsi prima che compaia.",
  },
  {
    id: "S16-team-starting",
    alt: {
      en: "The team starting, with the real phase and elapsed time.",
      it: "L'avvio del team, con la fase reale e il tempo trascorso.",
      es: "El arranque del equipo, con la fase real y el tiempo transcurrido.",
      fr: "Le démarrage de l'équipe, avec la phase réelle et le temps écoulé.",
      de: "Der Teamstart, mit echter Phase und verstrichener Zeit.",
      pt: "O arranque da equipa, com a fase real e o tempo decorrido.",
      hu: "A csapat indulása, a valós fázissal és az eltelt idővel.",
    },
    caption: {
      en: "The startup phase shown is the real one, not a progress animation.",
      it: "La fase di avvio mostrata è quella vera, non un'animazione di avanzamento.",
      es: "La fase de arranque mostrada es la real, no una animación de progreso.",
      fr: "La phase de démarrage affichée est la vraie, pas une animation de progression.",
      de: "Die angezeigte Startphase ist die echte, keine Fortschrittsanimation.",
      pt: "A fase de arranque mostrada é a real, não uma animação de progresso.",
      hu: "A megjelenített indulási fázis a valódi, nem folyamatjelző animáció.",
    },
    assets: {},
    pending: "Avvio del team in corso, con fase e tempo reali.",
  },
  {
    id: "S17-team-working",
    alt: {
      en: "The team active, with an operational agent at work on real data.",
      it: "Il team attivo, con un agente operativo al lavoro su dati reali.",
      es: "El equipo activo, con un agente operativo trabajando sobre datos reales.",
      fr: "L'équipe active, avec un agent opérationnel travaillant sur des données réelles.",
      de: "Das Team aktiv, mit einem operativen Agenten an echten Daten.",
      pt: "A equipa ativa, com um agente operacional a trabalhar sobre dados reais.",
      hu: "Az aktív csapat, valós adatokon dolgozó operatív ügynökkel.",
    },
    caption: {
      en: "A running container is not enough: the proof is work on real data.",
      it: "Un container acceso non basta: la prova è il lavoro su dati reali.",
      es: "Un contenedor en marcha no basta: la prueba es el trabajo sobre datos reales.",
      fr: "Un conteneur qui tourne ne suffit pas : la preuve, c'est le travail sur des données réelles.",
      de: "Ein laufender Container reicht nicht: Der Beweis ist Arbeit an echten Daten.",
      pt: "Um contentor a correr não chega: a prova é o trabalho sobre dados reais.",
      hu: "A futó konténer nem elég: a bizonyíték a valós adatokon végzett munka.",
    },
    assets: {},
    pending:
      "Team attivo con un agente operativo oltre l'Assistente, su dati reali. Una simulazione non prova questo stato.",
  },
  {
    id: "W01-local-account-entry",
    alt: {
      en: "The account panel before linking, in local or guest mode.",
      it: "Il pannello account prima del collegamento, in modalità locale o ospite.",
      es: "El panel de cuenta antes de vincular, en modo local o invitado.",
      fr: "Le panneau du compte avant la liaison, en mode local ou invité.",
      de: "Das Kontofenster vor der Verknüpfung, im lokalen oder Gastmodus.",
      pt: "O painel de conta antes da ligação, em modo local ou convidado.",
      hu: "A fiókpanel a összekapcsolás előtt, helyi vagy vendég módban.",
    },
    caption: {
      en: "The sign-in control stays unavailable until the container is running.",
      it: "Il comando di accesso resta indisponibile finché il container non è in funzione.",
      es: "El control de inicio de sesión no está disponible hasta que el contenedor esté en marcha.",
      fr: "La commande de connexion reste indisponible tant que le conteneur ne tourne pas.",
      de: "Die Anmeldeschaltfläche bleibt gesperrt, solange der Container nicht läuft.",
      pt: "O comando de início de sessão fica indisponível até o contentor estar a correr.",
      hu: "A bejelentkezés gombja addig nem elérhető, amíg a konténer nem fut.",
    },
    assets: {},
    pending:
      "Da rifare con l'app 0.4 su Mac, dati finti, build 2. File: web/public/setup-guide/W01-local-account-entry-macos.png (3024×1898 px); poi rimettere la voce in assets.",
  },
  {
    id: "W02-google-login",
    alt: {
      en: "The pairing instructions for signing in with Google.",
      it: "Le istruzioni di abbinamento per l'accesso con Google.",
      es: "Las instrucciones de emparejamiento para iniciar sesión con Google.",
      fr: "Les instructions d'appairage pour la connexion avec Google.",
      de: "Die Kopplungsanweisungen für die Anmeldung mit Google.",
      pt: "As instruções de emparelhamento para iniciar sessão com a Google.",
      hu: "A párosítási útmutató a Google-bejelentkezéshez.",
    },
    caption: {
      en: "The link opens in your browser; the one-time code stays here.",
      it: "Il link si apre nel browser; il codice usa e getta resta qui.",
      es: "El enlace se abre en el navegador; el código de un solo uso se queda aquí.",
      fr: "Le lien s'ouvre dans le navigateur ; le code à usage unique reste ici.",
      de: "Der Link öffnet den Browser; der Einmalcode bleibt hier.",
      pt: "O link abre no navegador; o código de uso único fica aqui.",
      hu: "A hivatkozás a böngészőben nyílik; az egyszer használatos kód itt marad.",
    },
    assets: {},
    pending:
      "Tolta: il login web è congelato e la 0.4 non ha Windows. Nessuna ripresa da fare.",
  },
  {
    id: "W03-permissions",
    alt: {
      en: "The device approval screen on the web.",
      it: "La schermata di approvazione del dispositivo sul web.",
      es: "La pantalla de aprobación del dispositivo en la web.",
      fr: "L'écran d'approbation de l'appareil sur le web.",
      de: "Der Bildschirm zur Gerätefreigabe im Web.",
      pt: "O ecrã de aprovação do dispositivo na web.",
      hu: "Az eszköz jóváhagyási képernyője a weben.",
    },
    caption: {
      en: "What you approve is one revocable device token — never your password.",
      it: "Quello che approvi è un token di dispositivo revocabile, mai la tua password.",
      es: "Lo que apruebas es un token de dispositivo revocable, nunca tu contraseña.",
      fr: "Ce que vous approuvez est un jeton d'appareil révocable, jamais votre mot de passe.",
      de: "Du genehmigst ein widerrufbares Gerätetoken — nie dein Passwort.",
      pt: "O que aprovas é um token de dispositivo revogável, nunca a tua palavra-passe.",
      hu: "Amit jóváhagysz, az egy visszavonható eszköztoken — soha nem a jelszavad.",
    },
    assets: {},
    pending:
      "Stato di approvazione dispositivo, senza email, avatar, identificativo di dispositivo o codice.",
  },
  {
    id: "W04a-local-linked",
    alt: {
      en: "The account panel showing the connected and paired state.",
      it: "Il pannello account con lo stato collegato e abbinato.",
      es: "El panel de cuenta con el estado conectado y emparejado.",
      fr: "Le panneau du compte affichant l'état connecté et appairé.",
      de: "Das Kontofenster mit verbundenem und gekoppeltem Status.",
      pt: "O painel de conta com o estado ligado e emparelhado.",
      hu: "A fiókpanel a csatlakoztatott és párosított állapottal.",
    },
    caption: {
      en: "Both states must read connected and paired, not one of the two.",
      it: "Entrambi gli stati devono dire collegato e abbinato, non uno solo dei due.",
      es: "Ambos estados deben indicar conectado y emparejado, no solo uno.",
      fr: "Les deux états doivent indiquer connecté et appairé, pas un seul.",
      de: "Beide Status müssen verbunden und gekoppelt zeigen, nicht nur einer.",
      pt: "Ambos os estados devem indicar ligado e emparelhado, não só um.",
      hu: "Mindkét állapotnak csatlakoztatottat és párosítottat kell mutatnia, nem csak az egyiknek.",
    },
    assets: {},
    pending: "Pannello account collegato, con dati sintetici.",
  },
  {
    id: "W04b-dashboard-synced",
    alt: {
      en: "The web dashboard with the sync mark and a recent sync time.",
      it: "La dashboard web con il segno di sincronizzazione e un orario recente.",
      es: "El panel web con la marca de sincronización y una hora reciente.",
      fr: "Le tableau de bord web avec la marque de synchronisation et une heure récente.",
      de: "Das Web-Dashboard mit Sync-Kennzeichen und einer aktuellen Uhrzeit.",
      pt: "O painel web com a marca de sincronização e uma hora recente.",
      hu: "A webes irányítópult a szinkronjelöléssel és friss időponttal.",
    },
    caption: {
      en: "Same positions, same profile, on the app and on the dashboard.",
      it: "Stesse posizioni, stesso profilo, sull'app e sulla dashboard.",
      es: "Las mismas posiciones y el mismo perfil, en la aplicación y en el panel.",
      fr: "Mêmes offres, même profil, dans l'application et sur le tableau de bord.",
      de: "Dieselben Stellen, dasselbe Profil — in der App und im Dashboard.",
      pt: "As mesmas posições e o mesmo perfil, na aplicação e no painel.",
      hu: "Ugyanazok a pozíciók, ugyanaz a profil az alkalmazásban és az irányítópulton.",
    },
    assets: {},
    pending:
      "Dashboard sincronizzata con dati sintetici. Il contratto vuole due immagini separate, non app e browser nello stesso frame.",
  },
];

/** Le schermate indicizzate per id. */
export const SCREENS: Record<string, GuideScreen> = Object.fromEntries(
  SCREEN_LIST.map((screen) => [screen.id, screen]),
);

/** Schermate senza nemmeno un file. */
export function pendingScreens(): GuideScreen[] {
  return SCREEN_LIST.filter(
    (screen) => Object.keys(screen.assets).length === 0,
  );
}

/**
 * Le riprese che mancano, come coppie `schermata → sistema`.
 *
 * Contare le schermate senza alcun file non basta più: da quando Linux
 * consegna, `S02` ha il suo file e sparirebbe dal conto pur mancando su
 * macOS e Windows. Qui una schermata è coperta per un sistema se ha la sua
 * variante oppure una `shared`; il chiamante passa, per ciascuna, i sistemi
 * in cui compare davvero — una fase riservata a Linux non deve far
 * risultare mancanti riprese macOS e Windows che nessuno vedrà mai.
 */
export function missingCaptures(
  usage: Map<string, OsId[]>,
): { screenId: string; os: OsId }[] {
  const out: { screenId: string; os: OsId }[] = [];
  for (const [screenId, systems] of usage) {
    const screen = SCREENS[screenId];
    // Una superficie nativa non è una ripresa mancante: non c'è nulla da
    // girare. Il guard sta qui e non solo nei chiamanti, così il conto
    // resta giusto anche se un domani una fase tornasse a referenziarla.
    if (!screen || screen.nativeSurface || screen.assets.shared) continue;
    for (const os of systems) {
      if (!screen.assets[os]) out.push({ screenId, os });
    }
  }
  return out;
}
