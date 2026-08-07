// Capitoli e fasi della guida di setup.
//
// FONTE UNICA: il contratto di HQ-DOCS,
// `docs/internal/2026-08-07-setup-guide-content-contract.md`. Id, titoli,
// corpi, link e id delle schermate sono i suoi, adottati alla radice: non
// esiste una seconda nomenclatura da mappare, e i file che i collaudatori
// consegnano si agganciano da soli perché il nome contiene già l'id.
//
// I quattro capitoli sono i quattro blocchi del contratto: l'indice della
// guida (dal download al primo avvio), la schermata di setup, la schermata
// di avvio, e il collegamento fra team locale e web.
//
// TRADUZIONI: i testi che arrivano dal contratto sono inglesi e passano da
// `untranslated()` finché HQ-FULLSTACK-1 non li traduce — la lacuna è
// esplicita e cercabile, invece di sembrare già fatta. Alt text e didascalie
// delle schermate (`guide-screens.ts`) e il microcopy della pagina
// (`guide-ui.i18n.ts`) sono invece tradotti davvero in tutte e sette.
//
// ⚠️ I requisiti di `check-requirements` sono NUMERI MISURATI. La regola
// dell'operatore: se un numero non è stato misurato, non si scrive. Per
// questo il testo dice esplicitamente che non esiste un minimo di disco —
// quella frase non si taglia per brevità, è la parte più onesta del testo.

import {
  ALT_ASSET,
  CLOUD_SYNC_SETTINGS,
  DASHBOARD,
  DOCKER_URL,
  DOCS_VPS,
  PRICING,
} from "./guide-config";
import { DOCS_TEAM_GMAIL, PRIVACY } from "./guide-config";
import { untranslated, type GuideChapter } from "./guide-types";

/** Segnaposto delle fasi `W02`–`W04`, dal contratto. Dice una cosa diversa
 *  dallo slot generico: non «la stiamo rigirando», ma «arriverà quando ci
 *  sarà un account di prova approvato». */
const GOOGLE_SCREEN_PLACEHOLDER = {
  title: {
    en: "Screenshot pending",
    it: "Screenshot in attesa",
    es: "Captura de pantalla pendiente",
    fr: "Capture d’écran en attente",
    de: "Screenshot ausstehend",
    pt: "Captura de ecrã pendente",
    hu: "Képernyőkép függőben",
  },
  body: {
    en: "This step is fully described below. A privacy-safe image will be added after an isolated Google test account is authorized.",
    it: "Questa fase è descritta per intero qui sotto. Verrà aggiunta un'immagine rispettosa della privacy dopo l'autorizzazione di un account Google di test isolato.",
    es: "Este paso se describe por completo a continuación. Se añadirá una imagen segura para la privacidad después de autorizar una cuenta de prueba de Google aislada.",
    fr: "Cette étape est entièrement décrite ci-dessous. Une image respectueuse de la vie privée sera ajoutée après l’autorisation d’un compte de test Google isolé.",
    de: "Dieser Schritt wird unten vollständig beschrieben. Ein datenschutzsicheres Bild wird hinzugefügt, nachdem ein isoliertes Google-Testkonto autorisiert wurde.",
    pt: "Esta fase está totalmente descrita abaixo. Será adicionada uma imagem que preserva a privacidade depois de ser autorizada uma conta de teste Google isolada.",
    hu: "A lépés teljes leírása alább olvasható. Adatvédelmi szempontból biztonságos kép egy elkülönített Google-tesztfiók engedélyezése után kerül ide.",
  },
};

export const GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: "guide-index",
    title: untranslated("Set up Job Hunter Team"),
    summary: untranslated(
      "Download Job Hunter Team Desktop, connect your AI subscription, add your CV, and start a working team. Choose your operating system; each chapter shows the exact screen you should see.",
    ),
    phases: [
      {
        id: "choose-setup-path",
        os: "all",
        title: untranslated("Choose your setup path"),
        body: untranslated(
          "Choose macOS, Windows, or Linux, then use the chapter index to move through Setup, Start, and Connect to web. The selected operating system stays active across every chapter.",
        ),
        screen: { screenId: "G00-guide-index" },
      },
      {
        id: "check-requirements",
        os: "all",
        title: {
          en: "Check the requirements",
          it: "Controlla i requisiti",
          es: "Comprueba los requisitos",
          fr: "Vérifiez les prérequis",
          de: "Prüfe die Voraussetzungen",
          pt: "Verifica os requisitos",
          hu: "Ellenőrizd a követelményeket",
        },
        body: {
          en: "Docker is required. For comfortable local use, keep about 8 GB of RAM available before starting the team. In a measured 30-minute Windows run, a 12 GB machine retained more than 4 GB free with the team and Job Hunter Team Desktop active; its 2013 2-core, 4-thread CPU completed the run without saturation. Make sure Docker has room for the team image; no universal disk minimum is stated because one has not been measured. You also need internet access and a supported provider subscription. A dedicated VPS uses a separate validated baseline: Ubuntu 24.04, 4 GB total RAM, 2 vCPU, 80 GB SSD, and 2 GB preventive swap.",
          it: "Docker è obbligatorio. Per un uso locale confortevole, prima di avviare il team assicurati che siano disponibili circa 8 GB di RAM. In un test misurato di 30 minuti su Windows, una macchina con 12 GB ha mantenuto più di 4 GB liberi con il team e Job Hunter Team Desktop attivi; la sua CPU del 2013 con 2 core e 4 thread ha completato il test senza saturarsi. Assicurati che Docker disponga dello spazio necessario per l'immagine del team; non viene indicato un requisito minimo universale di spazio su disco perché non è stato misurato. Servono inoltre una connessione a Internet e un abbonamento presso un provider supportato. Per una VPS dedicata vale una baseline separata e verificata: Ubuntu 24.04, 4 GB di RAM totali, 2 vCPU, SSD da 80 GB e 2 GB di spazio di swap preventivo.",
          es: "Docker es obligatorio. Para un uso local cómodo, asegúrate de tener disponibles unos 8 GB de RAM antes de iniciar el equipo. En una prueba medida de 30 minutos en Windows, una máquina con 12 GB mantuvo más de 4 GB libres con el equipo y Job Hunter Team Desktop activos; su CPU de 2013, con 2 núcleos y 4 hilos, completó la prueba sin saturarse. Asegúrate de que Docker tenga espacio para la imagen del equipo; no se indica un mínimo universal de espacio en disco porque no se ha medido. También necesitas conexión a Internet y una suscripción con un proveedor compatible. Una VPS dedicada utiliza una base de referencia separada y validada: Ubuntu 24.04, 4 GB de RAM total, 2 vCPU, SSD de 80 GB y 2 GB de swap preventivo.",
          fr: "Docker est requis. Pour une utilisation locale confortable, gardez environ 8 Go de RAM disponibles avant de démarrer l’équipe. Lors d’un essai mesuré de 30 minutes sous Windows, une machine équipée de 12 Go a conservé plus de 4 Go libres avec l’équipe et Job Hunter Team Desktop actifs ; son processeur de 2013 à 2 cœurs et 4 threads a terminé l’essai sans saturation. Vérifiez que Docker dispose d’assez d’espace pour l’image de l’équipe ; aucun minimum universel d’espace disque n’est indiqué, car il n’a pas été mesuré. Vous avez également besoin d’un accès à Internet et d’un abonnement auprès d’un fournisseur pris en charge. Un VPS dédié suit une base de référence distincte et validée : Ubuntu 24.04, 4 Go de RAM au total, 2 vCPU, un SSD de 80 Go et 2 Go de swap préventif.",
          de: "Docker ist erforderlich. Für eine komfortable lokale Nutzung sollten vor dem Start des Teams etwa 8 GB RAM verfügbar sein. In einem gemessenen 30-minütigen Windows-Test blieben auf einem Rechner mit 12 GB mehr als 4 GB frei, während das Team und Job Hunter Team Desktop aktiv waren; seine CPU aus dem Jahr 2013 mit 2 Kernen und 4 Threads absolvierte den Test, ohne an die Auslastungsgrenze zu kommen. Stelle sicher, dass Docker genügend Platz für das Docker-Image des Teams hat; ein allgemeingültiges Minimum für den Festplattenspeicher wird nicht angegeben, weil es nicht gemessen wurde. Außerdem benötigst du Internetzugang und ein Abonnement bei einem unterstützten Anbieter. Für einen dedizierten VPS gilt eine separate, validierte Basis: Ubuntu 24.04, insgesamt 4 GB RAM, 2 vCPUs, 80 GB SSD und vorsorglich 2 GB Swap.",
          pt: "O Docker é obrigatório. Para uma utilização local confortável, mantém cerca de 8 GB de RAM disponíveis antes de iniciares a equipa. Num teste medido de 30 minutos no Windows, uma máquina com 12 GB manteve mais de 4 GB livres com a equipa e o Job Hunter Team Desktop ativos; o seu processador de 2013, com 2 núcleos e 4 threads, concluiu o teste sem saturar. Garante que o Docker tem espaço para a imagem Docker da equipa; não é indicado um mínimo universal de espaço em disco porque não foi medido. Também precisas de acesso à Internet e de uma subscrição junto de um fornecedor suportado. Uma VPS dedicada utiliza uma base de referência separada e validada: Ubuntu 24.04, 4 GB de RAM total, 2 vCPU, SSD de 80 GB e 2 GB de swap preventivo.",
          hu: "A Docker szükséges. A kényelmes helyi használathoz a csapat indítása előtt legyen körülbelül 8 GB szabad RAM. Egy mért, 30 perces Windows-futtatás során egy 12 GB-os gépen több mint 4 GB maradt szabadon, miközben a csapat és a Job Hunter Team Desktop aktív volt; a gép 2013-as, 2 magos, 4 szálas processzora telítődés nélkül teljesítette a futtatást. Gondoskodj róla, hogy a Dockernek legyen elegendő helye a csapat Docker-image-éhez; általános minimális lemezterület nincs megadva, mert ilyet nem mértek. Internet-hozzáférésre és egy támogatott szolgáltatónál fennálló előfizetésre is szükséged van. Egy dedikált VPS-re külön, validált alapérték vonatkozik: Ubuntu 24.04, összesen 4 GB RAM, 2 vCPU, 80 GB-os SSD és 2 GB megelőző célú swap.",
        },
        screen: { screenId: "S01-prerequisites" },
        links: [
          {
            kind: "internal",
            href: PRICING,
            label: {
              en: "Compare supported providers",
              it: "Confronta i provider supportati",
              es: "Compara los proveedores compatibles",
              fr: "Comparez les fournisseurs pris en charge",
              de: "Unterstützte Anbieter vergleichen",
              pt: "Compara os fornecedores suportados",
              hu: "Hasonlítsd össze a támogatott szolgáltatókat",
            },
          },
          {
            kind: "internal",
            href: DOCS_VPS,
            label: {
              en: "Run 24/7 on a VPS",
              it: "Esegui il team 24/7 su una VPS",
              es: "Ejecuta el equipo 24/7 en una VPS",
              fr: "Faites tourner l’équipe 24/7 sur un VPS",
              de: "Team rund um die Uhr auf einem VPS betreiben",
              pt: "Executa a equipa 24/7 num VPS",
              hu: "Futtasd a csapatot 24/7 egy VPS-en",
            },
          },
        ],
      },
      {
        id: "install-docker-macos",
        os: ["macos"],
        title: untranslated("Install Docker Desktop on macOS"),
        body: untranslated(
          "Job Hunter Team runs the local team in Docker. If Docker is not installed, download Docker Desktop from the official macOS instructions, install it, and start it before continuing.",
        ),
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.macos,
            label: untranslated("Get Docker Desktop for Mac"),
          },
        ],
      },
      {
        id: "install-docker-windows",
        os: ["windows"],
        title: untranslated("Install Docker Desktop on Windows"),
        body: untranslated(
          "Job Hunter Team runs the local team in Docker. If Docker is not installed, download Docker Desktop from the official Windows instructions, install it, and start it before continuing.",
        ),
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.windows,
            label: untranslated("Get Docker Desktop for Windows"),
          },
        ],
      },
      {
        id: "install-docker-linux",
        os: ["linux"],
        title: untranslated("Install Docker Engine on Linux"),
        body: untranslated(
          "Job Hunter Team runs the local team in Docker. If Docker is not installed, choose your distribution in the official Docker Engine instructions, install it, and start it before continuing.",
        ),
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.linux,
            label: untranslated("Get Docker Engine for Linux"),
          },
        ],
      },
      {
        id: "download-desktop-app",
        os: "all",
        title: untranslated("Download Job Hunter Team Desktop"),
        body: untranslated(
          "Download the latest package for your operating system from the official GitHub Release. On Windows, the installer is the primary choice and the portable executable is available when you do not want to install it.",
        ),
        screen: { screenId: "S03-artifact-download" },
        links: [
          {
            kind: "download",
            os: ["macos"],
            label: untranslated("Download for macOS"),
          },
          {
            kind: "download",
            os: ["windows"],
            label: untranslated("Download the Windows installer"),
          },
          {
            kind: "download",
            os: ["windows"],
            asset: ALT_ASSET.windowsPortable,
            label: untranslated("Download Windows portable"),
          },
          {
            kind: "download",
            os: ["linux"],
            label: untranslated("Download for Linux"),
          },
        ],
      },
      {
        id: "install-macos",
        os: ["macos"],
        title: untranslated("Install on macOS"),
        body: untranslated(
          "Open job-hunter-team.zip, then open the extracted Job Hunter Team app. The current macOS build is signed and notarized.",
        ),
        screen: { screenId: "S04-installation-macos" },
      },
      {
        id: "install-windows",
        os: ["windows"],
        title: untranslated("Open on Windows"),
        body: untranslated(
          "Windows offers two official paths. Run job-hunter-team-windows-x64-setup.exe to install it, or download the portable executable and open it directly. This guide shows the portable path. Continue through a SmartScreen warning only when the file came from the official GitHub Release.",
        ),
        screen: { screenId: "S04-installation-windows" },
      },
      {
        id: "install-linux",
        os: ["linux"],
        title: untranslated("Install on Linux"),
        body: untranslated(
          "Extract job-hunter-team-linux-x64.tar.gz. Allow job-hunter-team.x86_64 to run, enable its executable permission if needed, and open it.",
        ),
        screen: { screenId: "S04-installation-linux" },
      },
      {
        id: "open-for-the-first-time",
        os: "all",
        title: untranslated("Open Job Hunter Team"),
        body: untranslated(
          "On a clean first launch, Job Hunter Team opens with the language picker before the title screen.",
        ),
        screen: { screenId: "S05-first-launch" },
      },
      {
        id: "choose-language",
        os: "all",
        title: untranslated("Choose your language"),
        body: untranslated(
          "Choose one of the seven interface languages. English is preselected on a clean first launch. Confirm the choice to save it on this device.",
        ),
        screen: { screenId: "S06-choose-language" },
      },
      {
        id: "enter-office",
        os: "all",
        title: untranslated("Enter the office"),
        body: untranslated(
          "On the title screen, the name field is optional. Enter the office when you are ready. Exploring the office does not start a live team.",
        ),
        screen: { screenId: "S07-enter-office" },
      },
    ],
  },
  {
    id: "setup-screen",
    title: untranslated("Complete the four setup checks"),
    summary: untranslated(
      "Open Activate team in Job Hunter Team Desktop. Prepare the container, connect a provider, complete your profile, and set working hours. Continue only when all four checks are ready.",
    ),
    phases: [
      {
        id: "open-setup",
        os: "all",
        title: untranslated("Open Activate team"),
        body: untranslated(
          "Select Team setup to open Activate team. A clean setup shows four incomplete checks: Container, AI provider, Profile and CV, and Working hours.",
        ),
        screen: { screenId: "S08-setup-overview-empty" },
      },
      {
        id: "start-container",
        os: "all",
        title: untranslated("Start the container"),
        body: untranslated(
          "Start the isolated workspace. On the first run Job Hunter Team Desktop checks the Docker engine, downloads the team image, and starts the JHT container. Keep it open until the container is ready.",
        ),
        screen: { screenId: "S09-start-container" },
      },
      {
        id: "choose-provider",
        os: "all",
        title: untranslated("Choose an AI provider"),
        body: untranslated(
          "Choose Claude, Codex, or Kimi and the subscription plan you already use. Job Hunter Team uses subscription login and never asks for an API key.",
        ),
        screen: { screenId: "S10-choose-provider" },
        links: [
          {
            kind: "internal",
            href: PRICING,
            label: untranslated("Compare plans"),
          },
        ],
      },
      {
        id: "authorize-provider",
        os: "all",
        title: untranslated("Authorize your subscription"),
        body: untranslated(
          "Open the embedded console and follow the provider login. A browser may open for authorization. Return when the provider screen shows Login detected.",
        ),
        screen: { screenId: "S11-authorize-provider" },
      },
      {
        id: "upload-cv",
        os: "all",
        title: untranslated("Upload your CV"),
        body: untranslated(
          "Open Profile and CV, talk to the Assistant, and upload your CV. The profile badge shows which required fields are still missing.",
        ),
        screen: { screenId: "S12-upload-cv" },
      },
      {
        id: "complete-profile",
        os: "all",
        title: untranslated("Complete your profile"),
        body: untranslated(
          "Confirm name, email, target role, location, experience, seniority, at least two skills, and at least one language. Continue when the badge shows 8/8 fields.",
        ),
        screen: { screenId: "S13-profile-ready" },
      },
      {
        id: "set-working-hours",
        os: "all",
        title: untranslated("Set working hours"),
        body: untranslated(
          "Choose when the team may work and save the schedule. Without working hours the team can run at any time and use your subscription.",
        ),
        screen: { screenId: "S14-working-hours" },
      },
      {
        id: "review-setup",
        os: "all",
        title: untranslated("Review the four checks"),
        body: untranslated(
          "Return to Activate team. Container, AI provider, Profile and CV, and Working hours must all be ready before the team can start.",
        ),
        screen: { screenId: "S15-setup-complete" },
      },
    ],
  },
  {
    id: "start-screen",
    title: untranslated("Activate the team"),
    summary: untranslated(
      "Select Activate the team and keep Job Hunter Team Desktop open while the agents start. Setup is complete only when Team active and an operational agent beyond the Assistant are visible with real, non-demo data.",
    ),
    phases: [
      {
        id: "activate-team",
        os: "all",
        title: untranslated("Activate the team"),
        body: untranslated(
          "Select Activate the team. Job Hunter Team Desktop reports the real startup phase and elapsed time; wait until startup finishes.",
        ),
        screen: { screenId: "S16-team-starting" },
      },
      {
        id: "verify-team-working",
        os: "all",
        title: untranslated("Verify that the team is working"),
        body: untranslated(
          "Confirm Team active, real data, and at least one operational agent beyond the Assistant. Open a live activity or result; a running container alone is not enough.",
        ),
        screen: { screenId: "S17-team-working" },
      },
    ],
  },
  {
    id: "local-web",
    title: untranslated("See your local team on the web"),
    summary: untranslated(
      "Optionally sync positions, profile, and commands with your private dashboard. The team can remain fully local.",
    ),
    phases: [
      {
        id: "open-account-link",
        os: "all",
        title: untranslated("Open the optional web connection"),
        body: untranslated(
          "With the container running, open Settings, then select Account under Account and channels. CLOUD ACCOUNT — local / guest mode means the team is not linked yet. The sign-in control remains unavailable until the container is running.",
        ),
        screen: { screenId: "W01-local-account-entry" },
      },
      {
        id: "sign-in-with-google",
        os: "all",
        title: {
          en: "Sign in with Google",
          it: "Accedi con Google",
          es: "Inicia sesión con Google",
          fr: "Connectez-vous avec Google",
          de: "Mit Google anmelden",
          pt: "Inicia sessão com o Google",
          hu: "Jelentkezz be Google-fiókkal",
        },
        body: {
          en: "With the container running, open Settings → Account, select Account under Account and channels, then select SIGN IN WITH GOOGLE. The embedded console shows a temporary verification link and one-time code. Open the link. The browser may show the Job Hunter Team sign-in page, Google's account chooser, and a consent screen. Select the Google account that should own your private dashboard. Do not enter the one-time code on any page whose address is not the expected Job Hunter Team site.",
          it: "Con il container in esecuzione, apri Settings → Account, seleziona Account sotto Account and channels, quindi seleziona SIGN IN WITH GOOGLE. La console incorporata mostra un link di verifica temporaneo e un codice monouso. Apri il link. Il browser potrebbe mostrare la pagina di accesso di Job Hunter Team, il selettore degli account Google e una schermata di consenso. Seleziona l’account Google che deve essere proprietario della tua dashboard privata. Non inserire il codice monouso in nessuna pagina il cui indirizzo non corrisponda al sito Job Hunter Team previsto.",
          es: "Con el contenedor en ejecución, abre Settings → Account, selecciona Account en Account and channels y, a continuación, SIGN IN WITH GOOGLE. La consola integrada muestra un enlace de verificación temporal y un código de un solo uso. Abre el enlace. El navegador puede mostrar la página de inicio de sesión de Job Hunter Team, el selector de cuentas de Google y una pantalla de consentimiento. Selecciona la cuenta de Google que debe ser propietaria de tu panel privado. No introduzcas el código de un solo uso en ninguna página cuya dirección no sea la del sitio esperado de Job Hunter Team.",
          fr: "Lorsque le conteneur fonctionne, ouvrez Settings → Account, sélectionnez Account sous Account and channels, puis SIGN IN WITH GOOGLE. La console intégrée affiche un lien de vérification temporaire et un code à usage unique. Ouvrez le lien. Le navigateur peut afficher la page de connexion de Job Hunter Team, le sélecteur de compte Google et un écran de consentement. Sélectionnez le compte Google qui doit être propriétaire de votre tableau de bord privé. Ne saisissez le code à usage unique sur aucune page dont l’adresse n’est pas celle du site Job Hunter Team attendu.",
          de: "Öffne bei laufendem Container Settings → Account, wähle unter Account and channels den Eintrag Account und dann SIGN IN WITH GOOGLE. Die eingebettete Konsole zeigt einen temporären Bestätigungslink und einen Einmalcode. Öffne den Link. Im Browser können die Anmeldeseite von Job Hunter Team, die Google-Kontoauswahl und ein Zustimmungsbildschirm erscheinen. Wähle das Google-Konto aus, dem dein privates Dashboard gehören soll. Gib den Einmalcode auf keiner Seite ein, deren Adresse nicht der erwarteten Job-Hunter-Team-Website entspricht.",
          pt: "Com o contentor em execução, abre Settings → Account, seleciona Account em Account and channels e depois SIGN IN WITH GOOGLE. A consola incorporada mostra uma ligação de verificação temporária e um código de utilização única. Abre a ligação. O navegador pode mostrar a página de início de sessão do Job Hunter Team, o seletor de contas Google e um ecrã de consentimento. Seleciona a conta Google que deverá ser proprietária do teu painel privado. Não introduzas o código de utilização única em nenhuma página cujo endereço não seja o site esperado do Job Hunter Team.",
          hu: "Futó konténer mellett nyisd meg a Settings → Account oldalt, válaszd az Account and channels alatt az Account lehetőséget, majd a SIGN IN WITH GOOGLE gombot. A beágyazott konzol egy ideiglenes ellenőrző hivatkozást és egyszer használatos kódot jelenít meg. Nyisd meg a hivatkozást. A böngészőben megjelenhet a Job Hunter Team bejelentkezési oldala, a Google-fiókválasztó és egy hozzájárulási képernyő. Válaszd ki azt a Google-fiókot, amelyhez a privát irányítópultod tartozzon. Ne írd be az egyszer használatos kódot olyan oldalra, amelynek címe nem a várt Job Hunter Team-webhelyé.",
        },
        screen: { screenId: "W02-google-login" },
        screenFallback: GOOGLE_SCREEN_PLACEHOLDER,
        links: [
          {
            kind: "internal",
            href: CLOUD_SYNC_SETTINGS,
            label: {
              en: "Cloud sync settings",
              it: "Impostazioni di sincronizzazione cloud",
              es: "Configuración de sincronización en la nube",
              fr: "Paramètres de synchronisation cloud",
              de: "Einstellungen für die Cloud-Synchronisierung",
              pt: "Definições de sincronização na cloud",
              hu: "Felhőszinkronizálási beállítások",
            },
          },
        ],
      },
      {
        id: "review-permissions",
        os: "all",
        title: {
          en: "Review access and approve this device",
          it: "Controlla gli accessi e approva questo dispositivo",
          es: "Revisa el acceso y aprueba este dispositivo",
          fr: "Vérifiez les accès et approuvez cet appareil",
          de: "Zugriffe prüfen und dieses Gerät autorisieren",
          pt: "Revê os acessos e aprova este dispositivo",
          hu: "Ellenőrizd a hozzáféréseket, és hagyd jóvá ezt az eszközt",
        },
        body: {
          en: "Before continuing, review two separate grants. Google sign-in uses only OpenID to authenticate you, email to read your primary email address and verification status, and profile to read basic information such as your display name and profile picture. Job Hunter Team requests no Google Drive, Gmail, Calendar, Contacts, or other Google product access. The optional Team Gmail setup is separate: you explicitly connect a dedicated inbox later with its own app password, stored locally, and it does not add Gmail access to this sign-in. Next, Connect the CLI asks for the one-time code and an optional token name. Confirm pairing issues this installation a revocable Job Hunter Team device token: it may sync positions and profile data to your private dashboard and receive dashboard commands for the local team. It never contains or stores your Google password or browser cookies. Continue only if the Google account and these uses are correct.",
          it: "Prima di continuare, controlla due autorizzazioni distinte. L'accesso con Google usa soltanto OpenID per autenticarti, email per leggere il tuo indirizzo email principale e il relativo stato di verifica, e profile per leggere informazioni di base come il nome visualizzato e l'immagine del profilo. Job Hunter Team non richiede accesso a Google Drive, Gmail, Calendar, Contacts o ad altri prodotti Google. La configurazione facoltativa di Team Gmail è separata: in seguito colleghi esplicitamente una casella dedicata con una propria password per l'app, memorizzata in locale, e questo non aggiunge accesso a Gmail a questo login. In seguito, Connect the CLI chiede il codice monouso e un nome facoltativo per il token. Selezionando Confirm pairing, questa installazione riceve un token dispositivo revocabile di Job Hunter Team: può sincronizzare posizioni e dati del profilo con la tua dashboard privata e ricevere dalla dashboard comandi per il team locale. Non contiene né memorizza mai la tua password Google o i cookie del browser. Continua solo se l'account Google e questi utilizzi sono corretti.",
          es: "Antes de continuar, revisa dos autorizaciones independientes. El inicio de sesión con Google usa únicamente OpenID para autenticarte, email para leer tu dirección de correo principal y su estado de verificación, y profile para leer información básica como el nombre mostrado y la foto de perfil. Job Hunter Team no solicita acceso a Google Drive, Gmail, Calendar, Contacts ni a ningún otro producto de Google. La configuración opcional de Team Gmail es independiente: más adelante conectas explícitamente un buzón dedicado con su propia contraseña de aplicación, almacenada localmente, y esto no añade acceso a Gmail a este inicio de sesión. Después, Connect the CLI solicita el código de un solo uso y un nombre opcional para el token. Al seleccionar Confirm pairing, esta instalación recibe un token de dispositivo revocable de Job Hunter Team: puede sincronizar posiciones y datos del perfil con tu panel privado y recibir desde el panel comandos para el equipo local. Nunca contiene ni almacena tu contraseña de Google ni las cookies del navegador. Continúa solo si la cuenta de Google y estos usos son correctos.",
          fr: "Avant de continuer, vérifiez deux autorisations distinctes. La connexion avec Google utilise uniquement OpenID pour vous authentifier, email pour lire votre adresse e-mail principale et son état de vérification, et profile pour lire des informations de base telles que votre nom d’affichage et votre photo de profil. Job Hunter Team ne demande aucun accès à Google Drive, Gmail, Calendar, Contacts ni à aucun autre produit Google. La configuration facultative de Team Gmail est distincte : vous connectez explicitement plus tard une boîte dédiée avec son propre mot de passe d’application, stocké localement, sans ajouter d’accès à Gmail à cette connexion. Ensuite, Connect the CLI demande le code à usage unique et un nom de jeton facultatif. Lorsque vous sélectionnez Confirm pairing, cette installation reçoit un jeton d’appareil Job Hunter Team révocable : elle peut synchroniser les postes et les données du profil avec votre tableau de bord privé et recevoir les commandes du tableau de bord destinées à l’équipe locale. Il ne contient ni ne stocke jamais votre mot de passe Google ou les cookies de votre navigateur. Continuez uniquement si le compte Google et ces utilisations sont corrects.",
          de: "Prüfe vor dem Fortfahren zwei getrennte Berechtigungen. Die Google-Anmeldung verwendet ausschließlich OpenID, um dich zu authentifizieren, email, um deine primäre E-Mail-Adresse und ihren Bestätigungsstatus zu lesen, und profile, um grundlegende Angaben wie deinen Anzeigenamen und dein Profilbild zu lesen. Job Hunter Team fordert keinen Zugriff auf Google Drive, Gmail, Calendar, Contacts oder andere Google-Produkte an. Die optionale Einrichtung von Team Gmail ist davon getrennt: Später verbindest du ausdrücklich ein eigenes Postfach mit einem eigenen, lokal gespeicherten App-Passwort; dadurch erhält diese Anmeldung keinen Gmail-Zugriff. Anschließend fragt Connect the CLI nach dem Einmalcode und einem optionalen Token-Namen. Wenn du Confirm pairing auswählst, erhält diese Installation ein widerrufbares Job-Hunter-Team-Geräte-Token: Es darf Positionen und Profildaten mit deinem privaten Dashboard synchronisieren und Dashboard-Befehle für das lokale Team empfangen. Es enthält und speichert niemals dein Google-Passwort oder Browser-Cookies. Fahre nur fort, wenn das Google-Konto und diese Verwendungen korrekt sind.",
          pt: "Antes de continuares, revê duas autorizações distintas. O início de sessão com o Google utiliza apenas OpenID para te autenticar, email para ler o teu endereço de email principal e o estado de verificação, e profile para ler informações básicas como o nome apresentado e a imagem de perfil. O Job Hunter Team não solicita acesso ao Google Drive, Gmail, Calendar, Contacts nem a qualquer outro produto Google. A configuração opcional do Team Gmail é separada: mais tarde, ligas explicitamente uma caixa de correio dedicada com a sua própria palavra-passe de aplicação, armazenada localmente, e isso não adiciona acesso ao Gmail a este início de sessão. Em seguida, Connect the CLI pede o código de utilização única e um nome opcional para o token. Ao selecionares Confirm pairing, esta instalação recebe um token de dispositivo revogável do Job Hunter Team: pode sincronizar posições e dados do perfil com o teu painel privado e receber do painel comandos para a equipa local. Nunca contém nem armazena a tua palavra-passe do Google ou os cookies do navegador. Continua apenas se a conta Google e estas utilizações estiverem corretas.",
          hu: "A folytatás előtt tekints át két külön engedélyt. A Google-bejelentkezés kizárólag az OpenID hatókört használja a hitelesítésedhez, az email hatókört az elsődleges e-mail-címed és annak ellenőrzési állapota kiolvasásához, valamint a profile hatókört az olyan alapadatok kiolvasásához, mint a megjelenített neved és a profilképed. A Job Hunter Team nem kér hozzáférést a Google Drive-hoz, a Gmailhez, a Calendarhoz, a Contactshoz vagy más Google-termékhez. Az opcionális Team Gmail-beállítás ettől elkülönül: később kifejezetten egy külön postafiókot csatlakoztatsz a saját, helyben tárolt alkalmazásjelszavával, és ez nem ad Gmail-hozzáférést ehhez a bejelentkezéshez. Ezután a Connect the CLI bekéri az egyszer használatos kódot és egy opcionális tokennevet. A Confirm pairing kiválasztásakor ez a telepítés egy visszavonható Job Hunter Team-eszköztokent kap: pozíciókat és profiladatokat szinkronizálhat a privát irányítópultoddal, valamint irányítópult-parancsokat fogadhat a helyi csapat számára. A token soha nem tartalmazza és nem tárolja a Google-jelszavadat vagy a böngésződ cookie-jait. Csak akkor folytasd, ha a Google-fiók és ezek a felhasználások megfelelőek.",
        },
        screen: { screenId: "W03-permissions" },
        screenFallback: GOOGLE_SCREEN_PLACEHOLDER,
        links: [
          {
            kind: "internal",
            href: PRIVACY,
            label: {
              en: "Privacy policy",
              it: "Informativa sulla privacy",
              es: "Política de privacidad",
              fr: "Politique de confidentialité",
              de: "Datenschutzerklärung",
              pt: "Política de privacidade",
              hu: "Adatvédelmi irányelvek",
            },
          },
          {
            kind: "internal",
            href: DOCS_TEAM_GMAIL,
            label: {
              en: "Set up a separate team inbox",
              it: "Configura una casella separata per il team",
              es: "Configura un buzón separado para el equipo",
              fr: "Configurer une boîte distincte pour l’équipe",
              de: "Separates Postfach für das Team einrichten",
              pt: "Configura uma caixa de correio separada para a equipa",
              hu: "Külön csapatpostafiók beállítása",
            },
          },
          {
            kind: "internal",
            href: CLOUD_SYNC_SETTINGS,
            label: {
              en: "Manage devices and revoke access",
              it: "Gestisci i dispositivi e revoca l'accesso",
              es: "Gestiona dispositivos y revoca el acceso",
              fr: "Gérer les appareils et révoquer l’accès",
              de: "Geräte verwalten und Zugriff widerrufen",
              pt: "Gere dispositivos e revoga o acesso",
              hu: "Eszközök kezelése és hozzáférés visszavonása",
            },
          },
        ],
      },
      {
        id: "verify-dashboard-sync",
        os: "all",
        title: {
          en: "Verify the dashboard sync",
          it: "Verifica la sincronizzazione della dashboard",
          es: "Verifica la sincronización del panel",
          fr: "Vérifiez la synchronisation du tableau de bord",
          de: "Dashboard-Synchronisierung prüfen",
          pt: "Verifica a sincronização do painel",
          hu: "Ellenőrizd az irányítópult szinkronizálását",
        },
        body: {
          en: "After Pairing complete, return to Settings → Account in Job Hunter Team Desktop. Confirm CLOUD ACCOUNT — connected and DEVICE — paired, or the safe token name you chose, then select SYNC NOW. Open the dashboard with the same Google account. ✓ Cloud sync means the local and cloud counts match; ◐ To sync means changes are still pending. Last: shows when the most recent successful sync completed. Confirm that the dashboard shows the same profile and positions as the local team. If it is empty, wait until the team has produced a scored position, select SYNC NOW again, and refresh the dashboard. If the app still says local / guest mode, repeat sign-in and pairing. You can stop future sync at any time by revoking the device under Cloud sync settings; local data is not deleted.",
          it: "Dopo Pairing complete, torna a Settings → Account in Job Hunter Team Desktop. Verifica CLOUD ACCOUNT — connected e DEVICE — paired, oppure il nome sicuro che hai scelto per il token, quindi seleziona SYNC NOW. Apri la dashboard con lo stesso account Google. ✓ Cloud sync significa che i conteggi locali e cloud coincidono; ◐ To sync significa che ci sono ancora modifiche in attesa. Last: indica quando è terminata l'ultima sincronizzazione riuscita. Verifica che la dashboard mostri lo stesso profilo e le stesse posizioni del team locale. Se è vuota, attendi che il team abbia prodotto una posizione valutata, seleziona di nuovo SYNC NOW e aggiorna la dashboard. Se l'app indica ancora local / guest mode, ripeti l'accesso e l'abbinamento. Puoi interrompere le sincronizzazioni future in qualsiasi momento revocando il dispositivo in Cloud sync settings; i dati locali non vengono eliminati.",
          es: "Después de Pairing complete, vuelve a Settings → Account en Job Hunter Team Desktop. Confirma CLOUD ACCOUNT — connected y DEVICE — paired, o el nombre seguro que elegiste para el token, y selecciona SYNC NOW. Abre el panel con la misma cuenta de Google. ✓ Cloud sync significa que los recuentos local y en la nube coinciden; ◐ To sync significa que aún hay cambios pendientes. Last: muestra cuándo terminó la sincronización correcta más reciente. Confirma que el panel muestra el mismo perfil y las mismas posiciones que el equipo local. Si está vacío, espera hasta que el equipo haya producido una posición puntuada, vuelve a seleccionar SYNC NOW y actualiza el panel. Si la aplicación todavía indica local / guest mode, repite el inicio de sesión y la vinculación. Puedes detener futuras sincronizaciones en cualquier momento revocando el dispositivo en Cloud sync settings; los datos locales no se eliminan.",
          fr: "Après Pairing complete, revenez à Settings → Account dans Job Hunter Team Desktop. Vérifiez CLOUD ACCOUNT — connected et DEVICE — paired, ou le nom sûr choisi pour le jeton, puis sélectionnez SYNC NOW. Ouvrez le tableau de bord avec le même compte Google. ✓ Cloud sync signifie que les totaux locaux et dans le cloud correspondent ; ◐ To sync signifie que des modifications sont encore en attente. Last: indique la fin de la dernière synchronisation réussie. Vérifiez que le tableau de bord affiche le même profil et les mêmes postes que l’équipe locale. S’il est vide, attendez que l’équipe ait produit un poste évalué, sélectionnez à nouveau SYNC NOW et actualisez le tableau de bord. Si l’app affiche toujours local / guest mode, recommencez la connexion et l’association. Vous pouvez arrêter les futures synchronisations à tout moment en révoquant l’appareil dans Cloud sync settings ; les données locales ne sont pas supprimées.",
          de: "Gehe nach Pairing complete in Job Hunter Team Desktop zurück zu Settings → Account. Prüfe CLOUD ACCOUNT — connected und DEVICE — paired beziehungsweise den sicheren Token-Namen, den du gewählt hast, und wähle dann SYNC NOW. Öffne das Dashboard mit demselben Google-Konto. ✓ Cloud sync bedeutet, dass die lokalen und die Cloud-Zähler übereinstimmen; ◐ To sync bedeutet, dass Änderungen noch ausstehen. Last: zeigt, wann die letzte erfolgreiche Synchronisierung abgeschlossen wurde. Prüfe, ob das Dashboard dasselbe Profil und dieselben Positionen wie das lokale Team anzeigt. Wenn es leer ist, warte, bis das Team eine bewertete Position erzeugt hat, wähle erneut SYNC NOW und aktualisiere das Dashboard. Wenn die App weiterhin local / guest mode anzeigt, wiederhole Anmeldung und Pairing. Du kannst zukünftige Synchronisierungen jederzeit beenden, indem du das Gerät unter Cloud sync settings widerrufst; lokale Daten werden nicht gelöscht.",
          pt: "Depois de Pairing complete, volta a Settings → Account no Job Hunter Team Desktop. Confirma CLOUD ACCOUNT — connected e DEVICE — paired, ou o nome seguro que escolheste para o token, e depois seleciona SYNC NOW. Abre o painel com a mesma conta Google. ✓ Cloud sync significa que as contagens local e na cloud coincidem; ◐ To sync significa que ainda há alterações pendentes. Last: mostra quando terminou a sincronização bem-sucedida mais recente. Confirma que o painel mostra o mesmo perfil e as mesmas posições que a equipa local. Se estiver vazio, espera até a equipa produzir uma posição pontuada, seleciona SYNC NOW novamente e atualiza o painel. Se a aplicação ainda indicar local / guest mode, repete o início de sessão e o emparelhamento. Podes interromper futuras sincronizações a qualquer momento revogando o dispositivo em Cloud sync settings; os dados locais não são eliminados.",
          hu: "A Pairing complete után térj vissza a Settings → Account oldalra a Job Hunter Team Desktopban. Ellenőrizd a CLOUD ACCOUNT — connected és a DEVICE — paired állapotot, illetve a választott biztonságos tokennevet, majd válaszd a SYNC NOW lehetőséget. Nyisd meg az irányítópultot ugyanazzal a Google-fiókkal. A ✓ Cloud sync azt jelenti, hogy a helyi és a felhőbeli darabszámok egyeznek; a ◐ To sync azt, hogy még vannak függőben lévő változások. A Last: a legutóbbi sikeres szinkronizálás befejezésének idejét mutatja. Ellenőrizd, hogy az irányítópult ugyanazt a profilt és ugyanazokat a pozíciókat mutatja-e, mint a helyi csapat. Ha üres, várj, amíg a csapat létrehoz egy pontozott pozíciót, válaszd újra a SYNC NOW lehetőséget, majd frissítsd az irányítópultot. Ha az alkalmazás továbbra is local / guest mode állapotot jelez, ismételd meg a bejelentkezést és a párosítást. A jövőbeli szinkronizálást bármikor leállíthatod az eszköz visszavonásával a Cloud sync settings alatt; a helyi adatok nem törlődnek.",
        },
        // Due immagini di proposito: il contratto vieta di mettere finestra
        // dell'app e browser collegato in un unico frame.
        screen: [
          { screenId: "W04a-local-linked" },
          { screenId: "W04b-dashboard-synced" },
        ],
        screenFallback: GOOGLE_SCREEN_PLACEHOLDER,
        links: [
          {
            kind: "internal",
            href: DASHBOARD,
            label: {
              en: "Open the dashboard",
              it: "Apri la dashboard",
              es: "Abre el panel",
              fr: "Ouvrir le tableau de bord",
              de: "Dashboard öffnen",
              pt: "Abre o painel",
              hu: "Irányítópult megnyitása",
            },
          },
          {
            kind: "internal",
            href: CLOUD_SYNC_SETTINGS,
            label: {
              en: "Manage devices and revoke access",
              it: "Gestisci i dispositivi e revoca l'accesso",
              es: "Gestiona dispositivos y revoca el acceso",
              fr: "Gérer les appareils et révoquer l’accès",
              de: "Geräte verwalten und Zugriff widerrufen",
              pt: "Gere dispositivos e revoga o acesso",
              hu: "Eszközök kezelése és hozzáférés visszavonása",
            },
          },
        ],
      },
    ],
  },
];
