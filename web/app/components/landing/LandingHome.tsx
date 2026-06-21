"use client";

import Link from "next/link";
import { LandingI18nProvider, useLandingI18n } from "./LandingI18n";
import { LandingFooter } from "./LandingCTA";
import LandingNav from "./LandingNav";
import DashboardMockup from "./DashboardMockup";

// Landing pubblica — nuova struttura.
// Header (nav) + hero (titolo + immagine + intro) + sezioni di anteprima
// (Team, Dashboard, Avvio, Prezzi) ognuna con un rimando alla pagina
// dedicata, + footer. Il vecchio sito pubblico resta nei suoi file, non
// importato qui, pronto da archiviare in futuro.
export default function LandingHome() {
  return (
    <LandingI18nProvider>
      <LandingNav />
      <main id="main-content">
        <Hero />
        <Sections />
      </main>
      <LandingFooter />
    </LandingI18nProvider>
  );
}

function Hero() {
  const { t, lang } = useLandingI18n();

  const heroAlt =
    lang === "it"
      ? "Illustrazione a fumetto: un team di agenti AI — tutti con gli stessi occhiali da sole neri — seduto attorno a un lungo tavolo da riunione in un elegante ufficio in grattacielo, mentre un agente in piedi presenta dei grafici su una lavagna."
      : "Comic-style illustration: a team of AI agents — all wearing the same black sunglasses — seated around a long boardroom table in an elegant high-rise office, while one standing agent presents charts on a whiteboard.";

  return (
    <section className="flex flex-col items-center px-6 pt-28 pb-12 text-center">
      <div
        className="w-full max-w-4xl mx-auto"
        style={{ animation: "fade-in 0.6s ease both" }}
      >
        <h1 className="w-full text-3xl sm:text-5xl md:text-7xl font-extrabold tracking-tight text-[var(--color-white)] leading-[1.1] mb-6">
          Job Hunter <span className="text-[var(--color-green)]">Team</span>
        </h1>

        <p className="text-[13px] md:text-[15px] text-[var(--color-bright)] leading-relaxed max-w-xl mx-auto mb-4">
          {t("hero_desc_short")}
        </p>

        <div className="inline-flex items-center">
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">
            {t("hero_badge")}
          </span>
        </div>
      </div>

      {/* Immagine hero — fumetto del team con occhiali da sole. Resa come
          "pannello / viewport" coerente con lo stile matrix-grid + comics:
          bordo netto (linea della griglia, adattivo al tema) e brackets HUD
          verdi ai 4 angoli, stile vignetta da fumetto / mirino da terminale.
          Niente dissolvenza. */}
      <div
        className="relative w-full max-w-6xl mx-auto mt-12"
        style={{ animation: "fade-in 0.8s ease 0.15s both" }}
      >
        <div className="relative border border-[var(--color-border)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/landing-hero.png"
            alt={heroAlt}
            width={1672}
            height={941}
            fetchPriority="high"
            className="block w-full h-auto"
          />
          {/* Brackets HUD ai 4 angoli (L formate da due bordi), sporgenti un
              filo oltre il pannello per un look da mirino/terminale. */}
          {[
            "top-0 left-0 border-t-2 border-l-2",
            "top-0 right-0 border-t-2 border-r-2",
            "bottom-0 left-0 border-b-2 border-l-2",
            "bottom-0 right-0 border-b-2 border-r-2",
          ].map((pos, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`pointer-events-none absolute ${pos} w-6 h-6`}
              style={{ borderColor: "var(--color-green)", margin: "-2px" }}
            />
          ))}
        </div>
      </div>

      {/* Paragrafo introduttivo — descrive la piattaforma, sotto l'hero. */}
      <p
        className="mt-10 max-w-2xl mx-auto text-[14px] md:text-[16px] text-[var(--color-bright)] leading-relaxed"
        style={{ animation: "fade-in 0.8s ease 0.3s both" }}
      >
        {t("home_intro")}
      </p>
    </section>
  );
}

type SectionCopy = {
  kicker: string;
  title: string;
  body: string;
  cta: string;
  note?: string;
};

const COPY: Record<"it" | "en", Record<string, SectionCopy>> = {
  it: {
    team: {
      kicker: "Il team",
      title: "Una squadra, non un singolo bot",
      body: "Dietro Job Hunter Team c'è una squadra di agenti AI specializzati: chi cerca le offerte, chi le verifica, chi le valuta, chi scrive il tuo CV e chi lo critica senza pietà. Ognuno fa una cosa, e la fa bene.",
      cta: "Scopri il team →",
    },
    dashboard: {
      kicker: "La tua dashboard",
      title: "Tutto sotto controllo, dal web",
      body: "Vedi ogni posizione trovata, il punteggio di compatibilità, la mappa delle opportunità per città e paese, lo stato delle tue candidature. Registrati per ritrovare tutto ovunque — ma non è obbligatorio: puoi tenere ogni dato solo sul tuo computer, senza cloud.",
      cta: "Accedi o registrati →",
      note: "Login facoltativo · i tuoi dati possono restare solo sul tuo PC.",
    },
    setup: {
      kicker: "Avvialo",
      title: "Come vuoi, dove vuoi",
      body: "Sul tuo PC con Docker, su un computer dedicato sempre acceso o su una VPS economica che lavora per te giorno e notte. Tutto si gestisce dall'app desktop: avvii, fermi e tieni d'occhio la squadra con un clic.",
      cta: "Come si avvia →",
    },
    pricing: {
      kicker: "Prezzi",
      title: "Open source. La piattaforma è gratis.",
      body: "Job Hunter Team non si paga. L'unico costo è l'abbonamento al provider AI che scegli — da circa €40 al mese — oppure nulla, se un domani userai modelli locali e pagherai solo l'elettricità.",
      cta: "Vedi i costi →",
    },
    project: {
      kicker: "Il progetto",
      title: "Cosa c'è dietro, in chiaro",
      body: "Codice aperto, dati tuoi, nessun vincolo. Scopri com'è fatto Job Hunter Team, la filosofia dietro alla squadra di agenti e dove sta andando.",
      cta: "Scopri il progetto →",
    },
    studies: {
      kicker: "Case studies",
      title: "Cosa fa davvero, sul campo",
      body: "Non promesse, ma risultati: cosa ha prodotto il team su profili candidato reali — posizioni trovate, analizzate e valutate. Dati aggregati e anonimi, una pagina che cresce a ogni nuovo team monitorato.",
      cta: "Vedi i case study →",
    },
  },
  en: {
    team: {
      kicker: "The team",
      title: "A team, not a single bot",
      body: "Behind Job Hunter Team is a team of specialized AI agents: one finds the openings, one vets them, one scores them, one writes your CV and one critiques it without mercy. Each does one thing, and does it well.",
      cta: "Meet the team →",
    },
    dashboard: {
      kicker: "Your dashboard",
      title: "Everything in view, from the web",
      body: "See every opening found, its match score, the map of opportunities by city and country, the status of your applications. Sign up to find it all anywhere — but it's not required: you can keep every piece of data on your own computer, no cloud.",
      cta: "Sign in or sign up →",
      note: "Login optional · your data can stay only on your PC.",
    },
    setup: {
      kicker: "Run it",
      title: "However and wherever you want",
      body: "On your PC with Docker, on an always-on dedicated computer, or on an affordable VPS that works for you day and night. It's all managed from the desktop app: start, stop and keep an eye on the team with one click.",
      cta: "How to run it →",
    },
    pricing: {
      kicker: "Pricing",
      title: "Open source. The platform is free.",
      body: "Job Hunter Team is free. The only cost is the subscription to the AI provider you choose — from about €40 a month — or nothing, if one day you use local models and pay only for electricity.",
      cta: "See the costs →",
    },
    project: {
      kicker: "The project",
      title: "What's behind it, in the open",
      body: "Open code, your data, no lock-in. See how Job Hunter Team is built, the philosophy behind the agent team, and where it's headed.",
      cta: "Discover the project →",
    },
    studies: {
      kicker: "Case studies",
      title: "What it really does, in the field",
      body: "Not promises but results: what the team produced on real candidate profiles — positions found, analyzed and scored. Aggregated, anonymous data; a page that grows with every team we monitor.",
      cta: "See the case studies →",
    },
  },
};

function Sections() {
  const { lang } = useLandingI18n();
  const L = lang === "it" ? "it" : "en";
  const c = COPY[L];

  return (
    <div className="px-6 pb-12 flex flex-col gap-24 md:gap-28 max-w-6xl mx-auto mt-12 md:mt-20">
      <Block
        copy={c.team}
        href="/agents"
        visual={
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/landing-team.png"
            alt={
              L === "it"
                ? "Tre agenti del team a figura intera: lo Scout con la lente, l'Analista in camice, lo Scrittore con la penna d'oca — tutti con gli occhiali da sole."
                : "Three full-body team agents: the Scout with a magnifying glass, the Analyst in a lab coat, the Writer with a quill pen — all wearing sunglasses."
            }
            width={1672}
            height={941}
            className="w-full h-auto"
          />
        }
      />
      <Block
        copy={c.dashboard}
        href="/?login=true"
        visual={<DashboardMockup />}
        reverse
      />
      <Block
        copy={c.setup}
        href="/run"
        visual={
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/landing-setup.png"
            alt={
              L === "it"
                ? "Un laptop da cui esce un cono di luce blu che si apre fino a un cubo di vetro luminoso: dentro c'è l'ufficio del team al lavoro."
                : "A laptop emitting a blue cone of light that opens into a glowing glass cube: inside is the team's office at work."
            }
            width={1672}
            height={941}
            className="w-full h-auto"
          />
        }
      />
      <Block copy={c.pricing} href="/pricing" />
      <Block copy={c.project} href="/project" />
      <Block copy={c.studies} href="/case-studies" />
    </div>
  );
}

function Block({
  copy,
  href,
  visual,
  reverse = false,
}: {
  copy: SectionCopy;
  href: string;
  visual?: React.ReactNode;
  reverse?: boolean;
}) {
  const text = (
    <>
      <div className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)] mb-3">
        {copy.kicker}
      </div>
      <h2 className="text-xl md:text-3xl font-bold text-[var(--color-white)] tracking-tight leading-[1.15] mb-4">
        {copy.title}
      </h2>
      <p className="text-[13px] md:text-[15px] text-[var(--color-bright)] leading-relaxed mb-5">
        {copy.body}
      </p>
      <Link
        href={href}
        className="inline-flex items-center text-[13px] font-bold tracking-wide text-[var(--color-green)] hover:opacity-80 transition-opacity no-underline"
      >
        {copy.cta}
      </Link>
      {copy.note && (
        <p className="mt-3 text-[11px] text-[var(--color-muted)]">
          {copy.note}
        </p>
      )}
    </>
  );

  // Sezione senza immagine: blocco di testo centrato, niente placeholder.
  if (!visual) {
    return (
      <section className="flex flex-col items-center text-center max-w-2xl mx-auto">
        {text}
      </section>
    );
  }

  return (
    <section
      className={`flex flex-col gap-6 md:gap-12 items-center ${
        reverse ? "md:flex-row-reverse" : "md:flex-row"
      }`}
    >
      <div className="w-full md:w-1/2">{visual}</div>
      <div className="w-full md:w-1/2">{text}</div>
    </section>
  );
}
