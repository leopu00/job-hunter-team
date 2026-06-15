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

type Mode = {
  promptId: string;
  badge: { it: string; en: string };
  it: { title: string; body: string; req: string };
  en: { title: string; body: string; req: string };
};

const MODES: Mode[] = [
  {
    promptId: "setup.local",
    badge: { it: "Più semplice", en: "Simplest" },
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
  },
  {
    promptId: "setup.dedicated",
    badge: { it: "Consigliato", en: "Recommended" },
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
  },
  {
    promptId: "setup.vps",
    badge: { it: "Consigliato", en: "Recommended" },
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
  },
];

const PAGE = {
  it: {
    title: "Come si avvia",
    subtitle:
      "Tante modalità, un solo telecomando. Scegli dove far girare la squadra e gestisci tutto dall'app desktop.",
    appTitle: "L'app desktop «Team locale»",
    appBody:
      "È il telecomando della squadra: installa Docker per te, configura il provider AI, avvia e ferma il team, ne mostra lo stato in tempo reale e ti collega anche al team che gira su una VPS. L'interazione vera e propria — vedere le posizioni, leggere i punteggi, chiedere un CV — avviene poi dal web, da Telegram o dalla riga di comando.",
    appPoints: [
      "Avviare e fermare il team con un clic",
      "Configurare il provider AI e l'autenticazione",
      "Vedere lo stato della squadra e dei consumi",
      "Collegarti e gestire il team su una VPS",
    ],
    reqTitle: "Requisiti minimi",
    reqRows: [
      ["Docker", "Obbligatorio — l'unica vera dipendenza"],
      ["RAM", "4 GB minimo · 8 GB consigliati"],
      ["CPU", "2 core minimo · 4 consigliati"],
      ["Disco", "~35 GB liberi"],
      ["VPS", "4 GB RAM · 2 vCPU (per la modalità cloud)"],
    ],
    osTitle: "Sistemi supportati",
    osBody:
      "macOS (Intel e Apple Silicon), Windows 10/11 e Linux. Due strade per installare: l'app desktop con interfaccia grafica (DMG, EXE, AppImage) oppure un singolo comando da terminale per chi è più tecnico.",
    ctaDownload: "Scarica l'app →",
    back: "← Torna alla home",
  },
  en: {
    title: "How to run it",
    subtitle:
      "Many ways, one remote control. Choose where the team runs and manage everything from the desktop app.",
    appTitle: "The “Local Team” desktop app",
    appBody:
      "It's the team's remote control: it installs Docker for you, configures the AI provider, starts and stops the team, shows its status in real time, and also connects you to a team running on a VPS. The actual interaction — viewing positions, reading scores, asking for a CV — then happens from the web, Telegram or the command line.",
    appPoints: [
      "Start and stop the team with one click",
      "Configure the AI provider and authentication",
      "See the team's status and spending",
      "Connect to and manage the team on a VPS",
    ],
    reqTitle: "Minimum requirements",
    reqRows: [
      ["Docker", "Required — the only real dependency"],
      ["RAM", "4 GB minimum · 8 GB recommended"],
      ["CPU", "2 cores minimum · 4 recommended"],
      ["Disk", "~35 GB free"],
      ["VPS", "4 GB RAM · 2 vCPU (for cloud mode)"],
    ],
    osTitle: "Supported systems",
    osBody:
      "macOS (Intel and Apple Silicon), Windows 10/11 and Linux. Two ways to install: the desktop app with a graphical interface (DMG, EXE, AppImage) or a single terminal command for the more technical.",
    ctaDownload: "Download the app →",
    back: "← Back to home",
  },
};

function SetupContent() {
  const { lang } = useLandingI18n();
  const L = lang === "it" ? "it" : "en";
  const p = PAGE[L];

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
              <ImagePlaceholder
                label={m[L].title}
                promptId={m.promptId}
                aspect="4 / 3"
              />
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

        {/* App desktop */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10 items-center mb-16">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-[var(--color-white)] tracking-tight mb-4">
              {p.appTitle}
            </h2>
            <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed mb-5">
              {p.appBody}
            </p>
            <ul className="flex flex-col gap-2">
              {p.appPoints.map((pt, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-[13px] text-[var(--color-bright)]"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 inline-block w-1.5 h-1.5 shrink-0"
                    style={{ background: "var(--color-green)" }}
                  />
                  {pt}
                </li>
              ))}
            </ul>
          </div>
          <ImagePlaceholder
            label={
              L === "it"
                ? "Schermata dell'app desktop: pulsanti Avvia/Ferma, stato del team"
                : "Desktop app screen: Start/Stop buttons, team status"
            }
            promptId="setup.app"
            aspect="4 / 3"
          />
        </section>

        {/* Requisiti */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10 mb-16">
          <div>
            <h2 className="text-lg md:text-xl font-bold text-[var(--color-white)] tracking-tight mb-5">
              {p.reqTitle}
            </h2>
            <div className="flex flex-col">
              {p.reqRows.map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-4 py-2.5 border-b border-[var(--color-border)]"
                >
                  <span className="text-[12px] font-semibold tracking-wide text-[var(--color-white)]">
                    {k}
                  </span>
                  <span className="text-[12px] text-[var(--color-muted)] text-right">
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-lg md:text-xl font-bold text-[var(--color-white)] tracking-tight mb-5">
              {p.osTitle}
            </h2>
            <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed mb-6">
              {p.osBody}
            </p>
            <div className="flex flex-wrap gap-2">
              {["macOS", "Windows", "Linux"].map((os) => (
                <span
                  key={os}
                  className="text-[11px] font-semibold tracking-wide text-[var(--color-bright)] border border-[var(--color-border)] px-3 py-1.5"
                  style={{ background: "var(--color-panel)" }}
                >
                  {os}
                </span>
              ))}
            </div>
          </div>
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
