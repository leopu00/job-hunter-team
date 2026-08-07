"use client";

// Una fase: numero, titolo, testo, eventuale avvertenza, schermata, link.
//
// Il numero mostrato è la posizione della fase FRA QUELLE VISIBILI per il
// sistema scelto: chi sta su Windows non deve vedere «passo 4» dopo il 2
// perché il 3 era di macOS.

import GuideLinks from "./GuideLinks";
import GuideScreenFigure from "./GuideScreenFigure";
import RequirementsCard from "./RequirementsCard";
import { GUIDE_UI } from "./guide-ui.i18n";
import { screensOf, type GuidePhase, type OsId } from "./guide-types";
import type { Lang } from "../components/landing/LandingI18n";

export default function GuidePhaseBlock({
  phase,
  index,
  os,
  lang,
}: {
  phase: GuidePhase;
  index: number;
  os: OsId;
  lang: Lang;
}) {
  return (
    <li id={`phase-${phase.id}`} className="scroll-mt-32">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[12px] font-bold text-[var(--color-green)]"
        >
          {index + 1}
        </span>
        <h3 className="text-[16px] font-bold tracking-tight text-[var(--color-white)] sm:text-[17px]">
          <span className="sr-only">
            {`${GUIDE_UI.step_label[lang]} ${index + 1}: `}
          </span>
          {phase.title[lang]}
        </h3>
      </div>

      <div className="mt-2 pl-10">
        <p className="text-[13.5px] leading-relaxed text-[var(--color-bright)]">
          {phase.body[lang]}
        </p>

        {phase.warning && (
          <p className="mt-3 border-l-2 border-[var(--color-green)] bg-[var(--color-panel)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--color-bright)]">
            <span className="font-bold">{GUIDE_UI.heads_up[lang]}: </span>
            {phase.warning[lang]}
          </p>
        )}

        {phase.card === "requirements" && <RequirementsCard lang={lang} />}

        {screensOf(phase).map((screenRef) => (
          <GuideScreenFigure
            key={screenRef.screenId}
            screenRef={screenRef}
            os={os}
            lang={lang}
            fallback={phase.screenFallback}
          />
        ))}

        {phase.links && <GuideLinks links={phase.links} os={os} lang={lang} />}
      </div>
    </li>
  );
}
