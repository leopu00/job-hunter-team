"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";

type Lang = "it" | "en" | "es" | "fr" | "de" | "pt" | "hu";

type ModeText = { title: string; body: string; req: string };

type Mode = {
  promptId: string;
  img: string;
  badge: Record<Lang, string>;
} & Record<Lang, ModeText>;

const MODES: Mode[] = [
  {
    promptId: "setup.local",
    img: "/run-local.png",
    badge: {
      it: "Più semplice",
      en: "Simplest",
      es: "Lo más sencillo",
      fr: "Le plus simple",
      de: "Am einfachsten",
      pt: "O mais simples",
      hu: "Legegyszerűbb",
    },
    it: {
      title: "Sul tuo PC",
      body: "Il modo più immediato per provarlo. Avvii e fermi la squadra con un clic dall'app desktop, e ogni dato resta sul tuo computer — nessun cloud, se non lo vuoi.",
      req: "Unico requisito: Docker.",
    },
    en: {
      title: "On your PC",
      body: "The most immediate way to try it. Start and stop the team with one click from the desktop app, and every piece of data stays on your computer — no cloud, unless you want it.",
      req: "Only requirement: Docker.",
    },
    es: {
      title: "En tu PC",
      body: "La forma más inmediata de probarlo. Inicias y detienes el equipo con un clic desde la app de escritorio, y cada dato permanece en tu ordenador — sin nube, si no la quieres.",
      req: "Único requisito: Docker.",
    },
    fr: {
      title: "Sur votre PC",
      body: "La façon la plus immédiate de l'essayer. Vous démarrez et arrêtez l'équipe d'un clic depuis l'app de bureau, et chaque donnée reste sur votre ordinateur — aucun cloud, sauf si vous le voulez.",
      req: "Seule exigence : Docker.",
    },
    de: {
      title: "Auf deinem PC",
      body: "Der unmittelbarste Weg, es auszuprobieren. Du startest und stoppst das Team mit einem Klick aus der Desktop-App, und alle Daten bleiben auf deinem Computer — keine Cloud, sofern du sie nicht willst.",
      req: "Einzige Voraussetzung: Docker.",
    },
    pt: {
      title: "No teu PC",
      body: "A forma mais imediata de o experimentar. Inicias e paras a equipa com um clique a partir da app de ambiente de trabalho, e cada dado permanece no teu computador — sem nuvem, se não a quiseres.",
      req: "Único requisito: Docker.",
    },
    hu: {
      title: "A saját géped",
      body: "A legközvetlenebb módja a kipróbálásnak. Egy kattintással indítod és állítod le a csapatot az asztali appból, és minden adat a számítógépeden marad — felhő nélkül, ha nem akarod.",
      req: "Egyetlen követelmény: Docker.",
    },
  },
  {
    promptId: "setup.dedicated",
    img: "/run-dedicated.png",
    badge: {
      it: "Consigliato",
      en: "Recommended",
      es: "Recomendado",
      fr: "Recommandé",
      de: "Empfohlen",
      pt: "Recomendado",
      hu: "Ajánlott",
    },
    it: {
      title: "Su un PC dedicato",
      body: "Un computer sempre acceso — anche un piccolo mini-PC — dedicato solo alla squadra. Il tuo portatile resta libero e il team lavora giorno e notte senza interruzioni.",
      req: "Docker, e una rete stabile.",
    },
    en: {
      title: "On a dedicated PC",
      body: "An always-on computer — even a small mini-PC — devoted to the team alone. Your laptop stays free and the team works day and night without interruption.",
      req: "Docker, and a stable network.",
    },
    es: {
      title: "En un PC dedicado",
      body: "Un ordenador siempre encendido — incluso un pequeño mini-PC — dedicado solo al equipo. Tu portátil queda libre y el equipo trabaja día y noche sin interrupciones.",
      req: "Docker y una red estable.",
    },
    fr: {
      title: "Sur un PC dédié",
      body: "Un ordinateur toujours allumé — même un petit mini-PC — consacré uniquement à l'équipe. Votre portable reste libre et l'équipe travaille jour et nuit sans interruption.",
      req: "Docker, et un réseau stable.",
    },
    de: {
      title: "Auf einem dedizierten PC",
      body: "Ein stets eingeschalteter Computer — auch ein kleiner Mini-PC — der allein dem Team gewidmet ist. Dein Laptop bleibt frei und das Team arbeitet Tag und Nacht ohne Unterbrechung.",
      req: "Docker und ein stabiles Netzwerk.",
    },
    pt: {
      title: "Num PC dedicado",
      body: "Um computador sempre ligado — mesmo um pequeno mini-PC — dedicado apenas à equipa. O teu portátil fica livre e a equipa trabalha dia e noite sem interrupções.",
      req: "Docker e uma rede estável.",
    },
    hu: {
      title: "Egy dedikált gépen",
      body: "Egy mindig bekapcsolt számítógép — akár egy kis mini-PC — kizárólag a csapatnak szentelve. A laptopod szabad marad, a csapat pedig éjjel-nappal megszakítás nélkül dolgozik.",
      req: "Docker és egy stabil hálózat.",
    },
  },
  {
    promptId: "setup.vps",
    img: "/run-vps.png",
    badge: {
      it: "Consigliato",
      en: "Recommended",
      es: "Recomendado",
      fr: "Recommandé",
      de: "Empfohlen",
      pt: "Recomendado",
      hu: "Ajánlott",
    },
    it: {
      title: "Su una VPS",
      body: "Un piccolo server in cloud, sempre acceso, da circa €6–10 al mese. Non devi comprare un computer nuovo, non rischi spegnimenti improvvisi, ed è il modo più economico per averlo attivo 24 ore su 24. Lo colleghi e lo controlli dall'app desktop.",
      req: "Una VPS da 4 GB di RAM (es. ~€6–10/mese).",
    },
    en: {
      title: "On a VPS",
      body: "A small cloud server, always on, for about €6–10 a month. No need to buy a new computer, no risk of sudden shutdowns, and it's the cheapest way to keep it running 24/7. You connect and control it from the desktop app.",
      req: "A 4 GB-RAM VPS (e.g. ~€6–10/month).",
    },
    es: {
      title: "En una VPS",
      body: "Un pequeño servidor en la nube, siempre encendido, por unos €6–10 al mes. No tienes que comprar un ordenador nuevo, no arriesgas apagones repentinos, y es la forma más económica de tenerlo activo 24 horas al día. Lo conectas y lo controlas desde la app de escritorio.",
      req: "Una VPS de 4 GB de RAM (p. ej. ~€6–10/mes).",
    },
    fr: {
      title: "Sur un VPS",
      body: "Un petit serveur cloud, toujours allumé, pour environ €6–10 par mois. Pas besoin d'acheter un nouvel ordinateur, aucun risque d'arrêts soudains, et c'est la façon la plus économique de le garder actif 24h/24. Vous le connectez et le contrôlez depuis l'app de bureau.",
      req: "Un VPS de 4 Go de RAM (p. ex. ~€6–10/mois).",
    },
    de: {
      title: "Auf einem VPS",
      body: "Ein kleiner Cloud-Server, stets eingeschaltet, für etwa €6–10 im Monat. Du musst keinen neuen Computer kaufen, riskierst keine plötzlichen Abschaltungen, und es ist der günstigste Weg, ihn rund um die Uhr laufen zu lassen. Du verbindest und steuerst ihn über die Desktop-App.",
      req: "Ein VPS mit 4 GB RAM (z. B. ~€6–10/Monat).",
    },
    pt: {
      title: "Num VPS",
      body: "Um pequeno servidor na nuvem, sempre ligado, por cerca de €6–10 por mês. Não precisas de comprar um computador novo, não arriscas encerramentos repentinos, e é a forma mais económica de o ter ativo 24 horas por dia. Ligas e controla-lo a partir da app de ambiente de trabalho.",
      req: "Um VPS de 4 GB de RAM (p. ex. ~€6–10/mês).",
    },
    hu: {
      title: "Egy VPS-en",
      body: "Egy kis felhőszerver, mindig bekapcsolva, havi körülbelül €6–10 áron. Nem kell új számítógépet venned, nem kockáztatsz váratlan leállásokat, és ez a legolcsóbb módja annak, hogy a nap 24 órájában működjön. Az asztali appból csatlakoztatod és vezérled.",
      req: "Egy 4 GB RAM-os VPS (pl. ~€6–10/hó).",
    },
  },
];

const PAGE = {
  it: {
    title: "Come si avvia",
    subtitle:
      "Il team lavora per te giorno e notte, perciò ha bisogno di un computer sempre acceso: il tuo, uno dedicato, oppure un server in cloud.",
    setupNote:
      "Tutto parte dall'app desktop: è da lì che configuri e comandi il team. La installi su un computer a portata di mano e da lì gestisci tutto, che la squadra giri su quella stessa macchina o su una VPS remota.",
    ctrlTitle: "Come la controlli",
    ctrlIntro:
      "Non sei legato a un solo strumento: gestisci la squadra dall'app desktop, dal terminale, o da entrambi insieme, con lo stesso runtime e le stesse funzioni. E se fai il login e sincronizzi i dati sul cloud, la ritrovi anche dal web: apri la dashboard e la consulti dal telefono o da qualsiasi browser, senza dover restare al computer su cui gira.",
    ctrlDesktopLabel: "App desktop",
    ctrlDesktopBody:
      "Il telecomando con interfaccia grafica: installa Docker, avvia e ferma il team, ne mostra lo stato in tempo reale e collega anche una VPS.",
    ctrlTerminalLabel: "Terminale (CLI / TUI)",
    ctrlTerminalBody:
      "Le stesse funzioni dalla riga di comando. Puoi anche affidarle al tuo assistente AI personale, come Claude Code o OpenClaw.",
    ctrlBrowserLabel: "Browser",
    ctrlBrowserBody:
      "Con il login apri la dashboard da qualsiasi browser, anche dal telefono, e segui la squadra ovunque ti trovi.",
    ctrlWeb:
      "Il login resta sempre facoltativo: se preferisci, i tuoi dati restano solo sul tuo computer, senza alcun cloud.",
    ctaDownload: "Installa →",
    back: "← Torna alla home",
  },
  en: {
    title: "How to run it",
    subtitle:
      "The team works for you day and night, so it needs a computer that's always on: yours, a dedicated one, or a cloud server.",
    setupNote:
      "It all starts from the desktop app: that's where you configure and command the team. You install it on a computer within reach and manage everything from there, whether the team runs on that same machine or on a remote VPS.",
    ctrlTitle: "How you control it",
    ctrlIntro:
      "You're not tied to one tool: manage the team from the desktop app, the terminal, or both together — same runtime, same features. And if you log in and sync your data to the cloud, you'll find it on the web too: open the dashboard and check it from your phone or any browser, without staying at the computer it runs on.",
    ctrlDesktopLabel: "Desktop app",
    ctrlDesktopBody:
      "The graphical remote control: it installs Docker, starts and stops the team, shows its status in real time, and connects to a VPS too.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "The same features from the command line. You can also hand them to your personal AI assistant, like Claude Code or OpenClaw.",
    ctrlBrowserLabel: "Browser",
    ctrlBrowserBody:
      "With login, open the dashboard from any browser, even your phone, and follow the team wherever you are.",
    ctrlWeb:
      "Login always stays optional: if you prefer, your data stays only on your computer, with no cloud at all.",
    ctaDownload: "Install →",
    back: "← Back to home",
  },
  es: {
    title: "Cómo se inicia",
    subtitle:
      "El equipo trabaja para ti día y noche, por eso necesita un ordenador siempre encendido: el tuyo, uno dedicado, o un servidor en la nube.",
    setupNote:
      "Todo parte de la app de escritorio: desde ahí configuras y comandas el equipo. La instalas en un ordenador a mano y desde ahí gestionas todo, tanto si el equipo corre en esa misma máquina como en una VPS remota.",
    ctrlTitle: "Cómo lo controlas",
    ctrlIntro:
      "No estás atado a una sola herramienta: gestionas el equipo desde la app de escritorio, el terminal, o ambos a la vez, con el mismo runtime y las mismas funciones. Y si inicias sesión y sincronizas los datos en la nube, lo tienes también en la web: abres la dashboard y la consultas desde el móvil o cualquier navegador, sin tener que quedarte en el ordenador donde corre.",
    ctrlDesktopLabel: "App de escritorio",
    ctrlDesktopBody:
      "El mando a distancia con interfaz gráfica: instala Docker, inicia y detiene el equipo, muestra su estado en tiempo real y también conecta una VPS.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "Las mismas funciones desde la línea de comandos. También puedes confiárselas a tu asistente de IA personal, como Claude Code u OpenClaw.",
    ctrlBrowserLabel: "Navegador",
    ctrlBrowserBody:
      "Con el inicio de sesión abres la dashboard desde cualquier navegador, incluso desde el móvil, y sigues al equipo estés donde estés.",
    ctrlWeb:
      "El inicio de sesión siempre es opcional: si lo prefieres, tus datos se quedan solo en tu ordenador, sin ninguna nube.",
    ctaDownload: "Instalar →",
    back: "← Volver al inicio",
  },
  fr: {
    title: "Comment le lancer",
    subtitle:
      "L'équipe travaille pour vous jour et nuit, elle a donc besoin d'un ordinateur toujours allumé : le vôtre, un dédié, ou un serveur dans le cloud.",
    setupNote:
      "Tout part de l'app de bureau : c'est là que vous configurez et pilotez l'équipe. Vous l'installez sur un ordinateur à portée de main et gérez tout depuis là, que l'équipe tourne sur cette même machine ou sur un VPS distant.",
    ctrlTitle: "Comment vous le contrôlez",
    ctrlIntro:
      "Vous n'êtes lié à aucun outil unique : vous gérez l'équipe depuis l'app de bureau, le terminal, ou les deux ensemble, avec le même runtime et les mêmes fonctions. Et si vous vous connectez et synchronisez vos données dans le cloud, vous la retrouvez aussi sur le web : ouvrez la dashboard et consultez-la depuis votre téléphone ou n'importe quel navigateur, sans rester à l'ordinateur où elle tourne.",
    ctrlDesktopLabel: "App de bureau",
    ctrlDesktopBody:
      "La télécommande à interface graphique : elle installe Docker, démarre et arrête l'équipe, affiche son état en temps réel et connecte aussi un VPS.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "Les mêmes fonctions depuis la ligne de commande. Vous pouvez aussi les confier à votre assistant d'IA personnel, comme Claude Code ou OpenClaw.",
    ctrlBrowserLabel: "Navigateur",
    ctrlBrowserBody:
      "Avec la connexion, ouvrez la dashboard depuis n'importe quel navigateur, même votre téléphone, et suivez l'équipe où que vous soyez.",
    ctrlWeb:
      "La connexion reste toujours facultative : si vous préférez, vos données restent uniquement sur votre ordinateur, sans aucun cloud.",
    ctaDownload: "Installer →",
    back: "← Retour à l'accueil",
  },
  de: {
    title: "So wird es gestartet",
    subtitle:
      "Das Team arbeitet Tag und Nacht für dich, also braucht es einen Computer, der immer läuft: deinen, einen eigenen oder einen Cloud-Server.",
    setupNote:
      "Alles beginnt mit der Desktop-App: Von dort aus konfigurierst und steuerst du das Team. Du installierst sie auf einem Computer in Reichweite und verwaltest von dort aus alles — egal, ob das Team auf derselben Maschine oder auf einem entfernten VPS läuft.",
    ctrlTitle: "So steuerst du es",
    ctrlIntro:
      "Du bist an kein einzelnes Werkzeug gebunden: Du verwaltest das Team über die Desktop-App, das Terminal oder beides zusammen — gleiche Laufzeitumgebung, gleiche Funktionen. Und wenn du dich anmeldest und deine Daten in die Cloud synchronisierst, findest du es auch im Web: Öffne die Dashboard und sieh sie dir vom Handy oder jedem Browser aus an, ohne am Computer bleiben zu müssen, auf dem es läuft.",
    ctrlDesktopLabel: "Desktop-App",
    ctrlDesktopBody:
      "Die Fernbedienung mit grafischer Oberfläche: Sie installiert Docker, startet und stoppt das Team, zeigt seinen Status in Echtzeit und verbindet auch einen VPS.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "Dieselben Funktionen über die Kommandozeile. Du kannst sie auch deinem persönlichen KI-Assistenten überlassen, wie Claude Code oder OpenClaw.",
    ctrlBrowserLabel: "Browser",
    ctrlBrowserBody:
      "Mit Anmeldung öffnest du die Dashboard von jedem Browser aus, sogar vom Handy, und verfolgst das Team, wo immer du bist.",
    ctrlWeb:
      "Die Anmeldung bleibt immer optional: Wenn du möchtest, bleiben deine Daten nur auf deinem Computer, ganz ohne Cloud.",
    ctaDownload: "Installieren →",
    back: "← Zurück zur Startseite",
  },
  hu: {
    title: "Hogyan indítható",
    subtitle:
      "A csapat éjjel-nappal dolgozik érted, ezért egy mindig bekapcsolt számítógépre van szüksége: a tiédre, egy dedikáltra, vagy egy felhőszerverre.",
    setupNote:
      "Minden az asztali appból indul: onnan állítod be és irányítod a csapatot. Egy kéznél lévő számítógépre telepíted, és onnan kezelsz mindent, akár ugyanazon a gépen fut a csapat, akár egy távoli VPS-en.",
    ctrlTitle: "Hogyan vezérled",
    ctrlIntro:
      "Nem vagy egyetlen eszközhöz kötve: az asztali appból, a terminálból, vagy a kettőből együtt kezeled a csapatot, ugyanazzal a futtatókörnyezettel és ugyanazokkal a funkciókkal. És ha bejelentkezel és a felhőbe szinkronizálod az adatokat, a weben is megtalálod: megnyitod a dashboardot, és a telefonodról vagy bármelyik böngészőből megnézed, anélkül hogy annál a gépnél kellene maradnod, amelyen fut.",
    ctrlDesktopLabel: "Asztali app",
    ctrlDesktopBody:
      "A grafikus felületű távirányító: telepíti a Dockert, elindítja és leállítja a csapatot, valós időben mutatja az állapotát, és VPS-hez is csatlakozik.",
    ctrlTerminalLabel: "Terminál (CLI / TUI)",
    ctrlTerminalBody:
      "Ugyanazok a funkciók a parancssorból. Rá is bízhatod őket a személyes AI-asszisztensedre, mint a Claude Code vagy az OpenClaw.",
    ctrlBrowserLabel: "Böngésző",
    ctrlBrowserBody:
      "Bejelentkezéssel bármelyik böngészőből megnyitod a dashboardot, akár a telefonodról is, és bárhol követheted a csapatot.",
    ctrlWeb:
      "A bejelentkezés mindig opcionális marad: ha úgy szeretnéd, az adataid csak a saját gépeden maradnak, felhő nélkül.",
    ctaDownload: "Telepítés →",
    back: "← Vissza a főoldalra",
  },
  pt: {
    title: "Como se inicia",
    subtitle:
      "A equipa trabalha para ti dia e noite, por isso precisa de um computador sempre ligado: o teu, um dedicado, ou um servidor na nuvem.",
    setupNote:
      "Tudo parte da app de ambiente de trabalho: é dali que configuras e comandas a equipa. Instala-la num computador à mão e geres tudo a partir daí, quer a equipa corra nessa mesma máquina, quer num VPS remoto.",
    ctrlTitle: "Como a controlas",
    ctrlIntro:
      "Não estás preso a uma só ferramenta: geres a equipa a partir da app de ambiente de trabalho, do terminal, ou de ambos juntos, com o mesmo runtime e as mesmas funções. E se iniciares sessão e sincronizares os dados na nuvem, encontra-la também na web: abres a dashboard e consulta-la a partir do telemóvel ou de qualquer navegador, sem teres de ficar no computador onde corre.",
    ctrlDesktopLabel: "App de ambiente de trabalho",
    ctrlDesktopBody:
      "O comando à distância com interface gráfica: instala o Docker, inicia e para a equipa, mostra o seu estado em tempo real e também liga um VPS.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "As mesmas funções a partir da linha de comandos. Também podes confiá-las ao teu assistente de IA pessoal, como o Claude Code ou o OpenClaw.",
    ctrlBrowserLabel: "Navegador",
    ctrlBrowserBody:
      "Com o início de sessão abres a dashboard a partir de qualquer navegador, até do telemóvel, e acompanhas a equipa onde quer que estejas.",
    ctrlWeb:
      "O início de sessão é sempre opcional: se preferires, os teus dados ficam só no teu computador, sem qualquer nuvem.",
    ctaDownload: "Instalar →",
    back: "← Voltar ao início",
  },
};

function SetupContent() {
  const { lang } = useLandingI18n();
  const L = (PAGE[lang as Lang] ? lang : "en") as Lang;
  const p = PAGE[L];

  const ctrlRows: { label: string; body: string }[] = [
    { label: p.ctrlDesktopLabel, body: p.ctrlDesktopBody },
    { label: p.ctrlTerminalLabel, body: p.ctrlTerminalBody },
  ];
  if ("ctrlBrowserLabel" in p && "ctrlBrowserBody" in p) {
    ctrlRows.push({ label: p.ctrlBrowserLabel, body: p.ctrlBrowserBody });
  }

  return (
    <>
      <LandingNav />
      <main className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-3">
            {p.title}
          </h1>
          <p className="text-[13px] md:text-[15px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">
            {p.subtitle}
          </p>
        </div>

        {/* Tre modalità */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
          {MODES.map((m) => (
            <div
              key={m.promptId}
              className="flex flex-col border border-[var(--color-border)] overflow-hidden"
              style={{ background: "var(--color-panel)" }}
            >
              <div className="aspect-[4/3] flex items-center justify-center p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.img}
                  alt={m[L].title}
                  width={1448}
                  height={1086}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="p-6 flex flex-col flex-1">
                <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-green)] mb-2">
                  {m.badge[L]}
                </span>
                <h3 className="text-[16px] font-bold text-[var(--color-white)] mb-2">
                  {m[L].title}
                </h3>
                <p className="text-[12px] text-[var(--color-bright)] leading-relaxed flex-1 mb-3">
                  {m[L].body}
                </p>
                <p className="text-[11px] text-[var(--color-muted)] border-t border-[var(--color-border)] pt-3">
                  {m[L].req}
                </p>
              </div>
            </div>
          ))}
        </section>

        {"setupNote" in p && (
          <div className="-mt-10 mb-16 border-l-2 border-[var(--color-green)] pl-4">
            <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
              {p.setupNote}
            </p>
          </div>
        )}

        {/* Come la controlli — desktop / terminale / assistente AI, unificato */}
        <section
          className="border border-[var(--color-border)] p-6 md:p-8 mb-16"
          style={{ background: "var(--color-panel)" }}
        >
          <h2 className="text-xl md:text-2xl font-bold text-[var(--color-white)] tracking-tight mb-3">
            {p.ctrlTitle}
          </h2>
          <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed mb-6">
            {p.ctrlIntro}
          </p>
          <div className="border-t border-[var(--color-border)]">
            {ctrlRows.map(({ label, body }) => (
              <div
                key={label}
                className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1.5 sm:gap-6 py-4 border-b border-[var(--color-border)]"
              >
                <div className="text-[13px] font-bold text-[var(--color-white)]">
                  {label}
                </div>
                <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
                  {body}
                </p>
              </div>
            ))}
          </div>
          {"ctrlWeb" in p && (
            <p className="text-[12px] md:text-[13px] text-[var(--color-muted)] leading-relaxed pt-4">
              {p.ctrlWeb}
            </p>
          )}
        </section>

        <div className="flex flex-col items-center gap-4">
          <Link
            href="/download"
            className="inline-flex items-center px-8 py-3.5 text-[13px] font-bold tracking-wider no-underline transition-all hover:opacity-90"
            style={{ background: "var(--color-green)", color: "#060608" }}
          >
            {p.ctaDownload}
          </Link>
          <Link
            href="/"
            className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
          >
            {p.back}
          </Link>
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  );
}

export default function SetupPage() {
  return (
    <LandingI18nProvider>
      <SetupContent />
    </LandingI18nProvider>
  );
}
