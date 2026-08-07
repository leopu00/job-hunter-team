// Registro delle schermate della guida.
//
// Gli id sono quelli del contratto di HQ-DOCS
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
// traduzione. `S02-docker-download` compare tre volte (una per sistema),
// `S06-choose-language` due.
//
// Le schermate non ancora riprese esistono comunque come voce, con `assets`
// vuoto e `pending` che dice cosa devono mostrare: la pagina renderizza uno
// slot al posto dell'immagine, e l'elenco di ciò che manca si ricava dal
// codice invece che da una lista a parte.
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
    pending:
      "Indice della guida, uno stato per OS selezionato + G00-guide-index-mobile a 390 px.",
  },
  {
    id: "S01-prerequisites",
    alt: {
      en: "The requirement card: Docker, memory, internet and provider subscription.",
      it: "La scheda dei requisiti: Docker, memoria, internet e abbonamento al provider.",
      es: "La tarjeta de requisitos: Docker, memoria, internet y suscripción al proveedor.",
      fr: "La fiche des prérequis : Docker, mémoire, internet et abonnement au fournisseur.",
      de: "Die Voraussetzungskarte: Docker, Arbeitsspeicher, Internet und Anbieter-Abo.",
      pt: "O cartão de requisitos: Docker, memória, internet e subscrição do provedor.",
      hu: "A követelménykártya: Docker, memória, internet és szolgáltatói előfizetés.",
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
    replacedByCard:
      "La scheda è costruita nella pagina (`RequirementsCard`), non fotografata: un'immagine di tabella è illeggibile a 390 px, andrebbe rigirata per ognuna delle sette lingue e renderebbe i numeri non correggibili senza rifare la ripresa. La voce resta perché il contratto la elenca: se HQ-DOCS conferma che l'immagine non serve, si cancella.",
  },
  {
    id: "S02-docker-download",
    alt: {
      en: "The official Docker installation page for this system.",
      it: "La pagina ufficiale di installazione di Docker per questo sistema.",
      es: "La página oficial de instalación de Docker para este sistema.",
      fr: "La page officielle d'installation de Docker pour ce système.",
      de: "Die offizielle Docker-Installationsseite für dieses System.",
      pt: "A página oficial de instalação do Docker para este sistema.",
      hu: "A Docker hivatalos telepítési oldala ehhez a rendszerhez.",
    },
    caption: {
      en: "Docker Desktop on macOS and Windows, Docker Engine on Linux.",
      it: "Docker Desktop su macOS e Windows, Docker Engine su Linux.",
      es: "Docker Desktop en macOS y Windows, Docker Engine en Linux.",
      fr: "Docker Desktop sur macOS et Windows, Docker Engine sur Linux.",
      de: "Docker Desktop unter macOS und Windows, Docker Engine unter Linux.",
      pt: "Docker Desktop no macOS e Windows, Docker Engine no Linux.",
      hu: "Docker Desktop macOS-en és Windowson, Docker Engine Linuxon.",
    },
    assets: {
      linux: {
        src: "/setup-guide/S02-docker-missing-linux.png",
        width: 1920,
        height: 1080,
      },
    },
    pending:
      "Consegnata per Linux. Restano macOS e Windows: pagina Docker Desktop ufficiale. Non è una schermata dell'app — qui l'app non è ancora stata scaricata.",
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
    pending: "Download della release ufficiale, uno per OS.",
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
    pending: "App estratta su macOS, pronta all'apertura.",
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
    pending:
      "Portable scaricato e pronto, oppure la finestra inglese subito dopo l'apertura. Mai la UI localizzata dell'installer.",
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
      en: "The language picker comes before the title screen.",
      it: "La scelta della lingua viene prima della schermata del titolo.",
      es: "El selector de idioma aparece antes de la pantalla de título.",
      fr: "Le choix de la langue précède l'écran-titre.",
      de: "Die Sprachauswahl kommt vor dem Titelbildschirm.",
      pt: "O seletor de idioma aparece antes do ecrã de título.",
      hu: "A nyelvválasztó a címképernyő előtt jelenik meg.",
    },
    assets: {
      // Stesso file di S06, non una copia: il contratto ammette il riuso
      // perché il selettore lingua È la prima schermata di un avvio
      // pulito. Una voce in più nel registro, non un file in più sul
      // disco — che è esattamente a cosa serve il registro.
      linux: {
        src: "/setup-guide/S06-choose-language-linux.png",
        width: 624,
        height: 486,
      },
    },
    pending:
      "Consegnata per Linux (riusa l'asset di S06). Restano macOS e Windows.",
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
    assets: {
      linux: {
        src: "/setup-guide/S06-choose-language-linux.png",
        width: 624,
        height: 486,
      },
    },
    pending: "Consegnata per Linux. Restano macOS e Windows.",
  },
  {
    id: "S07-enter-office",
    alt: {
      en: "The title screen with the optional name field.",
      it: "La schermata del titolo con il campo nome facoltativo.",
      es: "La pantalla de título con el campo de nombre opcional.",
      fr: "L'écran-titre avec le champ de nom facultatif.",
      de: "Der Titelbildschirm mit dem optionalen Namensfeld.",
      pt: "O ecrã de título com o campo de nome opcional.",
      hu: "A címképernyő az opcionális névmezővel.",
    },
    caption: {
      en: "Looking around the office does not start a live team.",
      it: "Girare per l'ufficio non avvia nessun team vero.",
      es: "Recorrer la oficina no arranca ningún equipo real.",
      fr: "Se promener dans le bureau ne lance aucune équipe réelle.",
      de: "Sich im Büro umzusehen startet kein echtes Team.",
      pt: "Andar pelo escritório não arranca nenhuma equipa real.",
      hu: "Az irodában való körbenézés nem indít valódi csapatot.",
    },
    assets: {
      linux: {
        src: "/setup-guide/S07-enter-office-linux.png",
        width: 1920,
        height: 1080,
      },
    },
    pending: "Consegnata per Linux. Restano macOS e Windows.",
  },
  {
    id: "S08-setup-overview-empty",
    alt: {
      en: "Activate team with the four checks still incomplete.",
      it: "Attiva il team con i quattro controlli ancora incompleti.",
      es: "Activar equipo con las cuatro comprobaciones aún incompletas.",
      fr: "Activer l'équipe avec les quatre vérifications encore incomplètes.",
      de: "Team aktivieren mit den vier noch offenen Prüfungen.",
      pt: "Ativar equipa com as quatro verificações ainda incompletas.",
      hu: "Csapat aktiválása a négy még hiányzó ellenőrzéssel.",
    },
    caption: {
      en: "Container, AI provider, Profile and CV, Working hours: four checks, in order.",
      it: "Container, provider AI, profilo e CV, orari di lavoro: quattro controlli, in ordine.",
      es: "Contenedor, proveedor de AI, perfil y CV, horario: cuatro comprobaciones, en orden.",
      fr: "Conteneur, fournisseur AI, profil et CV, horaires : quatre vérifications, dans l'ordre.",
      de: "Container, AI-Anbieter, Profil und Lebenslauf, Arbeitszeiten: vier Prüfungen, der Reihe nach.",
      pt: "Contentor, provedor de AI, perfil e CV, horário: quatro verificações, por ordem.",
      hu: "Konténer, AI-szolgáltató, profil és önéletrajz, munkaidő: négy ellenőrzés, sorban.",
    },
    assets: {},
    pending: "Pannello «Attiva il team» pulito, quattro controlli incompleti.",
  },
  {
    id: "S09-start-container",
    alt: {
      en: "The container starting: Docker check, image download, container up.",
      it: "L'avvio del container: controllo Docker, scaricamento immagine, container attivo.",
      es: "El arranque del contenedor: comprobación de Docker, descarga de imagen, contenedor activo.",
      fr: "Le démarrage du conteneur : vérification Docker, téléchargement de l'image, conteneur actif.",
      de: "Der Container-Start: Docker-Prüfung, Image-Download, Container läuft.",
      pt: "O arranque do contentor: verificação do Docker, transferência da imagem, contentor ativo.",
      hu: "A konténer indulása: Docker-ellenőrzés, képfájl letöltése, futó konténer.",
    },
    caption: {
      en: "The first image download takes as long as your machine and connection need.",
      it: "Il primo scaricamento dell'immagine dura quanto serve alla tua macchina e alla tua connessione.",
      es: "La primera descarga de la imagen dura lo que necesiten tu equipo y tu conexión.",
      fr: "Le premier téléchargement de l'image dure le temps qu'il faut à votre machine et à votre connexion.",
      de: "Der erste Image-Download dauert so lange, wie dein Rechner und deine Verbindung brauchen.",
      pt: "A primeira transferência da imagem demora o que a tua máquina e ligação precisarem.",
      hu: "Az első képfájl-letöltés annyi ideig tart, amennyi a gépednek és a kapcsolatodnak kell.",
    },
    assets: {},
    pending: "Avvio del container con lo stato reale a schermo.",
  },
  {
    id: "S10-choose-provider",
    alt: {
      en: "The provider choice: Claude, Codex or Kimi, with the subscription plan.",
      it: "La scelta del provider: Claude, Codex o Kimi, con il piano di abbonamento.",
      es: "La elección de proveedor: Claude, Codex o Kimi, con el plan de suscripción.",
      fr: "Le choix du fournisseur : Claude, Codex ou Kimi, avec le plan d'abonnement.",
      de: "Die Anbieterwahl: Claude, Codex oder Kimi, mit dem Abo-Tarif.",
      pt: "A escolha do provedor: Claude, Codex ou Kimi, com o plano de subscrição.",
      hu: "A szolgáltató kiválasztása: Claude, Codex vagy Kimi, az előfizetési csomaggal.",
    },
    caption: {
      en: "Subscription login only: no API key is ever requested.",
      it: "Solo accesso con abbonamento: nessuna chiave API viene mai richiesta.",
      es: "Solo inicio de sesión con suscripción: nunca se pide una clave de API.",
      fr: "Connexion par abonnement uniquement : aucune clé API n'est jamais demandée.",
      de: "Nur Anmeldung per Abo: Es wird nie ein API-Schlüssel verlangt.",
      pt: "Apenas início de sessão por subscrição: nunca é pedida uma chave de API.",
      hu: "Csak előfizetéses bejelentkezés: API-kulcsot soha nem kérünk.",
    },
    assets: {},
    pending: "Scelta provider e piano.",
  },
  {
    id: "S11-authorize-provider",
    alt: {
      en: "Provider authorization in the embedded console.",
      it: "L'autorizzazione del provider nella console integrata.",
      es: "La autorización del proveedor en la consola integrada.",
      fr: "L'autorisation du fournisseur dans la console intégrée.",
      de: "Die Anbieter-Autorisierung in der eingebetteten Konsole.",
      pt: "A autorização do provedor na consola integrada.",
      hu: "A szolgáltató engedélyezése a beépített konzolban.",
    },
    caption: {
      en: "Wait for the provider screen to report a detected login.",
      it: "Aspetta che la schermata del provider dichiari l'accesso rilevato.",
      es: "Espera a que la pantalla del proveedor indique el acceso detectado.",
      fr: "Attendez que l'écran du fournisseur signale la connexion détectée.",
      de: "Warte, bis der Anbieter-Bildschirm die erkannte Anmeldung meldet.",
      pt: "Espera que o ecrã do provedor indique o início de sessão detetado.",
      hu: "Várd meg, amíg a szolgáltató képernyője jelzi az észlelt bejelentkezést.",
    },
    assets: {},
    pending: "Console di autorizzazione. Nessun codice o token a schermo.",
  },
  {
    id: "S12-upload-cv",
    alt: {
      en: "Uploading the CV in Profile and CV.",
      it: "Il caricamento del CV in profilo e CV.",
      es: "La carga del CV en perfil y CV.",
      fr: "Le téléversement du CV dans profil et CV.",
      de: "Das Hochladen des Lebenslaufs unter Profil und Lebenslauf.",
      pt: "O carregamento do CV em perfil e CV.",
      hu: "Az önéletrajz feltöltése a profil és önéletrajz részben.",
    },
    caption: {
      en: "The badge shows which required fields are still missing.",
      it: "Il contrassegno mostra quali campi obbligatori mancano ancora.",
      es: "El indicador muestra qué campos obligatorios faltan todavía.",
      fr: "Le badge indique quels champs obligatoires manquent encore.",
      de: "Das Abzeichen zeigt, welche Pflichtfelder noch fehlen.",
      pt: "O distintivo mostra que campos obrigatórios ainda faltam.",
      hu: "A jelvény mutatja, mely kötelező mezők hiányoznak még.",
    },
    assets: {},
    pending:
      "Caricamento CV con un CV di prova neutro. Mai un CV vero, mai un nome vero.",
  },
  {
    id: "S13-profile-ready",
    alt: {
      en: "The completed profile, all required fields filled.",
      it: "Il profilo completo, tutti i campi obbligatori compilati.",
      es: "El perfil completo, con todos los campos obligatorios rellenados.",
      fr: "Le profil complet, tous les champs obligatoires remplis.",
      de: "Das vollständige Profil, alle Pflichtfelder ausgefüllt.",
      pt: "O perfil completo, com todos os campos obrigatórios preenchidos.",
      hu: "A kitöltött profil, minden kötelező mezővel.",
    },
    caption: {
      en: "Continue when the badge shows every field complete.",
      it: "Prosegui quando il contrassegno mostra tutti i campi completi.",
      es: "Continúa cuando el indicador muestre todos los campos completos.",
      fr: "Continuez quand le badge indique tous les champs complets.",
      de: "Mach weiter, wenn das Abzeichen alle Felder als vollständig zeigt.",
      pt: "Continua quando o distintivo mostrar todos os campos completos.",
      hu: "Akkor folytasd, amikor a jelvény minden mezőt teljesnek mutat.",
    },
    assets: {},
    pending: "Profilo completo con dati sintetici approvati.",
  },
  {
    id: "S14-working-hours",
    alt: {
      en: "The working hours schedule.",
      it: "La pianificazione degli orari di lavoro.",
      es: "La planificación del horario de trabajo.",
      fr: "La planification des horaires de travail.",
      de: "Der Zeitplan der Arbeitszeiten.",
      pt: "O planeamento do horário de trabalho.",
      hu: "A munkaidő beosztása.",
    },
    caption: {
      en: "Without a schedule the team may run at any hour, on your subscription.",
      it: "Senza orari il team può lavorare a qualsiasi ora, sul tuo abbonamento.",
      es: "Sin horario el equipo puede trabajar a cualquier hora, con tu suscripción.",
      fr: "Sans horaires, l'équipe peut travailler à toute heure, sur votre abonnement.",
      de: "Ohne Zeitplan kann das Team zu jeder Stunde laufen — auf dein Abo.",
      pt: "Sem horário a equipa pode trabalhar a qualquer hora, com a tua subscrição.",
      hu: "Beosztás nélkül a csapat bármikor dolgozhat — a te előfizetéseden.",
    },
    assets: {},
    pending: "Pianificazione orari salvata.",
  },
  {
    id: "S15-setup-complete",
    alt: {
      en: "The four setup checks, all ready.",
      it: "I quattro controlli di setup, tutti pronti.",
      es: "Las cuatro comprobaciones de configuración, todas listas.",
      fr: "Les quatre vérifications de configuration, toutes prêtes.",
      de: "Die vier Einrichtungsprüfungen, alle bereit.",
      pt: "As quatro verificações de configuração, todas prontas.",
      hu: "A négy beállítási ellenőrzés, mind készen.",
    },
    caption: {
      en: "The same panel you started from — now every check is ready.",
      it: "Lo stesso pannello da cui sei partito: ora ogni controllo è pronto.",
      es: "El mismo panel del que partiste: ahora cada comprobación está lista.",
      fr: "Le même panneau qu'au départ : chaque vérification est maintenant prête.",
      de: "Dasselbe Fenster wie am Anfang — jetzt ist jede Prüfung bereit.",
      pt: "O mesmo painel de onde partiste: agora cada verificação está pronta.",
      hu: "Ugyanaz a panel, ahonnan indultál — most minden ellenőrzés kész.",
    },
    assets: {},
    pending: "Pannello con i quattro controlli pronti.",
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
    pending: "Pannello account non collegato, con il container avviato.",
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
      "BLOCCATA dal contratto: titolo e suggerimento del terminale sono hardcoded in italiano anche con prodotto in inglese. Non pubblicare il frame italiano, non fabbricarne uno inglese. Serve prima il fix di prodotto.",
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
    if (!screen || screen.assets.shared) continue;
    for (const os of systems) {
      if (!screen.assets[os]) out.push({ screenId, os });
    }
  }
  return out;
}
