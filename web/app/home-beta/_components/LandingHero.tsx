"use client";

import { useLandingI18n } from "./LandingI18n";
import BetaTeamFlow from "./BetaTeamFlow";

export default function LandingHero() {
  const { t } = useLandingI18n();

  return (
    <section
      aria-label="Hero"
      className="flex flex-col items-center px-6 pt-20 pb-12"
    >
      <div
        className="relative z-10 w-full max-w-6xl mx-auto text-center"
        style={{ animation: "fade-in 0.6s ease both" }}
      >
        <h1 className="w-full text-3xl sm:text-5xl md:text-7xl font-extrabold tracking-tight text-[var(--color-white)] leading-[1.1] mb-6">
          Job Hunter <span className="text-[var(--color-green)]">Team</span>
        </h1>

        <p className="text-[13px] md:text-[15px] text-[var(--color-bright)] leading-relaxed max-w-xl mx-auto mb-4">
          {t("hero_desc_short")}
        </p>

        <div className="inline-flex items-center mb-5">
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">
            BETA
          </span>
        </div>
      </div>

      <div
        className="relative z-10 w-full max-w-6xl mt-6 px-2"
        style={{ animation: "fade-in 0.8s ease 0.2s both" }}
      >
        {/* Desktop: il team flow è "pinned" allo scroll. Il wrapper
            esterno fornisce 1.5 viewport (150vh) di "binario"; lo
            sticky child resta agganciato al top del viewport per tutta
            quella distanza, mentre lo scroll del browser continua a
            generare gli eventi che BetaTeamFlow consuma per far
            avanzare le pallaine. Niente flex center: il team flow
            mantiene la sua altezza naturale dal top dello sticky. */}
        {/* Pin del team flow.
            - sticky top: 5rem (80px) → scende sotto LandingNav (sticky
              top:0 z-50, ~80px alta), Captain emoji visibile.
            - sticky senza height esplicita → contiene naturalmente
              tutto BetaTeamFlow (team + globo): niente overflow che si
              sovrappone alla tabella sotto.
            - pin_height in px = top_offset (80) + pipeline (9×220=1980)
              + sticky_natural_height (~1300) + buffer ≈ 3500. */}
        <div
          className="hidden md:block relative"
          data-pin-section="team-flow"
          style={{ height: "3500px" }}
        >
          <div className="sticky" style={{ top: "5rem" }}>
            <BetaTeamFlow />
          </div>
        </div>

        <div className="md:hidden flex items-start justify-start gap-x-6 overflow-x-auto pb-3">
          {[
            "📡",
            "💂",
            "👨‍✈️",
            "⏱️",
            "🕵️",
            "👨‍🔬",
            "👨‍💻",
            "👨‍🏫",
            "👨‍⚖️",
          ].map((e, i) => (
            <span
              key={i}
              className="text-3xl leading-none shrink-0"
              aria-hidden="true"
            >
              {e}
            </span>
          ))}
        </div>
      </div>

    </section>
  );
}
