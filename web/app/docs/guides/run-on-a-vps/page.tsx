import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getRequestLocale } from "@/lib/request-locale";
import {
  DocHeader,
  Callout,
  H2,
  H3,
  P,
  UL,
  LI,
  Code,
  Pre,
  GitHubMore,
} from "../../DocKit";
import { repoFile } from "../../repo";

const T: Record<
  Locale,
  {
    title: string;
    tagline: string;
    intro: string;
    validatedLabel: string;
    validatedBody1: string;
    validatedBody2: string;
    shortTitle: string;
    shortBody: string;
    stepByStep: string;
    step1Title: string;
    step1Body1Pre: string;
    step1Ubuntu: string;
    step1Body1Mid: string;
    step1Dedicated: string;
    step1Body1Post: string;
    step1Note: string;
    step2Title: string;
    step2TipPre: string;
    step2TipPost: string;
    step3Title: string;
    step3Body: string;
    step4Title: string;
    step4Body: string;
    step4Li1Pre: string;
    step4Dashboard: string;
    step4Li1Post: string;
    step4Li2Pre: string;
    step4Li2Post: string;
    calloutDesktopLabel: string;
    calloutDesktopPre: string;
    calloutDesktopLink: string;
    calloutDesktopPost: string;
    calloutOneTeamLabel: string;
    calloutOneTeamBody: string;
  }
> = {
  en: {
    title: "Run 24/7 on a VPS",
    tagline: "A small cloud server so the team works while you sleep",
    intro:
      "A Local PC is the simplest complete way to start. Choose a VPS when you want the team to keep running while that PC is off: it costs about €6–10/mo on top of your AI provider, and you administer the server, SSH access, Docker, network, and storage.",
    validatedLabel: "Validated end-to-end",
    validatedBody1: "on a Hetzner",
    validatedBody2:
      "(4 GB RAM / 2 vCPU / 80 GB SSD, ~€9.75/mo). Any provider with a 4 GB-RAM Ubuntu 24.04 box works the same way.",
    shortTitle: "⚡ The whole thing, in short",
    shortBody:
      "From provisioning to the first scored jobs is about 15–30 minutes, mostly SSH-key setup. The full sequence on the server:",
    stepByStep: "🪜 Step by step",
    step1Title: "1. Provision the server",
    step1Body1Pre: "On your cloud console (e.g. Hetzner), create an",
    step1Ubuntu: "Ubuntu 24.04",
    step1Body1Mid: "box, ~4 GB RAM, in an EU region for GDPR. Upload a",
    step1Dedicated: "dedicated",
    step1Body1Post: "SSH key — don't reuse your personal one:",
    step1Note: "Note the server's IPv4 address when it's ready.",
    step2Title: "2. SSH in",
    step2TipPre:
      "Tip: before the first connection, compare the host fingerprint shown in your console against",
    step2TipPost: "to rule out a man-in-the-middle.",
    step3Title: "3. Add a little swap (recommended)",
    step3Body:
      "Eight agents can spike RAM. 2 GB of preventive swap avoids an OOM kill:",
    step4Title: "4. Install, configure, start",
    step4Body:
      "Run the one-liner and the commands from the short version above. Two things matter on a VPS specifically:",
    step4Li1Pre:
      "— optionally pairs the server to your web account so you can see copied results from any browser. If you enable it, the",
    step4Dashboard: "web dashboard",
    step4Li1Post:
      "is an additional view; the desktop app still controls the VPS runtime over SSH.",
    step4Li2Pre: "The container runs",
    step4Li2Post: ", so the team survives reboots automatically.",
    calloutDesktopLabel: "Prefer no terminal?",
    calloutDesktopPre:
      "The desktop app can connect to and control a team running on a VPS — start, stop and monitor it from your computer. See",
    calloutDesktopLink: "how to run it",
    calloutDesktopPost: ".",
    calloutOneTeamLabel: "One team per user.",
    calloutOneTeamBody:
      "Don't run a local team and a VPS team at the same time — it splits the source of truth and breaks sync. Pick one location per session.",
  },
  it: {
    title: "Esegui 24/7 su un VPS",
    tagline: "Un piccolo server cloud così il team lavora mentre dormi",
    intro:
      "Il PC locale è il modo completo più semplice per iniziare. Scegli un VPS se vuoi che il team continui quando quel PC è spento: costa circa €6–10/mese oltre al provider AI e sei tu ad amministrare server, accesso SSH, Docker, rete e spazio di archiviazione.",
    validatedLabel: "Validato end-to-end",
    validatedBody1: "su un Hetzner",
    validatedBody2:
      "(4 GB RAM / 2 vCPU / 80 GB SSD, ~€9,75/mese). Qualsiasi provider con una macchina Ubuntu 24.04 da 4 GB di RAM funziona allo stesso modo.",
    shortTitle: "⚡ Tutto, in breve",
    shortBody:
      "Dal provisioning ai primi annunci con punteggio passano circa 15–30 minuti, per lo più la configurazione della chiave SSH. La sequenza completa sul server:",
    stepByStep: "🪜 Passo dopo passo",
    step1Title: "1. Crea il server",
    step1Body1Pre: "Nella console cloud (es. Hetzner), crea una macchina",
    step1Ubuntu: "Ubuntu 24.04",
    step1Body1Mid:
      ", ~4 GB di RAM, in una regione UE per il GDPR. Carica una chiave SSH",
    step1Dedicated: "dedicata",
    step1Body1Post: "— non riutilizzare quella personale:",
    step1Note: "Annota l'indirizzo IPv4 del server quando è pronto.",
    step2Title: "2. Connettiti via SSH",
    step2TipPre:
      "Suggerimento: prima della prima connessione, confronta il fingerprint dell'host mostrato nella console con",
    step2TipPost: "per escludere un attacco man-in-the-middle.",
    step3Title: "3. Aggiungi un po' di swap (consigliato)",
    step3Body:
      "Otto agenti possono far impennare la RAM. 2 GB di swap preventivo evitano un OOM kill:",
    step4Title: "4. Installa, configura, avvia",
    step4Body:
      "Esegui la one-liner e i comandi della versione breve qui sopra. Due cose contano in particolare su un VPS:",
    step4Li1Pre:
      "— collega facoltativamente il server al tuo account web per vedere i risultati copiati da qualsiasi browser. Se lo attivi, la",
    step4Dashboard: "dashboard web",
    step4Li1Post:
      "è una vista aggiuntiva; l'app desktop continua a controllare il runtime VPS via SSH.",
    step4Li2Pre: "Il container gira con",
    step4Li2Post: ", così il team sopravvive automaticamente ai riavvii.",
    calloutDesktopLabel: "Preferisci niente terminale?",
    calloutDesktopPre:
      "L'app desktop può connettersi a un team in esecuzione su un VPS e controllarlo — avvialo, fermalo e monitoralo dal tuo computer. Vedi",
    calloutDesktopLink: "come eseguirlo",
    calloutDesktopPost: ".",
    calloutOneTeamLabel: "Un team per utente.",
    calloutOneTeamBody:
      "Non far girare un team locale e un team su VPS contemporaneamente — divide la fonte di verità e rompe la sincronizzazione. Scegli un'unica posizione per sessione.",
  },
  es: {
    title: "Ejecuta 24/7 en un VPS",
    tagline:
      "Un pequeño servidor en la nube para que el equipo trabaje mientras duermes",
    intro:
      "El PC local es la forma completa más sencilla de empezar. Elige una VPS si quieres que el equipo continúe cuando ese PC esté apagado: cuesta unos €6–10/mes además del proveedor de IA y tú administras el servidor, el acceso SSH, Docker, la red y el almacenamiento.",
    validatedLabel: "Validado de extremo a extremo",
    validatedBody1: "en un Hetzner",
    validatedBody2:
      "(4 GB RAM / 2 vCPU / 80 GB SSD, ~€9,75/mes). Cualquier proveedor con una máquina Ubuntu 24.04 de 4 GB de RAM funciona igual.",
    shortTitle: "⚡ Todo, en resumen",
    shortBody:
      "Desde el aprovisionamiento hasta los primeros empleos puntuados pasan unos 15–30 minutos, sobre todo la configuración de la clave SSH. La secuencia completa en el servidor:",
    stepByStep: "🪜 Paso a paso",
    step1Title: "1. Aprovisiona el servidor",
    step1Body1Pre: "En tu consola cloud (p. ej. Hetzner), crea una máquina",
    step1Ubuntu: "Ubuntu 24.04",
    step1Body1Mid:
      ", ~4 GB de RAM, en una región de la UE por el RGPD. Sube una clave SSH",
    step1Dedicated: "dedicada",
    step1Body1Post: "— no reutilices la personal:",
    step1Note: "Anota la dirección IPv4 del servidor cuando esté listo.",
    step2Title: "2. Conéctate por SSH",
    step2TipPre:
      "Consejo: antes de la primera conexión, compara la huella del host que muestra tu consola con",
    step2TipPost: "para descartar un ataque man-in-the-middle.",
    step3Title: "3. Añade un poco de swap (recomendado)",
    step3Body:
      "Ocho agentes pueden disparar la RAM. 2 GB de swap preventivo evitan un OOM kill:",
    step4Title: "4. Instala, configura, inicia",
    step4Body:
      "Ejecuta la one-liner y los comandos de la versión breve de arriba. Dos cosas importan en concreto en un VPS:",
    step4Li1Pre:
      "— vincula opcionalmente el servidor a tu cuenta web para ver los resultados copiados desde cualquier navegador. Si lo activas, el",
    step4Dashboard: "panel web",
    step4Li1Post:
      "es una vista adicional; la app de escritorio sigue controlando el runtime de la VPS mediante SSH.",
    step4Li2Pre: "El contenedor se ejecuta con",
    step4Li2Post:
      ", así que el equipo sobrevive a los reinicios automáticamente.",
    calloutDesktopLabel: "¿Prefieres sin terminal?",
    calloutDesktopPre:
      "La app de escritorio puede conectarse a un equipo que se ejecuta en una VPS y controlarlo — iniciarlo, detenerlo y monitorizarlo desde tu ordenador. Mira",
    calloutDesktopLink: "cómo ejecutarlo",
    calloutDesktopPost: ".",
    calloutOneTeamLabel: "Un equipo por usuario.",
    calloutOneTeamBody:
      "No ejecutes un equipo local y un equipo en VPS al mismo tiempo — divide la fuente de verdad y rompe la sincronización. Elige una única ubicación por sesión.",
  },
  fr: {
    title: "Exécuter 24/7 sur un VPS",
    tagline:
      "Un petit serveur cloud pour que l'équipe travaille pendant que vous dormez",
    intro:
      "Le PC local est le moyen complet le plus simple de commencer. Choisissez un VPS si vous voulez que l'équipe continue lorsque ce PC est éteint : il coûte environ 6–10 €/mois en plus du fournisseur d'IA, et vous administrez le serveur, l'accès SSH, Docker, le réseau et le stockage.",
    validatedLabel: "Validé de bout en bout",
    validatedBody1: "sur un Hetzner",
    validatedBody2:
      "(4 Go RAM / 2 vCPU / 80 Go SSD, ~9,75 €/mois). N'importe quel fournisseur avec une machine Ubuntu 24.04 de 4 Go de RAM fonctionne de la même manière.",
    shortTitle: "⚡ Le tout, en bref",
    shortBody:
      "Du provisionnement aux premières offres notées, il faut environ 15–30 minutes, surtout la configuration de la clé SSH. La séquence complète sur le serveur :",
    stepByStep: "🪜 Étape par étape",
    step1Title: "1. Provisionnez le serveur",
    step1Body1Pre:
      "Sur votre console cloud (par ex. Hetzner), créez une machine",
    step1Ubuntu: "Ubuntu 24.04",
    step1Body1Mid:
      ", ~4 Go de RAM, dans une région de l'UE pour le RGPD. Téléversez une clé SSH",
    step1Dedicated: "dédiée",
    step1Body1Post: "— ne réutilisez pas votre clé personnelle :",
    step1Note: "Notez l'adresse IPv4 du serveur une fois qu'il est prêt.",
    step2Title: "2. Connectez-vous en SSH",
    step2TipPre:
      "Astuce : avant la première connexion, comparez l'empreinte de l'hôte affichée dans votre console avec",
    step2TipPost: "pour écarter une attaque de l'homme du milieu.",
    step3Title: "3. Ajoutez un peu de swap (recommandé)",
    step3Body:
      "Huit agents peuvent faire grimper la RAM. 2 Go de swap préventif évitent un OOM kill :",
    step4Title: "4. Installez, configurez, démarrez",
    step4Body:
      "Exécutez la commande en une ligne et les commandes de la version courte ci-dessus. Deux choses comptent spécifiquement sur un VPS :",
    step4Li1Pre:
      "— associe facultativement le serveur à votre compte web pour voir les résultats copiés depuis n'importe quel navigateur. Si vous l'activez, le",
    step4Dashboard: "tableau de bord web",
    step4Li1Post:
      "est une vue supplémentaire ; l'application de bureau continue à contrôler le runtime VPS via SSH.",
    step4Li2Pre: "Le conteneur tourne avec",
    step4Li2Post: ", donc l'équipe survit automatiquement aux redémarrages.",
    calloutDesktopLabel: "Vous préférez sans terminal ?",
    calloutDesktopPre:
      "L'application de bureau peut se connecter à une équipe tournant sur un VPS et la contrôler — la démarrer, l'arrêter et la surveiller depuis votre ordinateur. Voir",
    calloutDesktopLink: "comment l'exécuter",
    calloutDesktopPost: ".",
    calloutOneTeamLabel: "Une équipe par utilisateur.",
    calloutOneTeamBody:
      "N'exécutez pas une équipe locale et une équipe sur VPS en même temps — cela divise la source de vérité et casse la synchronisation. Choisissez un seul emplacement par session.",
  },
  de: {
    title: "Rund um die Uhr auf einem VPS betreiben",
    tagline:
      "Ein kleiner Cloud-Server, damit das Team arbeitet, während du schläfst",
    intro:
      "Der lokale PC ist der einfachste vollständige Einstieg. Wähle einen VPS, wenn das Team bei ausgeschaltetem PC weiterarbeiten soll: Er kostet etwa 6–10 €/Monat zusätzlich zum KI-Anbieter, und du verwaltest Server, SSH-Zugang, Docker, Netzwerk und Speicher.",
    validatedLabel: "End-to-end validiert",
    validatedBody1: "auf einem Hetzner",
    validatedBody2:
      "(4 GB RAM / 2 vCPU / 80 GB SSD, ~9,75 €/Monat). Jeder Anbieter mit einer Ubuntu-24.04-Maschine mit 4 GB RAM funktioniert genauso.",
    shortTitle: "⚡ Das Ganze, in Kürze",
    shortBody:
      "Vom Bereitstellen bis zu den ersten bewerteten Jobs sind es etwa 15–30 Minuten, größtenteils das Einrichten des SSH-Schlüssels. Die vollständige Abfolge auf dem Server:",
    stepByStep: "🪜 Schritt für Schritt",
    step1Title: "1. Server bereitstellen",
    step1Body1Pre: "Erstelle in deiner Cloud-Konsole (z. B. Hetzner) eine",
    step1Ubuntu: "Ubuntu-24.04",
    step1Body1Mid:
      "-Maschine, ~4 GB RAM, in einer EU-Region wegen der DSGVO. Lade einen",
    step1Dedicated: "dedizierten",
    step1Body1Post: "SSH-Schlüssel hoch — verwende nicht deinen persönlichen:",
    step1Note:
      "Notiere dir die IPv4-Adresse des Servers, sobald er bereit ist.",
    step2Title: "2. Per SSH einloggen",
    step2TipPre:
      "Tipp: Vergleiche vor der ersten Verbindung den in deiner Konsole angezeigten Host-Fingerprint mit",
    step2TipPost: ", um einen Man-in-the-Middle-Angriff auszuschließen.",
    step3Title: "3. Etwas Swap hinzufügen (empfohlen)",
    step3Body:
      "Acht Agenten können die RAM-Nutzung in die Höhe treiben. 2 GB vorbeugender Swap verhindern einen OOM-Kill:",
    step4Title: "4. Installieren, konfigurieren, starten",
    step4Body:
      "Führe den Einzeiler und die Befehle aus der Kurzfassung oben aus. Zwei Dinge sind speziell auf einem VPS wichtig:",
    step4Li1Pre:
      "— koppelt den Server optional an dein Web-Konto, damit du kopierte Ergebnisse in jedem Browser sehen kannst. Wenn du dies aktivierst, ist das",
    step4Dashboard: "Web-Dashboard",
    step4Li1Post:
      "eine zusätzliche Ansicht; die Desktop-App steuert die VPS-Laufzeit weiterhin über SSH.",
    step4Li2Pre: "Der Container läuft mit",
    step4Li2Post: ", sodass das Team Neustarts automatisch übersteht.",
    calloutDesktopLabel: "Lieber ohne Terminal?",
    calloutDesktopPre:
      "Die Desktop-App kann sich mit einem Team verbinden, das auf einem VPS läuft, und es steuern — starten, stoppen und von deinem Computer aus überwachen. Siehe",
    calloutDesktopLink: "wie man es ausführt",
    calloutDesktopPost: ".",
    calloutOneTeamLabel: "Ein Team pro Benutzer.",
    calloutOneTeamBody:
      "Betreibe nicht gleichzeitig ein lokales Team und ein VPS-Team — das teilt die Quelle der Wahrheit und bricht die Synchronisierung. Wähle pro Sitzung einen einzigen Standort.",
  },
  hu: {
    title: "Futtatás 24/7-ben egy VPS-en",
    tagline:
      "Egy kis felhőszerver, hogy a csapat akkor is dolgozzon, amikor alszol",
    intro:
      "A helyi PC a legegyszerűbb teljes kiindulópont. Válassz VPS-t, ha azt szeretnéd, hogy a csapat a PC kikapcsolása után is működjön: ez havi körülbelül €6–10 az AI-szolgáltató díján felül, a szervert, az SSH-hozzáférést, a Dockert, a hálózatot és a tárhelyet pedig te kezeled.",
    validatedLabel: "Végpontok közt validálva",
    validatedBody1: "egy Hetzner",
    validatedBody2:
      "gépen (4 GB RAM / 2 vCPU / 80 GB SSD, ~havi €9,75). Bármelyik szolgáltató egy 4 GB RAM-os Ubuntu 24.04 géppel ugyanígy működik.",
    shortTitle: "⚡ Az egész, röviden",
    shortBody:
      "A kiépítéstől az első pontozott állásokig körülbelül 15–30 perc, főként az SSH-kulcs beállítása. A teljes sorozat a szerveren:",
    stepByStep: "🪜 Lépésről lépésre",
    step1Title: "1. Hozd létre a szervert",
    step1Body1Pre: "A felhőkonzolodon (pl. Hetzner) hozz létre egy",
    step1Ubuntu: "Ubuntu 24.04",
    step1Body1Mid:
      "gépet, ~4 GB RAM, egy EU-régióban a GDPR miatt. Tölts fel egy",
    step1Dedicated: "dedikált",
    step1Body1Post: "SSH-kulcsot — ne használd újra a személyeset:",
    step1Note: "Jegyezd fel a szerver IPv4-címét, amint kész van.",
    step2Title: "2. Csatlakozz SSH-val",
    step2TipPre:
      "Tipp: az első csatlakozás előtt hasonlítsd össze a konzolodban megjelenő host-ujjlenyomatot ezzel:",
    step2TipPost: ", hogy kizárd a man-in-the-middle támadást.",
    step3Title: "3. Adj hozzá egy kis swapet (ajánlott)",
    step3Body:
      "Nyolc ügynök megugraszthatja a RAM-ot. 2 GB megelőző swap elkerüli az OOM kill-t:",
    step4Title: "4. Telepítsd, konfiguráld, indítsd",
    step4Body:
      "Futtasd az egysoros parancsot és a fenti rövid változat parancsait. Két dolog számít kifejezetten egy VPS-en:",
    step4Li1Pre:
      "— opcionálisan összepárosítja a szervert a webes fiókoddal, így bármelyik böngészőből láthatod a másolt eredményeket. Ha bekapcsolod, a",
    step4Dashboard: "webes irányítópult",
    step4Li1Post:
      "egy további nézet; az asztali alkalmazás továbbra is SSH-n keresztül vezérli a VPS futtatási környezetét.",
    step4Li2Pre: "A konténer így fut:",
    step4Li2Post: ", így a csapat automatikusan túléli az újraindításokat.",
    calloutDesktopLabel: "Inkább terminál nélkül?",
    calloutDesktopPre:
      "Az asztali alkalmazás csatlakozhat egy VPS-en futó csapathoz és vezérelheti azt — a saját számítógépedről indíthatod, leállíthatod és figyelheted. Lásd:",
    calloutDesktopLink: "hogyan futtasd",
    calloutDesktopPost: ".",
    calloutOneTeamLabel: "Egy csapat felhasználónként.",
    calloutOneTeamBody:
      "Ne futtass egyszerre helyi csapatot és VPS-csapatot — ez kettéosztja az igazság forrását és megtöri a szinkronizációt. Munkamenetenként egyetlen helyet válassz.",
  },
  pt: {
    title: "Execute 24/7 num VPS",
    tagline:
      "Um pequeno servidor na nuvem para a equipa trabalhar enquanto dormes",
    intro:
      "O PC local é a forma completa mais simples de começar. Escolhe uma VPS se quiseres que a equipa continue quando esse PC estiver desligado: custa cerca de €6–10/mês além do fornecedor de IA e és tu que administras o servidor, o acesso SSH, o Docker, a rede e o armazenamento.",
    validatedLabel: "Validado de ponta a ponta",
    validatedBody1: "num Hetzner",
    validatedBody2:
      "(4 GB RAM / 2 vCPU / 80 GB SSD, ~€9,75/mês). Qualquer fornecedor com uma máquina Ubuntu 24.04 de 4 GB de RAM funciona da mesma forma.",
    shortTitle: "⚡ Tudo, em resumo",
    shortBody:
      "Do provisionamento às primeiras vagas pontuadas são cerca de 15–30 minutos, sobretudo a configuração da chave SSH. A sequência completa no servidor:",
    stepByStep: "🪜 Passo a passo",
    step1Title: "1. Provisiona o servidor",
    step1Body1Pre: "Na tua consola cloud (por ex. Hetzner), cria uma máquina",
    step1Ubuntu: "Ubuntu 24.04",
    step1Body1Mid:
      ", ~4 GB de RAM, numa região da UE por causa do RGPD. Carrega uma chave SSH",
    step1Dedicated: "dedicada",
    step1Body1Post: "— não reutilizes a pessoal:",
    step1Note: "Anota o endereço IPv4 do servidor quando estiver pronto.",
    step2Title: "2. Liga-te por SSH",
    step2TipPre:
      "Dica: antes da primeira ligação, compara a impressão digital do host mostrada na tua consola com",
    step2TipPost: "para descartar um ataque man-in-the-middle.",
    step3Title: "3. Adiciona um pouco de swap (recomendado)",
    step3Body:
      "Oito agentes podem disparar a RAM. 2 GB de swap preventivo evitam um OOM kill:",
    step4Title: "4. Instala, configura, inicia",
    step4Body:
      "Executa a one-liner e os comandos da versão curta acima. Duas coisas importam especificamente num VPS:",
    step4Li1Pre:
      "— emparelha opcionalmente o servidor com a tua conta web para veres os resultados copiados em qualquer navegador. Se o ativares, o",
    step4Dashboard: "painel web",
    step4Li1Post:
      "é uma vista adicional; a aplicação de desktop continua a controlar o runtime da VPS por SSH.",
    step4Li2Pre: "O contentor corre com",
    step4Li2Post:
      ", por isso a equipa sobrevive automaticamente aos reinícios.",
    calloutDesktopLabel: "Preferes sem terminal?",
    calloutDesktopPre:
      "A aplicação de desktop pode ligar-se a uma equipa a correr numa VPS e controlá-la — iniciá-la, pará-la e monitorizá-la a partir do teu computador. Vê",
    calloutDesktopLink: "como a executar",
    calloutDesktopPost: ".",
    calloutOneTeamLabel: "Uma equipa por utilizador.",
    calloutOneTeamBody:
      "Não corras uma equipa local e uma equipa em VPS ao mesmo tempo — divide a fonte da verdade e quebra a sincronização. Escolhe um único local por sessão.",
  },
};

export default async function RunOnAVpsPage() {
  const locale = await getRequestLocale();
  const t = T[locale];

  return (
    <div>
      <DocHeader emoji="☁️" title={t.title} tagline={t.tagline}>
        {t.intro}
      </DocHeader>

      <Callout>
        ✅ <strong>{t.validatedLabel}</strong> {t.validatedBody1}{" "}
        <strong>CPX22</strong> {t.validatedBody2}
      </Callout>

      <H2>{t.shortTitle}</H2>
      <P>{t.shortBody}</P>
      <Pre>
        {`# After you SSH into the VPS as root:
curl -fsSL https://jobhunterteam.ai/install.sh | bash   # ~1 min
exec bash -l                                            # pick up the jht PATH
jht up                                                  # pull image + start
jht setup                                               # wizard: provider + login
jht providers update                                    # install the provider CLI
jht oauth-login                                         # provider OAuth device flow
jht cloud login                                         # optional: copy results to your web account
jht team start                                          # start the agents
jht team status                                         # verify`}
      </Pre>

      <H2>{t.stepByStep}</H2>

      <H3>{t.step1Title}</H3>
      <P>
        {t.step1Body1Pre} <strong>{t.step1Ubuntu}</strong> {t.step1Body1Mid}{" "}
        <strong>{t.step1Dedicated}</strong> {t.step1Body1Post}
      </P>
      <Pre>
        {`ssh-keygen -t ed25519 -f ~/.ssh/jht_hetzner -C "jht-vps"
cat ~/.ssh/jht_hetzner.pub   # paste this into the cloud console`}
      </Pre>
      <P>{t.step1Note}</P>

      <H3>{t.step2Title}</H3>
      <Pre>{`ssh -i ~/.ssh/jht_hetzner root@<VPS_IP>`}</Pre>
      <P>
        {t.step2TipPre} <Code>ssh-keyscan</Code> {t.step2TipPost}
      </P>

      <H3>{t.step3Title}</H3>
      <P>{t.step3Body}</P>
      <Pre>
        {`fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab`}
      </Pre>

      <H3>{t.step4Title}</H3>
      <P>{t.step4Body}</P>
      <UL>
        <LI>
          <Code>jht cloud login</Code> {t.step4Li1Pre}{" "}
          <Link
            href="/docs/guides/dashboard-and-results"
            className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
          >
            {t.step4Dashboard}
          </Link>{" "}
          {t.step4Li1Post}
        </LI>
        <LI>
          {t.step4Li2Pre} <Code>restart: unless-stopped</Code>
          {t.step4Li2Post}
        </LI>
      </UL>

      <Callout>
        🖥️ <strong>{t.calloutDesktopLabel}</strong> {t.calloutDesktopPre}{" "}
        <Link
          href="/run"
          className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
        >
          {t.calloutDesktopLink}
        </Link>
        {t.calloutDesktopPost}
      </Callout>

      <Callout>
        🔒 <strong>{t.calloutOneTeamLabel}</strong> {t.calloutOneTeamBody}
      </Callout>

      <GitHubMore href={repoFile("docs/guides/VPS-SETUP.md")}>
        VPS-SETUP.md
      </GitHubMore>
    </div>
  );
}
