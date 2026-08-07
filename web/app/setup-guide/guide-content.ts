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
    title: {
      en: "Set up Job Hunter Team",
      it: "Configura Job Hunter Team",
      es: "Configura Job Hunter Team",
      fr: "Configurez Job Hunter Team",
      de: "Job Hunter Team einrichten",
      pt: "Configura o Job Hunter Team",
      hu: "Állítsd be a Job Hunter Teamet",
    },
    summary: {
      en: "Download Job Hunter Team Desktop, connect your AI subscription, add your CV, and start a working team. Choose your operating system; each chapter shows the exact screen you should see.",
      it: "Scarica Job Hunter Team Desktop, collega il tuo abbonamento AI, aggiungi il CV e avvia un team operativo. Scegli il sistema operativo: ogni capitolo mostra la schermata esatta che dovresti vedere.",
      es: "Descarga Job Hunter Team Desktop, conecta tu suscripción de AI, añade tu CV e inicia un equipo operativo. Elige tu sistema operativo: cada capítulo muestra la pantalla exacta que deberías ver.",
      fr: "Téléchargez Job Hunter Team Desktop, connectez votre abonnement AI, ajoutez votre CV et démarrez une équipe opérationnelle. Choisissez votre système d’exploitation : chaque chapitre montre l’écran exact que vous devriez voir.",
      de: "Lade Job Hunter Team Desktop herunter, verbinde dein AI-Abonnement, füge deinen Lebenslauf hinzu und starte ein einsatzbereites Team. Wähle dein Betriebssystem; jedes Kapitel zeigt genau den Bildschirm, den du sehen solltest.",
      pt: "Transfere o Job Hunter Team Desktop, liga a tua subscrição de AI, adiciona o teu CV e inicia uma equipa operacional. Escolhe o sistema operativo: cada capítulo mostra o ecrã exato que deverás ver.",
      hu: "Töltsd le a Job Hunter Team Desktopot, csatlakoztasd az AI-előfizetésedet, add hozzá az önéletrajzodat, és indíts el egy működő csapatot. Válaszd ki az operációs rendszeredet; minden fejezet pontosan azt a képernyőt mutatja, amelyet látnod kell.",
    },
    phases: [
      {
        id: "choose-setup-path",
        os: "all",
        title: {
          en: "Choose your setup path",
          it: "Scegli il tuo percorso di configurazione",
          es: "Elige tu ruta de configuración",
          fr: "Choisissez votre parcours de configuration",
          de: "Wähle deinen Einrichtungsweg",
          pt: "Escolhe o teu percurso de configuração",
          hu: "Válaszd ki a beállítási útvonalat",
        },
        body: {
          en: "Choose macOS, Windows, or Linux, then use the chapter index to move through Setup, Start, and Connect to web. The selected operating system stays active across every chapter.",
          it: "Scegli macOS, Windows o Linux, quindi usa l’indice dei capitoli per passare da Configurazione ad Avvio e Collegamento al web. Il sistema operativo selezionato resta attivo in ogni capitolo.",
          es: "Elige macOS, Windows o Linux y usa el índice de capítulos para avanzar por Configuración, Inicio y Conexión con la web. El sistema operativo seleccionado permanece activo en todos los capítulos.",
          fr: "Choisissez macOS, Windows ou Linux, puis utilisez l’index des chapitres pour parcourir Configuration, Démarrage et Connexion au web. Le système d’exploitation sélectionné reste actif dans chaque chapitre.",
          de: "Wähle macOS, Windows oder Linux und navigiere dann über den Kapitelindex durch Einrichtung, Start und Web-Verbindung. Das ausgewählte Betriebssystem bleibt in jedem Kapitel aktiv.",
          pt: "Escolhe macOS, Windows ou Linux e usa o índice de capítulos para percorreres Configuração, Início e Ligação à web. O sistema operativo selecionado mantém-se ativo em todos os capítulos.",
          hu: "Válaszd a macOS, Windows vagy Linux rendszert, majd a fejezetmutatóval haladj végig a Beállítás, Indítás és Csatlakozás a webhez részeken. A kiválasztott operációs rendszer minden fejezetben aktív marad.",
        },
        // Nessuna schermata: il selettore OS e l'indice dei capitoli sono
        // dal vivo appena sopra questa fase. Mostrare qui una foto della
        // pagina che il lettore sta già guardando non aggiungerebbe nulla
        // — decisione di HQ-DOCS del 7 agosto 2026, che ha cancellato la
        // richiesta PNG di `G00` e il suo duplicato mobile.
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
        // Superficie nativa: HQ-DOCS ha cancellato la richiesta PNG di S01.
        // Il contenuto resta responsive e traducibile nella RequirementsCard.
        card: "requirements",
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
        title: {
          en: "Install Docker Desktop on macOS",
          it: "Installa Docker Desktop su macOS",
          es: "Instala Docker Desktop en macOS",
          fr: "Installez Docker Desktop sous macOS",
          de: "Docker Desktop unter macOS installieren",
          pt: "Instala o Docker Desktop no macOS",
          hu: "Telepítsd a Docker Desktopot macOS-re",
        },
        body: {
          en: "Job Hunter Team runs the local team in Docker. If Docker is not installed, download Docker Desktop from the official macOS instructions, install it, and start it before continuing.",
          it: "Job Hunter Team esegue il team locale in Docker. Se Docker non è installato, scarica Docker Desktop dalle istruzioni ufficiali per macOS, installalo e avvialo prima di continuare.",
          es: "Job Hunter Team ejecuta el equipo local en Docker. Si Docker no está instalado, descarga Docker Desktop desde las instrucciones oficiales para macOS, instálalo e inícialo antes de continuar.",
          fr: "Job Hunter Team exécute l’équipe locale dans Docker. Si Docker n’est pas installé, téléchargez Docker Desktop depuis les instructions officielles pour macOS, installez-le et démarrez-le avant de continuer.",
          de: "Job Hunter Team führt das lokale Team in Docker aus. Wenn Docker nicht installiert ist, lade Docker Desktop über die offizielle macOS-Anleitung herunter, installiere und starte es, bevor du fortfährst.",
          pt: "O Job Hunter Team executa a equipa local no Docker. Se o Docker não estiver instalado, transfere o Docker Desktop a partir das instruções oficiais para macOS, instala-o e inicia-o antes de continuares.",
          hu: "A Job Hunter Team Dockerben futtatja a helyi csapatot. Ha a Docker nincs telepítve, töltsd le a Docker Desktopot a hivatalos macOS-útmutatóból, telepítsd és indítsd el, mielőtt folytatnád.",
        },
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.macos,
            label: {
              en: "Get Docker Desktop for Mac",
              it: "Scarica Docker Desktop per Mac",
              es: "Descarga Docker Desktop para Mac",
              fr: "Télécharger Docker Desktop pour Mac",
              de: "Docker Desktop für Mac herunterladen",
              pt: "Transfere o Docker Desktop para Mac",
              hu: "Docker Desktop letöltése Macre",
            },
          },
        ],
      },
      {
        id: "install-docker-windows",
        os: ["windows"],
        title: {
          en: "Install Docker Desktop on Windows",
          it: "Installa Docker Desktop su Windows",
          es: "Instala Docker Desktop en Windows",
          fr: "Installez Docker Desktop sous Windows",
          de: "Docker Desktop unter Windows installieren",
          pt: "Instala o Docker Desktop no Windows",
          hu: "Telepítsd a Docker Desktopot Windowsra",
        },
        body: {
          en: "Job Hunter Team runs the local team in Docker. If Docker is not installed, download Docker Desktop from the official Windows instructions, install it, and start it before continuing.",
          it: "Job Hunter Team esegue il team locale in Docker. Se Docker non è installato, scarica Docker Desktop dalle istruzioni ufficiali per Windows, installalo e avvialo prima di continuare.",
          es: "Job Hunter Team ejecuta el equipo local en Docker. Si Docker no está instalado, descarga Docker Desktop desde las instrucciones oficiales para Windows, instálalo e inícialo antes de continuar.",
          fr: "Job Hunter Team exécute l’équipe locale dans Docker. Si Docker n’est pas installé, téléchargez Docker Desktop depuis les instructions officielles pour Windows, installez-le et démarrez-le avant de continuer.",
          de: "Job Hunter Team führt das lokale Team in Docker aus. Wenn Docker nicht installiert ist, lade Docker Desktop über die offizielle Windows-Anleitung herunter, installiere und starte es, bevor du fortfährst.",
          pt: "O Job Hunter Team executa a equipa local no Docker. Se o Docker não estiver instalado, transfere o Docker Desktop a partir das instruções oficiais para Windows, instala-o e inicia-o antes de continuares.",
          hu: "A Job Hunter Team Dockerben futtatja a helyi csapatot. Ha a Docker nincs telepítve, töltsd le a Docker Desktopot a hivatalos Windows-útmutatóból, telepítsd és indítsd el, mielőtt folytatnád.",
        },
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.windows,
            label: {
              en: "Get Docker Desktop for Windows",
              it: "Scarica Docker Desktop per Windows",
              es: "Descarga Docker Desktop para Windows",
              fr: "Télécharger Docker Desktop pour Windows",
              de: "Docker Desktop für Windows herunterladen",
              pt: "Transfere o Docker Desktop para Windows",
              hu: "Docker Desktop letöltése Windowsra",
            },
          },
        ],
      },
      {
        id: "install-docker-linux",
        os: ["linux"],
        title: {
          en: "Install Docker Engine on Linux",
          it: "Installa Docker Engine su Linux",
          es: "Instala Docker Engine en Linux",
          fr: "Installez Docker Engine sous Linux",
          de: "Docker Engine unter Linux installieren",
          pt: "Instala o Docker Engine no Linux",
          hu: "Telepítsd a Docker Engine-t Linuxra",
        },
        body: {
          en: "Job Hunter Team runs the local team in Docker. If Docker is not installed, choose your distribution in the official Docker Engine instructions, install it, and start it before continuing.",
          it: "Job Hunter Team esegue il team locale in Docker. Se Docker non è installato, scegli la tua distribuzione nelle istruzioni ufficiali di Docker Engine, installalo e avvialo prima di continuare.",
          es: "Job Hunter Team ejecuta el equipo local en Docker. Si Docker no está instalado, elige tu distribución en las instrucciones oficiales de Docker Engine, instálalo e inícialo antes de continuar.",
          fr: "Job Hunter Team exécute l’équipe locale dans Docker. Si Docker n’est pas installé, choisissez votre distribution dans les instructions officielles de Docker Engine, installez-le et démarrez-le avant de continuer.",
          de: "Job Hunter Team führt das lokale Team in Docker aus. Wenn Docker nicht installiert ist, wähle deine Distribution in der offiziellen Anleitung zu Docker Engine aus, installiere und starte es, bevor du fortfährst.",
          pt: "O Job Hunter Team executa a equipa local no Docker. Se o Docker não estiver instalado, escolhe a tua distribuição nas instruções oficiais do Docker Engine, instala-o e inicia-o antes de continuares.",
          hu: "A Job Hunter Team Dockerben futtatja a helyi csapatot. Ha a Docker nincs telepítve, válaszd ki a disztribúciódat a Docker Engine hivatalos útmutatójában, telepítsd és indítsd el, mielőtt folytatnád.",
        },
        screen: { screenId: "S02-docker-download" },
        links: [
          {
            kind: "external",
            href: DOCKER_URL.linux,
            label: {
              en: "Get Docker Engine for Linux",
              it: "Scarica Docker Engine per Linux",
              es: "Descarga Docker Engine para Linux",
              fr: "Télécharger Docker Engine pour Linux",
              de: "Docker Engine für Linux herunterladen",
              pt: "Transfere o Docker Engine para Linux",
              hu: "Docker Engine letöltése Linuxra",
            },
          },
        ],
      },
      {
        id: "download-desktop-app",
        os: "all",
        title: {
          en: "Download Job Hunter Team Desktop",
          it: "Scarica Job Hunter Team Desktop",
          es: "Descarga Job Hunter Team Desktop",
          fr: "Téléchargez Job Hunter Team Desktop",
          de: "Job Hunter Team Desktop herunterladen",
          pt: "Transfere o Job Hunter Team Desktop",
          hu: "Töltsd le a Job Hunter Team Desktopot",
        },
        body: {
          en: "Download the latest package for your operating system from the official GitHub Release. On Windows, the installer is the primary choice and the portable executable is available when you do not want to install it.",
          it: "Scarica dalla GitHub Release ufficiale il pacchetto più recente per il tuo sistema operativo. Su Windows, l’installer è la scelta principale; se non vuoi installarlo, è disponibile anche l’eseguibile portatile.",
          es: "Descarga desde la GitHub Release oficial el paquete más reciente para tu sistema operativo. En Windows, el instalador es la opción principal; si no quieres instalarlo, también está disponible el ejecutable portátil.",
          fr: "Téléchargez depuis la GitHub Release officielle le paquet le plus récent pour votre système d’exploitation. Sous Windows, l’installateur est le choix principal ; si vous ne souhaitez pas l’installer, l’exécutable portable est également disponible.",
          de: "Lade das neueste Paket für dein Betriebssystem aus dem offiziellen GitHub Release herunter. Unter Windows ist der Installer die erste Wahl; wenn du nichts installieren möchtest, steht auch die portable ausführbare Datei bereit.",
          pt: "Transfere da GitHub Release oficial o pacote mais recente para o teu sistema operativo. No Windows, o instalador é a opção principal; se não o quiseres instalar, também está disponível o executável portátil.",
          hu: "Töltsd le az operációs rendszeredhez tartozó legújabb csomagot a hivatalos GitHub Release-ből. Windowson a telepítő az elsődleges választás; ha nem szeretnéd telepíteni, a hordozható futtatható fájl is elérhető.",
        },
        screen: { screenId: "S03-artifact-download" },
        links: [
          {
            kind: "download",
            os: ["macos"],
            label: {
              en: "Download for macOS",
              it: "Scarica per macOS",
              es: "Descarga para macOS",
              fr: "Télécharger pour macOS",
              de: "Für macOS herunterladen",
              pt: "Transfere para macOS",
              hu: "Letöltés macOS-re",
            },
          },
          {
            kind: "download",
            os: ["windows"],
            label: {
              en: "Download the Windows installer",
              it: "Scarica l’installer per Windows",
              es: "Descarga el instalador para Windows",
              fr: "Télécharger l’installateur Windows",
              de: "Windows-Installer herunterladen",
              pt: "Transfere o instalador para Windows",
              hu: "Windows-telepítő letöltése",
            },
          },
          {
            kind: "download",
            os: ["windows"],
            asset: ALT_ASSET.windowsPortable,
            label: {
              en: "Download Windows portable",
              it: "Scarica la versione portatile per Windows",
              es: "Descarga la versión portátil para Windows",
              fr: "Télécharger la version portable pour Windows",
              de: "Portable Windows-Version herunterladen",
              pt: "Transfere a versão portátil para Windows",
              hu: "Hordozható Windows-verzió letöltése",
            },
          },
          {
            kind: "download",
            os: ["linux"],
            label: {
              en: "Download for Linux",
              it: "Scarica per Linux",
              es: "Descarga para Linux",
              fr: "Télécharger pour Linux",
              de: "Für Linux herunterladen",
              pt: "Transfere para Linux",
              hu: "Letöltés Linuxra",
            },
          },
        ],
      },
      {
        id: "install-macos",
        os: ["macos"],
        title: {
          en: "Install on macOS",
          it: "Installa su macOS",
          es: "Instala en macOS",
          fr: "Installez sous macOS",
          de: "Unter macOS installieren",
          pt: "Instala no macOS",
          hu: "Telepítsd macOS-re",
        },
        body: {
          en: "Open job-hunter-team.zip, then open the extracted Job Hunter Team app. The current macOS build is signed and notarized.",
          it: "Apri job-hunter-team.zip, quindi apri l’app Job Hunter Team estratta. La build attuale per macOS è firmata e notarizzata.",
          es: "Abre job-hunter-team.zip y, después, la aplicación Job Hunter Team extraída. La compilación actual para macOS está firmada y notarizada.",
          fr: "Ouvrez job-hunter-team.zip, puis l’app Job Hunter Team extraite. La version actuelle pour macOS est signée et notariée.",
          de: "Öffne job-hunter-team.zip und anschließend die entpackte Job-Hunter-Team-App. Der aktuelle macOS-Build ist signiert und notarisiert.",
          pt: "Abre job-hunter-team.zip e depois a app Job Hunter Team extraída. A build atual para macOS está assinada e notarizada.",
          hu: "Nyisd meg a job-hunter-team.zip fájlt, majd a kibontott Job Hunter Team alkalmazást. A jelenlegi macOS-build aláírt és az Apple által hitelesített.",
        },
        screen: { screenId: "S04-installation-macos" },
      },
      {
        id: "install-windows",
        os: ["windows"],
        title: {
          en: "Open on Windows",
          it: "Apri su Windows",
          es: "Abre en Windows",
          fr: "Ouvrez sous Windows",
          de: "Unter Windows öffnen",
          pt: "Abre no Windows",
          hu: "Nyisd meg Windowson",
        },
        body: {
          en: "Windows offers two official paths. Run job-hunter-team-windows-x64-setup.exe to install it, or download the portable executable and open it directly. This guide shows the portable path. Continue through a SmartScreen warning only when the file came from the official GitHub Release.",
          it: "Windows offre due percorsi ufficiali. Esegui job-hunter-team-windows-x64-setup.exe per installarlo, oppure scarica l’eseguibile portatile e aprilo direttamente. Questa guida mostra il percorso portatile. Supera un avviso di SmartScreen solo se il file proviene dalla GitHub Release ufficiale.",
          es: "Windows ofrece dos rutas oficiales. Ejecuta job-hunter-team-windows-x64-setup.exe para instalarlo, o descarga el ejecutable portátil y ábrelo directamente. Esta guía muestra la ruta portátil. Continúa tras una advertencia de SmartScreen solo si el archivo procede de la GitHub Release oficial.",
          fr: "Windows propose deux parcours officiels. Exécutez job-hunter-team-windows-x64-setup.exe pour l’installer, ou téléchargez l’exécutable portable et ouvrez-le directement. Ce guide présente le parcours portable. Ne passez un avertissement SmartScreen que si le fichier provient de la GitHub Release officielle.",
          de: "Unter Windows gibt es zwei offizielle Wege. Führe job-hunter-team-windows-x64-setup.exe aus, um die App zu installieren, oder lade die portable ausführbare Datei herunter und öffne sie direkt. Diese Anleitung zeigt den portablen Weg. Fahre nach einer SmartScreen-Warnung nur fort, wenn die Datei aus dem offiziellen GitHub Release stammt.",
          pt: "O Windows oferece dois percursos oficiais. Executa job-hunter-team-windows-x64-setup.exe para instalar a app, ou transfere o executável portátil e abre-o diretamente. Este guia mostra o percurso portátil. Avança perante um aviso do SmartScreen apenas se o ficheiro vier da GitHub Release oficial.",
          hu: "A Windows két hivatalos útvonalat kínál. A telepítéshez futtasd a job-hunter-team-windows-x64-setup.exe fájlt, vagy töltsd le a hordozható futtatható fájlt, és nyisd meg közvetlenül. Ez az útmutató a hordozható útvonalat mutatja. SmartScreen-figyelmeztetésen csak akkor lépj tovább, ha a fájl a hivatalos GitHub Release-ből származik.",
        },
        screen: { screenId: "S04-installation-windows" },
      },
      {
        id: "install-linux",
        os: ["linux"],
        title: {
          en: "Install on Linux",
          it: "Installa su Linux",
          es: "Instala en Linux",
          fr: "Installez sous Linux",
          de: "Unter Linux installieren",
          pt: "Instala no Linux",
          hu: "Telepítsd Linuxra",
        },
        body: {
          en: "Extract job-hunter-team-linux-x64.tar.gz. Allow job-hunter-team.x86_64 to run, enable its executable permission if needed, and open it.",
          it: "Estrai job-hunter-team-linux-x64.tar.gz. Consenti l’esecuzione di job-hunter-team.x86_64, abilita il permesso di esecuzione se necessario e aprilo.",
          es: "Extrae job-hunter-team-linux-x64.tar.gz. Permite que se ejecute job-hunter-team.x86_64, activa el permiso de ejecución si es necesario y ábrelo.",
          fr: "Extrayez job-hunter-team-linux-x64.tar.gz. Autorisez l’exécution de job-hunter-team.x86_64, activez son droit d’exécution si nécessaire, puis ouvrez-le.",
          de: "Entpacke job-hunter-team-linux-x64.tar.gz. Erlaube die Ausführung von job-hunter-team.x86_64, setze bei Bedarf die Ausführungsberechtigung und öffne die Datei.",
          pt: "Extrai job-hunter-team-linux-x64.tar.gz. Permite a execução de job-hunter-team.x86_64, ativa a permissão de execução se necessário e abre-o.",
          hu: "Csomagold ki a job-hunter-team-linux-x64.tar.gz fájlt. Engedélyezd a job-hunter-team.x86_64 futtatását, szükség esetén állítsd be a végrehajtási jogosultságát, majd nyisd meg.",
        },
        screen: { screenId: "S04-installation-linux" },
      },
      {
        id: "open-for-the-first-time",
        os: "all",
        title: {
          en: "Open Job Hunter Team",
          it: "Apri Job Hunter Team",
          es: "Abre Job Hunter Team",
          fr: "Ouvrez Job Hunter Team",
          de: "Job Hunter Team öffnen",
          pt: "Abre o Job Hunter Team",
          hu: "Nyisd meg a Job Hunter Teamet",
        },
        body: {
          en: "On a clean first launch, Job Hunter Team opens with the language picker before the title screen.",
          it: "Al primo avvio pulito, Job Hunter Team mostra il selettore della lingua prima della schermata del titolo.",
          es: "En un primer inicio limpio, Job Hunter Team muestra el selector de idioma antes de la pantalla de título.",
          fr: "Lors d’un premier lancement propre, Job Hunter Team affiche le sélecteur de langue avant l’écran titre.",
          de: "Bei einem sauberen ersten Start zeigt Job Hunter Team vor dem Titelbildschirm die Sprachauswahl an.",
          pt: "Num primeiro arranque limpo, o Job Hunter Team mostra o seletor de idioma antes do ecrã de título.",
          hu: "Tiszta első indításkor a Job Hunter Team a címképernyő előtt megjeleníti a nyelvválasztót.",
        },
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
