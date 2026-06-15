"use client";

import { LandingI18nProvider, useLandingI18n } from "./LandingI18n";
import { LandingFooter } from "./LandingCTA";

// Landing pubblica — versione "clean slate".
// Per ora contiene il titolo (brand + tagline + badge beta), l'immagine
// hero (fumetto del team con occhiali da sole) e il footer condiviso.
// Tutto il resto del vecchio sito pubblico (nav, hero globo, tabella
// offerte, CTA, BetaTeamFlow…) resta nei file originali, non importati
// qui, pronti da archiviare in futuro. Da qui si ricostruirà la landing.
export default function LandingHome() {
  return (
    <LandingI18nProvider>
      <div className="flex min-h-screen flex-col">
        <HeroTitle />
        <LandingFooter />
      </div>
    </LandingI18nProvider>
  );
}

function HeroTitle() {
  const { t, lang } = useLandingI18n();

  const heroAlt =
    lang === "it"
      ? "Illustrazione a fumetto: un team di agenti AI — tutti con gli stessi occhiali da sole neri — seduto attorno a un lungo tavolo da riunione in un elegante ufficio in grattacielo, mentre un agente in piedi presenta dei grafici su una lavagna."
      : "Comic-style illustration: a team of AI agents — all wearing the same black sunglasses — seated around a long boardroom table in an elegant high-rise office, while one standing agent presents charts on a whiteboard.";

  return (
    <main
      id="main-content"
      className="flex flex-1 flex-col items-center px-6 pt-24 pb-16 text-center"
    >
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

      {/* Immagine hero — fumetto del team con occhiali da sole. Stessa
          maschera sfumata (gradiente verticale × orizzontale intersecati)
          delle cover Cronache, così l'immagine si fonde nello sfondo scuro. */}
      <div
        className="w-full max-w-6xl mx-auto mt-12"
        style={{ animation: "fade-in 0.8s ease 0.15s both" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/landing-hero.png"
          alt={heroAlt}
          width={1672}
          height={941}
          fetchPriority="high"
          className="w-full h-auto"
          style={{
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, #000 14%, #000 82%, transparent 100%), linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%)",
            WebkitMaskComposite: "source-in",
            maskImage:
              "linear-gradient(to bottom, transparent 0%, #000 14%, #000 82%, transparent 100%), linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%)",
            maskComposite: "intersect",
          }}
        />
      </div>
    </main>
  );
}
