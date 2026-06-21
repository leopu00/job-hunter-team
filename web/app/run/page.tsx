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
  img?: string;
  badge: { it: string; en: string };
  it: { title: string; body: string; req: string };
  en: { title: string; body: string; req: string };
};

const MODES: Mode[] = [
  {
    promptId: "setup.local",
    img: "/run-local.png",
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
    img: "/run-dedicated.png",
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
    img: "/run-vps.png",
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
      "Scegli dove far girare la squadra e gestiscila come preferisci — app desktop, terminale, o entrambi insieme. Non sei legato a un solo strumento.",
    ctrlTitle: "Come la controlli",
    ctrlIntro:
      "Non sei legato a un solo strumento: app desktop, terminale, o entrambi insieme — stesso runtime, stesse funzioni.",
    ctrlDesktopLabel: "App desktop",
    ctrlDesktopBody:
      "Il telecomando con interfaccia grafica: installa Docker, avvia e ferma il team, ne mostra lo stato in tempo reale e collega anche una VPS.",
    ctrlTerminalLabel: "Terminale (CLI / TUI)",
    ctrlTerminalBody:
      "Le stesse cose dalla riga di comando, da alternare all'app desktop quando vuoi.",
    ctrlAssistant:
      "E non è un aut-aut: mentre usi la grafica desktop, puoi anche parlare con il tuo assistente AI personale — come Claude Code o OpenClaw — che dal terminale gestisce il team al posto tuo.",
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
      "macOS (Intel e Apple Silicon), Windows 10/11 e Linux. Tre strade per installare: l'app desktop con interfaccia grafica (DMG, EXE, AppImage), un singolo comando da terminale, oppure lasciando fare al tuo assistente AI.",
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
      "macOS (Intel and Apple Silicon), Windows 10/11 and Linux. Three ways to install: the desktop app with a graphical interface (DMG, EXE, AppImage), a single terminal command, or letting your AI assistant do it.",
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

        {/* Come la controlli — desktop / terminale / assistente AI, unificato */}
        <section className="border border-[var(--color-border)] p-6 md:p-8 mb-16" style={{ background: "var(--color-panel)" }}>
          <h2 className="text-xl md:text-2xl font-bold text-[var(--color-white)] tracking-tight mb-3">
            {p.ctrlTitle}
          </h2>
          <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed mb-6">
            {p.ctrlIntro}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-5">
            <div>
              <div className="text-[13px] font-bold text-[var(--color-white)] mb-1.5">
                {p.ctrlDesktopLabel}
              </div>
              <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
                {p.ctrlDesktopBody}
              </p>
            </div>
            <div>
              <div className="text-[13px] font-bold text-[var(--color-white)] mb-1.5">
                {p.ctrlTerminalLabel}
              </div>
              <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
                {p.ctrlTerminalBody}
              </p>
            </div>
          </div>
          <p className="text-[12px] md:text-[13px] text-[var(--color-muted)] leading-relaxed border-t border-[var(--color-border)] pt-4">
            {p.ctrlAssistant}
          </p>
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
