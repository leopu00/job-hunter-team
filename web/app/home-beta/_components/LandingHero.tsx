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
        <div className="hidden md:block">
          <BetaTeamFlow />
        </div>

        <div className="md:hidden flex items-start justify-start gap-x-6 overflow-x-auto pb-3">
          {["📡", "💂", "👨‍✈️", "⏱️", "🕵️", "👨‍🔬", "👨‍💻", "👨‍🏫", "👨‍⚖️"].map(
            (e, i) => (
              <span
                key={i}
                className="text-3xl leading-none shrink-0"
                aria-hidden="true"
              >
                {e}
              </span>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
