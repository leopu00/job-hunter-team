"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";
import ImagePlaceholder from "../components/landing/ImagePlaceholder";

type Lang = "it" | "en" | "es" | "fr" | "de" | "pt" | "hu";

type ModeText = { title: string; body: string; req: string };

type Mode = {
  promptId: string;
  img?: string;
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
    ctaDownload: "Scarica l'app →",
    back: "← Torna alla home",
  },
  en: {
    title: "How to run it",
    subtitle:
      "Choose where the team runs and manage it however you like — desktop app, terminal, or both together. You're never locked into a single tool.",
    ctrlTitle: "How you control it",
    ctrlIntro:
      "You're not tied to one tool: desktop app, terminal, or both together — same runtime, same features.",
    ctrlDesktopLabel: "Desktop app",
    ctrlDesktopBody:
      "The graphical remote control: it installs Docker, starts and stops the team, shows its status in real time, and connects to a VPS too.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "The same things from the command line, to switch with the desktop app whenever you like.",
    ctrlAssistant:
      "And it's not either/or: while you use the desktop interface, you can also talk to your personal AI assistant — like Claude Code or OpenClaw — which manages the team for you from the terminal.",
    ctaDownload: "Download the app →",
    back: "← Back to home",
  },
  es: {
    title: "Cómo se inicia",
    subtitle:
      "Elige dónde hacer funcionar el equipo y gestiónalo como prefieras — app de escritorio, terminal, o ambos a la vez. No estás atado a una sola herramienta.",
    ctrlTitle: "Cómo lo controlas",
    ctrlIntro:
      "No estás atado a una sola herramienta: app de escritorio, terminal, o ambos a la vez — mismo runtime, mismas funciones.",
    ctrlDesktopLabel: "App de escritorio",
    ctrlDesktopBody:
      "El mando a distancia con interfaz gráfica: instala Docker, inicia y detiene el equipo, muestra su estado en tiempo real y también conecta una VPS.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "Las mismas cosas desde la línea de comandos, para alternar con la app de escritorio cuando quieras.",
    ctrlAssistant:
      "Y no es uno u otro: mientras usas la interfaz gráfica de escritorio, también puedes hablar con tu asistente de IA personal — como Claude Code u OpenClaw — que desde el terminal gestiona el equipo en tu lugar.",
    ctaDownload: "Descarga la app →",
    back: "← Volver al inicio",
  },
  fr: {
    title: "Comment le lancer",
    subtitle:
      "Choisissez où faire tourner l'équipe et gérez-la comme vous le souhaitez — app de bureau, terminal, ou les deux ensemble. Vous n'êtes lié à aucun outil unique.",
    ctrlTitle: "Comment vous le contrôlez",
    ctrlIntro:
      "Vous n'êtes pas lié à un seul outil : app de bureau, terminal, ou les deux ensemble — même runtime, mêmes fonctions.",
    ctrlDesktopLabel: "App de bureau",
    ctrlDesktopBody:
      "La télécommande à interface graphique : elle installe Docker, démarre et arrête l'équipe, affiche son état en temps réel et connecte aussi un VPS.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "Les mêmes choses depuis la ligne de commande, à alterner avec l'app de bureau quand vous le voulez.",
    ctrlAssistant:
      "Et ce n'est pas l'un ou l'autre : pendant que vous utilisez l'interface graphique de bureau, vous pouvez aussi parler à votre assistant d'IA personnel — comme Claude Code ou OpenClaw — qui, depuis le terminal, gère l'équipe à votre place.",
    ctaDownload: "Téléchargez l'app →",
    back: "← Retour à l'accueil",
  },
  de: {
    title: "So wird es gestartet",
    subtitle:
      "Wähle, wo das Team läuft, und verwalte es, wie du möchtest — Desktop-App, Terminal oder beides zusammen. Du bist an kein einzelnes Werkzeug gebunden.",
    ctrlTitle: "So steuerst du es",
    ctrlIntro:
      "Du bist nicht an ein einziges Werkzeug gebunden: Desktop-App, Terminal oder beides zusammen — gleiche Laufzeitumgebung, gleiche Funktionen.",
    ctrlDesktopLabel: "Desktop-App",
    ctrlDesktopBody:
      "Die Fernbedienung mit grafischer Oberfläche: Sie installiert Docker, startet und stoppt das Team, zeigt seinen Status in Echtzeit und verbindet auch einen VPS.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "Dasselbe über die Kommandozeile, um nach Belieben mit der Desktop-App zu wechseln.",
    ctrlAssistant:
      "Und es ist kein Entweder-oder: Während du die grafische Desktop-Oberfläche nutzt, kannst du auch mit deinem persönlichen KI-Assistenten sprechen — wie Claude Code oder OpenClaw — der vom Terminal aus das Team für dich verwaltet.",
    ctaDownload: "App herunterladen →",
    back: "← Zurück zur Startseite",
  },
  hu: {
    title: "Hogyan indítható",
    subtitle:
      "Válaszd ki, hol fusson a csapat, és kezeld úgy, ahogy szeretnéd — asztali app, terminál, vagy a kettő együtt. Soha nem vagy egyetlen eszközhöz kötve.",
    ctrlTitle: "Hogyan vezérled",
    ctrlIntro:
      "Nem vagy egyetlen eszközhöz kötve: asztali app, terminál, vagy a kettő együtt — ugyanaz a futtatókörnyezet, ugyanazok a funkciók.",
    ctrlDesktopLabel: "Asztali app",
    ctrlDesktopBody:
      "A grafikus felületű távirányító: telepíti a Dockert, elindítja és leállítja a csapatot, valós időben mutatja az állapotát, és VPS-hez is csatlakozik.",
    ctrlTerminalLabel: "Terminál (CLI / TUI)",
    ctrlTerminalBody:
      "Ugyanazok a dolgok a parancssorból, hogy tetszés szerint válts az asztali appal.",
    ctrlAssistant:
      "És nem vagy-vagy: miközben az asztali grafikus felületet használod, beszélgethetsz is a személyes AI-asszisztenseddel — mint a Claude Code vagy az OpenClaw —, amely a terminálból helyetted kezeli a csapatot.",
    ctaDownload: "Töltsd le az appot →",
    back: "← Vissza a főoldalra",
  },
  pt: {
    title: "Como se inicia",
    subtitle:
      "Escolhe onde a equipa funciona e gere-a como preferires — app de ambiente de trabalho, terminal, ou ambos juntos. Nunca ficas preso a uma única ferramenta.",
    ctrlTitle: "Como a controlas",
    ctrlIntro:
      "Não estás preso a uma só ferramenta: app de ambiente de trabalho, terminal, ou ambos juntos — mesmo runtime, mesmas funções.",
    ctrlDesktopLabel: "App de ambiente de trabalho",
    ctrlDesktopBody:
      "O comando à distância com interface gráfica: instala o Docker, inicia e para a equipa, mostra o seu estado em tempo real e também liga um VPS.",
    ctrlTerminalLabel: "Terminal (CLI / TUI)",
    ctrlTerminalBody:
      "As mesmas coisas a partir da linha de comandos, para alternar com a app de ambiente de trabalho quando quiseres.",
    ctrlAssistant:
      "E não é um ou outro: enquanto usas a interface gráfica de ambiente de trabalho, também podes falar com o teu assistente de IA pessoal — como o Claude Code ou o OpenClaw — que, a partir do terminal, gere a equipa por ti.",
    ctaDownload: "Transfere a app →",
    back: "← Voltar ao início",
  },
};

function SetupContent() {
  const { lang } = useLandingI18n();
  const L = (PAGE[lang as Lang] ? lang : "en") as Lang;
  const p = PAGE[L];

  const ctrlRows: [string, string][] = [
    [p.ctrlDesktopLabel, p.ctrlDesktopBody],
    [p.ctrlTerminalLabel, p.ctrlTerminalBody],
  ];
  if ("ctrlBrowserLabel" in p && "ctrlBrowserBody" in p) {
    ctrlRows.push([p.ctrlBrowserLabel, p.ctrlBrowserBody]);
  }

  return (
    <>
      <LandingNav />
      <main
        className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto"
        style={{ animation: "fade-in 0.4s ease both" }}
      >
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
              {m.img ? (
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
              ) : (
                <ImagePlaceholder
                  label={m[L].title}
                  promptId={m.promptId}
                  aspect="4 / 3"
                />
              )}
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
            {ctrlRows.map(([label, body]) => (
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
