"use client";

// La pagina della guida: indice dei capitoli, selettore OS, fasi.
//
// Mobile-first per scelta: una colonna sola, il selettore appiccicato in
// alto, immagini a piena larghezza. Da `lg` in su l'indice diventa una
// colonna laterale che resta ferma mentre si scorre — la stessa struttura,
// non un secondo layout.

import { useEffect } from "react";
import Link from "next/link";

import GuidePhaseBlock from "./GuidePhaseBlock";
import OsSelector from "./OsSelector";
import { DOCS_FAQ } from "./guide-config";
import { GUIDE_CHAPTERS } from "./guide-content";
import { GUIDE_UI } from "./guide-ui.i18n";
import { phasesFor } from "./guide-types";
import { useGuideOs } from "./useGuideOs";
import { LandingFooter } from "../components/landing/LandingCTA";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";

function GuideContent() {
  const { lang } = useLandingI18n();
  const { os, setOs, detected } = useGuideOs();

  // Il titolo della scheda segue la lingua SCELTA, non quella dedotta dal
  // server. Il metadata statico di `page.tsx` è inglese e serve a chi legge
  // senza JavaScript e ai crawler; qui lo si riallinea al selettore.
  //
  // È il modo per non ereditare il difetto che la pagina Download ha oggi:
  // là il titolo esce da `getRequestLocale()`, che senza cookie ricade su
  // italiano, mentre il contenuto parte in inglese — tab e pagina in due
  // lingue diverse alla prima visita.
  useEffect(() => {
    document.title = `${GUIDE_UI.page_title[lang]} | Job Hunter Team`;
  }, [lang]);

  const chapters = GUIDE_CHAPTERS.map((chapter) => ({
    chapter,
    phases: phasesFor(chapter, os),
  })).filter(({ phases }) => phases.length > 0);

  return (
    <>
      <LandingNav />
      {/* Nessun <main> qui: il layout radice ne monta già uno con
          `id="main-content"` (`app/components/main-content.tsx`). Un
          secondo main annidato duplicherebbe l'id e il salto «vai al
          contenuto» finirebbe su un bersaglio ambiguo. */}
      {/* `data-guide-ready` passa a true quando il rilevamento del sistema
          è finito, cioè dopo l'idratazione. Prima di quel momento la pagina
          si legge ma il selettore non ha ancora i suoi handler: un click che
          arriva lì si perde in silenzio. Lo stato vero, dichiarato, invece
          di un'attesa a tempo (W05). */}
      <div
        data-setup-guide
        data-guide-ready={detected ? "true" : "false"}
        className="mx-auto max-w-6xl px-6 pt-24 pb-20 sm:pt-28"
      >
        <header className="max-w-3xl">
          <h1 className="hyphens-auto break-words text-[28px] font-extrabold leading-tight tracking-tight text-[var(--color-white)] sm:text-4xl">
            {GUIDE_UI.page_title[lang]}
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[var(--color-bright)] sm:text-[15px]">
            {GUIDE_UI.page_intro[lang]}
          </p>
        </header>

        <div className="mt-6">
          <OsSelector
            os={os}
            onChange={setOs}
            label={GUIDE_UI.os_selector_label[lang]}
          />
        </div>

        <div className="mt-8 lg:flex lg:items-start lg:gap-12">
          {/* Indice: in linea su mobile, colonna ferma da lg in su. */}
          <nav
            id="guide-chapters"
            aria-label={GUIDE_UI.chapters_label[lang]}
            className="scroll-mt-32 lg:sticky lg:top-32 lg:w-64 lg:shrink-0"
          >
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-dim)]">
              {GUIDE_UI.chapters_label[lang]}
            </p>
            <ol className="space-y-1">
              {chapters.map(({ chapter, phases }, index) => (
                <li key={chapter.id}>
                  <a
                    href={`#chapter-${chapter.id}`}
                    className="flex min-h-11 items-center gap-3 rounded-md px-2 text-[13px] text-[var(--color-muted)] no-underline transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-green)]"
                  >
                    <span className="font-mono text-[11px] text-[var(--color-dim)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {chapter.title[lang]}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--color-dim)]">
                      {phases.length}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-10 min-w-0 flex-1 lg:mt-0">
            {chapters.map(({ chapter, phases }, chapterIndex) => (
              <section
                key={chapter.id}
                id={`chapter-${chapter.id}`}
                aria-labelledby={`chapter-${chapter.id}-title`}
                className="scroll-mt-32 border-t border-[var(--color-border)] pt-8 first:border-t-0 first:pt-0 [&+section]:mt-12"
              >
                <p className="font-mono text-[11px] text-[var(--color-dim)]">
                  {`${String(chapterIndex + 1).padStart(2, "0")} · ${phases.length} ${GUIDE_UI.steps_count[lang]}`}
                </p>
                <h2
                  id={`chapter-${chapter.id}-title`}
                  className="mt-1 hyphens-auto break-words text-[21px] font-bold tracking-tight text-[var(--color-white)] sm:text-2xl"
                >
                  {chapter.title[lang]}
                </h2>
                <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[var(--color-muted)]">
                  {chapter.summary[lang]}
                </p>

                <ol className="mt-8 space-y-10">
                  {phases.map((phase, index) => (
                    <GuidePhaseBlock
                      key={phase.id}
                      phase={phase}
                      index={index}
                      os={os}
                      lang={lang}
                    />
                  ))}
                </ol>

                {/* Solo su mobile: la guida è lunga e l'indice è in cima,
                    non in una colonna ferma come da lg in su. Senza questo
                    si risale a pollice per un capitolo intero. */}
                <a
                  href="#guide-chapters"
                  className="mt-8 inline-flex min-h-11 items-center text-[12.5px] font-semibold text-[var(--color-muted)] no-underline transition-colors hover:text-[var(--color-green)] lg:hidden"
                >
                  {`↑ ${GUIDE_UI.back_to_top[lang]}`}
                </a>
              </section>
            ))}

            <aside className="mt-14 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-5">
              <h2 className="text-[15px] font-bold text-[var(--color-white)]">
                {GUIDE_UI.need_help_title[lang]}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-bright)]">
                {GUIDE_UI.need_help_body[lang]}
              </p>
              <Link
                href={DOCS_FAQ}
                className="mt-4 inline-flex min-h-11 items-center rounded-md border border-[var(--color-border)] px-3 py-2 text-[12.5px] font-semibold text-[var(--color-bright)] no-underline transition-colors hover:border-[var(--color-green)] hover:text-[var(--color-green)]"
              >
                {GUIDE_UI.faq_link[lang]}
              </Link>
            </aside>
          </div>
        </div>
      </div>
      <LandingFooter />
    </>
  );
}

export default function SetupGuideClient() {
  return (
    <LandingI18nProvider>
      <GuideContent />
    </LandingI18nProvider>
  );
}
