import type { Locale } from "@/i18n/config";
import { getRequestLocale } from "@/lib/request-locale";
import { DocHeader, Callout, H2, P, Code, Pre, GitHubMore } from "../../DocKit";
import { repoFile } from "../../repo";

const T: Record<
  Locale,
  {
    title: string;
    tagline: string;
    intro1: string;
    intro2: string;
    callout1: string;
    callout2: string;
    h2Lifecycle: string;
    lifecycleUp: string;
    lifecycleDown: string;
    lifecycleRestart: string;
    lifecycleUpgrade: string;
    lifecycleShell: string;
    lifecycleLogs: string;
    h2Setup: string;
    setupSetup: string;
    setupDoctor: string;
    setupHealth: string;
    setupStatus: string;
    h2Providers: string;
    providersList: string;
    providersCurrent: string;
    providersUse: string;
    providersUpdate: string;
    h2Team: string;
    teamStatus: string;
    teamStart: string;
    teamStop: string;
    teamChat: string;
    teamSend: string;
    teamReloadPre: string;
    teamReloadPost: string;
    h2Positions: string;
    positionsList: string;
    positionsShow: string;
    positionsStats: string;
    positionsSentinellaStatus: string;
    positionsSentinellaGraph: string;
    h2Cloud: string;
    cloudLogin: string;
    cloudStatus: string;
    cloudPush: string;
    cloudDisable: string;
    h2Oneliners: string;
    olFresh: string;
    olSwitch: string;
    olDaily: string;
    olReset: string;
    githubMore: string;
  }
> = {
  en: {
    title: "CLI — the jht command",
    tagline: "The essential commands to drive the team from a terminal",
    intro1: "Everything the desktop app and the web do, you can do with",
    intro2:
      ". It's the single surface humans, power users and AI assistants share — self-sufficient for day-to-day operation. Here are the commands you'll actually use.",
    callout1: "💡 Every command supports",
    callout2:
      ". The full reference — every subcommand, flag, and the host-wrapper vs container split — is linked at the bottom.",
    h2Lifecycle: "📦 Container lifecycle",
    lifecycleUp: "start the container (pulls the image first run)",
    lifecycleDown: "stop it (keeps your data)",
    lifecycleRestart: "same image, fresh process",
    lifecycleUpgrade: "pull a newer image and restart",
    lifecycleShell: "drop into the container for debugging",
    lifecycleLogs: "follow the container logs",
    h2Setup: "🧩 Setup & health",
    setupSetup: "interactive wizard: provider, OAuth, team start",
    setupDoctor: "check Docker / Node / auth / DB — must exit 0",
    setupHealth: "granular service health",
    setupStatus: "container status",
    h2Providers: "🧠 Providers",
    providersList: "claude | codex | kimi",
    providersCurrent: "active provider + model",
    providersUse: "switch the active provider",
    providersUpdate: "(re)install the provider CLI",
    h2Team: "🤖 The team",
    teamStatus: "running / stopped summary",
    teamStart: "start one agent, or the whole team",
    teamStop: "stop one, or --all",
    teamChat: "interactive chat with an agent",
    teamSend: "one-shot message to an agent",
    teamReloadPre: "To reload the team after editing config:",
    teamReloadPost: ".",
    h2Positions: "📊 Positions & monitoring",
    positionsList: "jobs in the local DB",
    positionsShow: "detail of one position",
    positionsStats: "found / scored / applied counts",
    positionsSentinellaStatus: "usage projection (rate-limit watch)",
    positionsSentinellaGraph: "ASCII usage over time",
    h2Cloud: "☁️ Cloud sync",
    cloudLogin: "browser device-flow pairing with your web account",
    cloudStatus: "sync state + last push time",
    cloudPush: "push local data to the cloud now",
    cloudDisable: "unlink this machine (revoke separately on the web)",
    h2Oneliners: "🔁 Common one-liners",
    olFresh: "Fresh setup (Local or VPS — same command)",
    olSwitch: "Switch provider and reload",
    olDaily: "Daily check",
    olReset: "Full reset (asks for confirmation)",
    githubMore: "the full CLI reference",
  },
  it: {
    title: "CLI — il comando jht",
    tagline: "I comandi essenziali per guidare il team da terminale",
    intro1: "Tutto ciò che fanno l'app desktop e il web, lo puoi fare con",
    intro2:
      ". È l'unica superficie condivisa da esseri umani, utenti esperti e assistenti AI — autosufficiente per l'uso quotidiano. Ecco i comandi che userai davvero.",
    callout1: "💡 Ogni comando supporta",
    callout2:
      ". Il riferimento completo — ogni sottocomando, flag e la distinzione host-wrapper vs container — è linkato in fondo.",
    h2Lifecycle: "📦 Ciclo di vita del container",
    lifecycleUp: "avvia il container (scarica l'immagine al primo avvio)",
    lifecycleDown: "fermalo (conserva i tuoi dati)",
    lifecycleRestart: "stessa immagine, processo nuovo",
    lifecycleUpgrade: "scarica un'immagine più recente e riavvia",
    lifecycleShell: "entra nel container per il debug",
    lifecycleLogs: "segui i log del container",
    h2Setup: "🧩 Setup e salute",
    setupSetup: "wizard interattivo: provider, OAuth, avvio del team",
    setupDoctor: "controlla Docker / Node / auth / DB — deve uscire con 0",
    setupHealth: "salute granulare dei servizi",
    setupStatus: "stato del container",
    h2Providers: "🧠 Provider",
    providersList: "claude | codex | kimi",
    providersCurrent: "provider + modello attivi",
    providersUse: "cambia il provider attivo",
    providersUpdate: "(re)installa la CLI del provider",
    h2Team: "🤖 Il team",
    teamStatus: "riepilogo in esecuzione / fermi",
    teamStart: "avvia un agente, o tutto il team",
    teamStop: "ferma un agente, o --all",
    teamChat: "chat interattiva con un agente",
    teamSend: "messaggio one-shot a un agente",
    teamReloadPre: "Per ricaricare il team dopo aver modificato la config:",
    teamReloadPost: ".",
    h2Positions: "📊 Posizioni e monitoraggio",
    positionsList: "offerte nel DB locale",
    positionsShow: "dettaglio di una posizione",
    positionsStats: "conteggi trovate / valutate / candidate",
    positionsSentinellaStatus: "proiezione del consumo (controllo rate-limit)",
    positionsSentinellaGraph: "consumo nel tempo in ASCII",
    h2Cloud: "☁️ Sincronizzazione cloud",
    cloudLogin: "abbinamento via device-flow del browser col tuo account web",
    cloudStatus: "stato sync + orario dell'ultimo push",
    cloudPush: "invia subito i dati locali al cloud",
    cloudDisable: "scollega questa macchina (revoca a parte sul web)",
    h2Oneliners: "🔁 One-liner comuni",
    olFresh: "Setup da zero (Local o VPS — stesso comando)",
    olSwitch: "Cambia provider e ricarica",
    olDaily: "Controllo quotidiano",
    olReset: "Reset completo (chiede conferma)",
    githubMore: "il riferimento completo della CLI",
  },
  es: {
    title: "CLI — el comando jht",
    tagline:
      "Los comandos esenciales para dirigir el equipo desde una terminal",
    intro1:
      "Todo lo que hacen la app de escritorio y la web, lo puedes hacer con",
    intro2:
      ". Es la única superficie que comparten humanos, usuarios avanzados y asistentes de IA — autosuficiente para el uso diario. Estos son los comandos que realmente usarás.",
    callout1: "💡 Cada comando admite",
    callout2:
      ". La referencia completa — cada subcomando, opción y la distinción host-wrapper vs container — está enlazada al final.",
    h2Lifecycle: "📦 Ciclo de vida del contenedor",
    lifecycleUp:
      "inicia el contenedor (descarga la imagen en el primer arranque)",
    lifecycleDown: "deténlo (conserva tus datos)",
    lifecycleRestart: "misma imagen, proceso nuevo",
    lifecycleUpgrade: "descarga una imagen más reciente y reinicia",
    lifecycleShell: "entra en el contenedor para depurar",
    lifecycleLogs: "sigue los logs del contenedor",
    h2Setup: "🧩 Configuración y salud",
    setupSetup: "asistente interactivo: proveedor, OAuth, inicio del equipo",
    setupDoctor: "comprueba Docker / Node / auth / DB — debe salir con 0",
    setupHealth: "salud granular de los servicios",
    setupStatus: "estado del contenedor",
    h2Providers: "🧠 Proveedores",
    providersList: "claude | codex | kimi",
    providersCurrent: "proveedor + modelo activos",
    providersUse: "cambia el proveedor activo",
    providersUpdate: "(re)instala la CLI del proveedor",
    h2Team: "🤖 El equipo",
    teamStatus: "resumen en ejecución / detenidos",
    teamStart: "inicia un agente, o todo el equipo",
    teamStop: "detén uno, o --all",
    teamChat: "chat interactivo con un agente",
    teamSend: "mensaje único a un agente",
    teamReloadPre: "Para recargar el equipo tras editar la configuración:",
    teamReloadPost: ".",
    h2Positions: "📊 Posiciones y monitoreo",
    positionsList: "ofertas en la base de datos local",
    positionsShow: "detalle de una posición",
    positionsStats: "recuentos de encontradas / evaluadas / aplicadas",
    positionsSentinellaStatus:
      "proyección de consumo (vigilancia de rate-limit)",
    positionsSentinellaGraph: "consumo a lo largo del tiempo en ASCII",
    h2Cloud: "☁️ Sincronización en la nube",
    cloudLogin:
      "emparejamiento por device-flow del navegador con tu cuenta web",
    cloudStatus: "estado de sync + hora del último push",
    cloudPush: "envía ahora los datos locales a la nube",
    cloudDisable: "desvincula esta máquina (revoca aparte en la web)",
    h2Oneliners: "🔁 One-liners comunes",
    olFresh: "Configuración desde cero (Local o VPS — el mismo comando)",
    olSwitch: "Cambia de proveedor y recarga",
    olDaily: "Comprobación diaria",
    olReset: "Reinicio completo (pide confirmación)",
    githubMore: "la referencia completa de la CLI",
  },
  fr: {
    title: "CLI — la commande jht",
    tagline:
      "Les commandes essentielles pour piloter l'équipe depuis un terminal",
    intro1:
      "Tout ce que font l'application de bureau et le web, vous pouvez le faire avec",
    intro2:
      ". C'est la seule surface partagée par les humains, les utilisateurs avancés et les assistants IA — autosuffisante pour l'usage quotidien. Voici les commandes que vous utiliserez vraiment.",
    callout1: "💡 Chaque commande prend en charge",
    callout2:
      ". La référence complète — chaque sous-commande, option et la distinction host-wrapper vs container — est liée en bas.",
    h2Lifecycle: "📦 Cycle de vie du conteneur",
    lifecycleUp:
      "démarre le conteneur (télécharge l'image au premier lancement)",
    lifecycleDown: "arrête-le (conserve tes données)",
    lifecycleRestart: "même image, nouveau processus",
    lifecycleUpgrade: "télécharge une image plus récente et redémarre",
    lifecycleShell: "entre dans le conteneur pour déboguer",
    lifecycleLogs: "suis les logs du conteneur",
    h2Setup: "🧩 Configuration et santé",
    setupSetup: "assistant interactif : provider, OAuth, démarrage de l'équipe",
    setupDoctor: "vérifie Docker / Node / auth / DB — doit sortir avec 0",
    setupHealth: "santé granulaire des services",
    setupStatus: "état du conteneur",
    h2Providers: "🧠 Providers",
    providersList: "claude | codex | kimi",
    providersCurrent: "provider + modèle actifs",
    providersUse: "change le provider actif",
    providersUpdate: "(ré)installe la CLI du provider",
    h2Team: "🤖 L'équipe",
    teamStatus: "résumé en cours / arrêtés",
    teamStart: "démarre un agent, ou toute l'équipe",
    teamStop: "arrête-en un, ou --all",
    teamChat: "chat interactif avec un agent",
    teamSend: "message unique à un agent",
    teamReloadPre: "Pour recharger l'équipe après avoir modifié la config :",
    teamReloadPost: ".",
    h2Positions: "📊 Postes et surveillance",
    positionsList: "offres dans la base de données locale",
    positionsShow: "détail d'un poste",
    positionsStats: "comptages trouvées / évaluées / postulées",
    positionsSentinellaStatus:
      "projection de consommation (surveillance du rate-limit)",
    positionsSentinellaGraph: "consommation dans le temps en ASCII",
    h2Cloud: "☁️ Synchronisation cloud",
    cloudLogin: "appairage par device-flow du navigateur avec ton compte web",
    cloudStatus: "état de la sync + heure du dernier push",
    cloudPush: "envoie maintenant les données locales vers le cloud",
    cloudDisable: "dissocie cette machine (révoque séparément sur le web)",
    h2Oneliners: "🔁 One-liners courants",
    olFresh: "Configuration à neuf (Local ou VPS — la même commande)",
    olSwitch: "Change de provider et recharge",
    olDaily: "Vérification quotidienne",
    olReset: "Réinitialisation complète (demande confirmation)",
    githubMore: "la référence complète de la CLI",
  },
  de: {
    title: "CLI — der Befehl jht",
    tagline:
      "Die wesentlichen Befehle, um das Team vom Terminal aus zu steuern",
    intro1: "Alles, was die Desktop-App und das Web tun, kannst du mit",
    intro2:
      " erledigen. Es ist die einzige Oberfläche, die Menschen, Power-User und KI-Assistenten teilen — autark für den täglichen Betrieb. Hier sind die Befehle, die du tatsächlich nutzen wirst.",
    callout1: "💡 Jeder Befehl unterstützt",
    callout2:
      ". Die vollständige Referenz — jeder Unterbefehl, jedes Flag und die Trennung host-wrapper vs. container — ist unten verlinkt.",
    h2Lifecycle: "📦 Container-Lebenszyklus",
    lifecycleUp: "Container starten (lädt das Image beim ersten Mal)",
    lifecycleDown: "stoppen (behält deine Daten)",
    lifecycleRestart: "gleiches Image, frischer Prozess",
    lifecycleUpgrade: "neueres Image laden und neu starten",
    lifecycleShell: "in den Container zum Debuggen einsteigen",
    lifecycleLogs: "den Container-Logs folgen",
    h2Setup: "🧩 Einrichtung & Zustand",
    setupSetup: "interaktiver Assistent: Provider, OAuth, Team-Start",
    setupDoctor: "Docker / Node / Auth / DB prüfen — muss mit 0 beenden",
    setupHealth: "granularer Service-Zustand",
    setupStatus: "Container-Status",
    h2Providers: "🧠 Provider",
    providersList: "claude | codex | kimi",
    providersCurrent: "aktiver Provider + Modell",
    providersUse: "den aktiven Provider wechseln",
    providersUpdate: "die Provider-CLI (neu) installieren",
    h2Team: "🤖 Das Team",
    teamStatus: "Übersicht laufend / gestoppt",
    teamStart: "einen Agenten starten, oder das ganze Team",
    teamStop: "einen stoppen, oder --all",
    teamChat: "interaktiver Chat mit einem Agenten",
    teamSend: "einmalige Nachricht an einen Agenten",
    teamReloadPre: "Um das Team nach dem Bearbeiten der Config neu zu laden:",
    teamReloadPost: ".",
    h2Positions: "📊 Positionen & Monitoring",
    positionsList: "Jobs in der lokalen DB",
    positionsShow: "Detail einer Position",
    positionsStats: "Anzahl gefunden / bewertet / beworben",
    positionsSentinellaStatus: "Verbrauchsprognose (Rate-Limit-Überwachung)",
    positionsSentinellaGraph: "Verbrauch über die Zeit in ASCII",
    h2Cloud: "☁️ Cloud-Sync",
    cloudLogin: "Browser-Device-Flow-Kopplung mit deinem Web-Konto",
    cloudStatus: "Sync-Status + Zeit des letzten Push",
    cloudPush: "lokale Daten jetzt in die Cloud pushen",
    cloudDisable: "diese Maschine trennen (separat im Web widerrufen)",
    h2Oneliners: "🔁 Gängige One-Liner",
    olFresh: "Neue Einrichtung (Local oder VPS — derselbe Befehl)",
    olSwitch: "Provider wechseln und neu laden",
    olDaily: "Tägliche Prüfung",
    olReset: "Vollständiger Reset (fragt nach Bestätigung)",
    githubMore: "die vollständige CLI-Referenz",
  },
  hu: {
    title: "CLI — a jht parancs",
    tagline:
      "A csapat terminálból való irányításához szükséges alapvető parancsok",
    intro1: "Mindent, amit az asztali alkalmazás és a web csinál, megtehetsz a",
    intro2:
      " segítségével. Ez az egyetlen felület, amelyet emberek, haladó felhasználók és MI-asszisztensek megosztanak — önellátó a napi használathoz. Íme a parancsok, amelyeket valóban használni fogsz.",
    callout1: "💡 Minden parancs támogatja a",
    callout2:
      " kapcsolót. A teljes referencia — minden alparancs, kapcsoló, valamint a host-wrapper vs. container megkülönböztetés — alul van linkelve.",
    h2Lifecycle: "📦 Konténer életciklusa",
    lifecycleUp: "indítja a konténert (első futáskor letölti az image-et)",
    lifecycleDown: "leállítja (megőrzi az adataidat)",
    lifecycleRestart: "ugyanaz az image, friss folyamat",
    lifecycleUpgrade: "újabb image letöltése és újraindítás",
    lifecycleShell: "belépés a konténerbe hibakereséshez",
    lifecycleLogs: "a konténer naplóinak követése",
    h2Setup: "🧩 Beállítás és állapot",
    setupSetup: "interaktív varázsló: provider, OAuth, csapat indítása",
    setupDoctor: "Docker / Node / auth / DB ellenőrzése — 0-val kell kilépnie",
    setupHealth: "részletes szolgáltatás-állapot",
    setupStatus: "konténer állapota",
    h2Providers: "🧠 Providerek",
    providersList: "claude | codex | kimi",
    providersCurrent: "aktív provider + modell",
    providersUse: "aktív provider váltása",
    providersUpdate: "a provider CLI (újra)telepítése",
    h2Team: "🤖 A csapat",
    teamStatus: "futó / leállított összefoglaló",
    teamStart: "egy ügynök indítása, vagy az egész csapat",
    teamStop: "egy leállítása, vagy --all",
    teamChat: "interaktív csevegés egy ügynökkel",
    teamSend: "egyszeri üzenet egy ügynöknek",
    teamReloadPre: "A csapat újratöltéséhez a config szerkesztése után:",
    teamReloadPost: ".",
    h2Positions: "📊 Pozíciók és monitorozás",
    positionsList: "állások a helyi adatbázisban",
    positionsShow: "egy pozíció részletei",
    positionsStats: "talált / értékelt / megpályázott számlálók",
    positionsSentinellaStatus: "felhasználás-előrejelzés (rate-limit figyelés)",
    positionsSentinellaGraph: "felhasználás az idő függvényében, ASCII-ban",
    h2Cloud: "☁️ Felhő szinkronizálás",
    cloudLogin: "böngészős device-flow párosítás a webes fiókoddal",
    cloudStatus: "szinkron állapota + utolsó push ideje",
    cloudPush: "helyi adatok azonnali feltöltése a felhőbe",
    cloudDisable: "ennek a gépnek a leválasztása (külön vond vissza a weben)",
    h2Oneliners: "🔁 Gyakori egysorosok",
    olFresh: "Tiszta beállítás (Local vagy VPS — ugyanaz a parancs)",
    olSwitch: "Provider váltása és újratöltés",
    olDaily: "Napi ellenőrzés",
    olReset: "Teljes visszaállítás (megerősítést kér)",
    githubMore: "a teljes CLI referencia",
  },
  pt: {
    title: "CLI — o comando jht",
    tagline:
      "Os comandos essenciais para conduzir a equipe a partir de um terminal",
    intro1: "Tudo o que a app de desktop e a web fazem, você pode fazer com",
    intro2:
      ". É a única superfície partilhada por humanos, utilizadores avançados e assistentes de IA — autossuficiente para o uso diário. Aqui estão os comandos que você realmente vai usar.",
    callout1: "💡 Todos os comandos suportam",
    callout2:
      ". A referência completa — cada subcomando, flag e a distinção host-wrapper vs container — está ligada no final.",
    h2Lifecycle: "📦 Ciclo de vida do container",
    lifecycleUp: "inicia o container (baixa a imagem na primeira execução)",
    lifecycleDown: "para o container (mantém os seus dados)",
    lifecycleRestart: "mesma imagem, processo novo",
    lifecycleUpgrade: "baixa uma imagem mais recente e reinicia",
    lifecycleShell: "entra no container para depuração",
    lifecycleLogs: "segue os logs do container",
    h2Setup: "🧩 Configuração e saúde",
    setupSetup: "assistente interativo: provider, OAuth, início da equipe",
    setupDoctor: "verifica Docker / Node / auth / DB — deve sair com 0",
    setupHealth: "saúde granular dos serviços",
    setupStatus: "estado do container",
    h2Providers: "🧠 Providers",
    providersList: "claude | codex | kimi",
    providersCurrent: "provider + modelo ativos",
    providersUse: "troca o provider ativo",
    providersUpdate: "(re)instala a CLI do provider",
    h2Team: "🤖 A equipe",
    teamStatus: "resumo em execução / parados",
    teamStart: "inicia um agente, ou a equipe inteira",
    teamStop: "para um, ou --all",
    teamChat: "chat interativo com um agente",
    teamSend: "mensagem única para um agente",
    teamReloadPre: "Para recarregar a equipe depois de editar a config:",
    teamReloadPost: ".",
    h2Positions: "📊 Posições e monitorização",
    positionsList: "vagas na base de dados local",
    positionsShow: "detalhe de uma posição",
    positionsStats: "contagens encontradas / avaliadas / candidatadas",
    positionsSentinellaStatus: "projeção de consumo (vigilância de rate-limit)",
    positionsSentinellaGraph: "consumo ao longo do tempo em ASCII",
    h2Cloud: "☁️ Sincronização na nuvem",
    cloudLogin:
      "emparelhamento por device-flow do navegador com a sua conta web",
    cloudStatus: "estado da sync + hora do último push",
    cloudPush: "envia agora os dados locais para a nuvem",
    cloudDisable: "desvincula esta máquina (revogue à parte na web)",
    h2Oneliners: "🔁 One-liners comuns",
    olFresh: "Configuração do zero (Local ou VPS — o mesmo comando)",
    olSwitch: "Troca de provider e recarrega",
    olDaily: "Verificação diária",
    olReset: "Reset completo (pede confirmação)",
    githubMore: "a referência completa da CLI",
  },
};

export default async function CliPage() {
  const locale = await getRequestLocale();
  const t = T[locale];

  return (
    <div>
      <DocHeader emoji="⌨️" title={t.title} tagline={t.tagline}>
        {t.intro1} <Code>jht</Code>
        {t.intro2}
      </DocHeader>

      <Callout>
        {t.callout1} <Code>--help</Code>
        {t.callout2}
      </Callout>

      <H2>{t.h2Lifecycle}</H2>
      <Pre>
        {`jht up         # ${t.lifecycleUp}
jht down       # ${t.lifecycleDown}
jht restart    # ${t.lifecycleRestart}
jht upgrade    # ${t.lifecycleUpgrade}
jht shell      # ${t.lifecycleShell}
jht logs -f    # ${t.lifecycleLogs}`}
      </Pre>

      <H2>{t.h2Setup}</H2>
      <Pre>
        {`jht setup      # ${t.setupSetup}
jht doctor     # ${t.setupDoctor}
jht health     # ${t.setupHealth}
jht status     # ${t.setupStatus}`}
      </Pre>

      <H2>{t.h2Providers}</H2>
      <Pre>
        {`jht providers list       # ${t.providersList}
jht providers current    # ${t.providersCurrent}
jht providers use kimi   # ${t.providersUse}
jht providers update     # ${t.providersUpdate}`}
      </Pre>

      <H2>{t.h2Team}</H2>
      <Pre>
        {`jht team status              # ${t.teamStatus}
jht team start [agent]       # ${t.teamStart}
jht team stop  [agent]       # ${t.teamStop}
jht team chat  <agent>       # ${t.teamChat}
jht team send  <agent> "…"   # ${t.teamSend}`}
      </Pre>
      <P>
        {t.teamReloadPre}{" "}
        <Code>jht team stop --all &amp;&amp; jht team start</Code>
        {t.teamReloadPost}
      </P>

      <H2>{t.h2Positions}</H2>
      <Pre>
        {`jht positions list           # ${t.positionsList}
jht positions show <id>      # ${t.positionsShow}
jht stats                    # ${t.positionsStats}
jht sentinella status        # ${t.positionsSentinellaStatus}
jht sentinella graph         # ${t.positionsSentinellaGraph}`}
      </Pre>

      <H2>{t.h2Cloud}</H2>
      <Pre>
        {`jht cloud login    # ${t.cloudLogin}
jht cloud status   # ${t.cloudStatus}
jht cloud push     # ${t.cloudPush}
jht cloud disable  # ${t.cloudDisable}`}
      </Pre>

      <H2>{t.h2Oneliners}</H2>
      <Pre>
        {`# ${t.olFresh}
jht up && jht setup

# ${t.olSwitch}
jht providers use codex && jht providers update codex
jht team stop --all && jht team start

# ${t.olDaily}
jht status && jht doctor

# ${t.olReset}
jht reset --scope full`}
      </Pre>

      <GitHubMore href={repoFile("docs/guides/CLI-REFERENCE.md")}>
        {t.githubMore}
      </GitHubMore>
    </div>
  );
}
