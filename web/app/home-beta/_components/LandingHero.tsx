"use client";

import { useEffect, useRef, useState } from "react";
import { useLandingI18n } from "./LandingI18n";
import BetaTeamFlow from "./BetaTeamFlow";

export default function LandingHero() {
  const { t } = useLandingI18n();
  const pinSecRef = useRef<HTMLDivElement | null>(null);
  // Phase 1 = pipeline sui pin nord (T ≤ 21960).
  // Phase 2 = round 2, il globo deve essere CENTRATO nel viewport.
  // Sticky top viene spostato verso l'alto in fase 2 così il team flow
  // esce dal viewport in alto e il globo sale al centro.
  const [isPhase2, setIsPhase2] = useState(false);

  useEffect(() => {
    const ROUND1_END_T = 6840; // px di scroll dopo cui finisce round 1
    const STICKY_TOP_OFFSET_PX = 80;
    let last = false;
    const onScroll = () => {
      const sec = pinSecRef.current;
      if (!sec) return;
      const rectTop = sec.getBoundingClientRect().top;
      const T = Math.max(0, STICKY_TOP_OFFSET_PX - rectTop);
      const next = T > ROUND1_END_T;
      if (next !== last) {
        last = next;
        setIsPhase2(next);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Calcolo del top in fase 2:
  //   sticky_top = (viewport_height - globe_height) / 2 - team_height
  // Con globe_height ≈ 90vh (min(90vh, 90vw)) e team_height (Captain +
  // gaps + pipeline) ≈ 384 px → sticky_top = 5vh - 384 px.
  // Negativo: sticky parte sopra il viewport, team flow esce in alto,
  // globo arriva al centro.
  const stickyTop = isPhase2 ? "calc(5vh - 384px)" : "5rem";

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
            {t("hero_badge")}
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
            - DURATION = 360 px per pallina. Count decrescente lungo la
              pipeline (Scout 5 → Analyst 4 → Scorer 3 → Writer 2)
              così alcune offerte "saltano" lo step successivo.
              ROUND 1: 5 single + (5+4+3+2) palline = 19 unità × 360 = 6840
              ROUND 2: 1 single + 4 palline       = 5 unità × 360  = 1800
              TOTAL pipeline_T = 8640.
            - pin_height esteso di ~500 px oltre fine pipeline così
              durante fase 2 centrata si arriva a un giro totale di
              360° (~290° dai lerp + ~70° di POST_PIPELINE). Lo sticky
              rilascia subito dopo, la tabella sale dal basso mentre
              il globo continua a girare. */}
        <div
          ref={pinSecRef}
          className="hidden md:block relative"
          data-pin-section="team-flow"
          style={{ height: "10000px" }}
        >
          <div
            className="sticky"
            style={{
              top: stickyTop,
              transition: "top 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <BetaTeamFlow />
          </div>
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
