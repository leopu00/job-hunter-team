"use client";

import Link from "next/link";
import { LandingI18nProvider, useLandingI18n } from "./LandingI18n";
import LandingCTA, { LandingFooter } from "./LandingCTA";
import LandingNav from "./LandingNav";
import LandingGlobe from "./LandingGlobe";
import HomeTrailer from "../public-media/HomeTrailer";

// Landing pubblica — nuova struttura.
// Header (nav) + hero (titolo + immagine + intro) + sezioni di anteprima
// (Team, Avvio, Prezzi) ognuna con un rimando alla pagina
// dedicata, + footer. Il vecchio sito pubblico resta nei suoi file, non
// importato qui, pronto da archiviare in futuro.
export default function LandingHome() {
  return (
    <LandingI18nProvider>
      <LandingNav />
      <main id="main-content">
        <Hero />
        <Sections />
        <LandingCTA />
      </main>
      <LandingFooter />
    </LandingI18nProvider>
  );
}

function Hero() {
  const { t } = useLandingI18n();

  return (
    // Niente px-6 sulla section: il globo sotto deve arrivare ai bordi
    // della finestra, quindi il padding orizzontale sta sui soli blocchi
    // di testo (titolo e paragrafo introduttivo).
    <section className="flex flex-col items-center pt-28 pb-12 text-center">
      <div className="w-full max-w-4xl mx-auto px-6">
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

      {/* Vetrina hero — il globo delle posizioni (riuso del globo di
          /map in modalità showcase: ruota da solo, vola sulle città e
          mostra ricerche localizzate con punteggi). Full-bleed su richiesta:
          niente box, niente bordo, niente brackets — la fascia occupa
          tutta la larghezza della finestra. Il fuori-colonna si ottiene
          per layout (padding solo sui blocchi di testo), NON con 100vw:
          su desktop 100vw include la barra di scorrimento (overflow
          orizzontale) e il body è zoomato (--zoom), che falserebbe il
          calcolo. Il raccordo con la pagina lo fanno le sfumature
          interne a LandingGlobe. */}
      <div data-landing-globe className="w-full mt-12">
        <LandingGlobe />
      </div>

      <HomeTrailer />

      {/* Paragrafo introduttivo — descrive la piattaforma, sotto l'hero. */}
      <p className="mt-10 max-w-2xl mx-auto px-6 text-[14px] md:text-[16px] text-[var(--color-bright)] leading-relaxed">
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

function Sections() {
  const { t } = useLandingI18n();

  const team: SectionCopy = {
    kicker: t("home_team_kicker"),
    title: t("home_team_title"),
    body: t("home_team_body"),
    cta: t("home_team_cta"),
  };
  const setup: SectionCopy = {
    kicker: t("home_setup_kicker"),
    title: t("home_setup_title"),
    body: t("home_setup_body"),
    cta: t("home_setup_cta"),
  };
  const pricing: SectionCopy = {
    kicker: t("home_pricing_kicker"),
    title: t("home_pricing_title"),
    body: t("home_pricing_body"),
    cta: t("home_pricing_cta"),
  };

  return (
    <div className="px-6 pb-12 flex flex-col gap-24 md:gap-28 max-w-6xl mx-auto mt-12 md:mt-20">
      <Block
        copy={team}
        href="/agents"
        visual={
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/landing-team.png"
            alt={t("home_team_alt")}
            width={1672}
            height={941}
            className="w-full h-auto"
          />
        }
      />
      <Block
        copy={setup}
        href="/run"
        reverse
        visual={
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/landing-setup.png"
            alt={t("home_setup_alt")}
            width={1672}
            height={941}
            className="w-full h-auto"
          />
        }
      />
      <Block
        copy={pricing}
        href="/pricing"
        visual={
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/landing-pricing.png"
            alt={t("home_pricing_alt")}
            width={1448}
            height={1086}
            className="w-full h-auto max-w-xs mx-auto"
          />
        }
      />
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
