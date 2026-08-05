"use client";

import { LandingFooter } from "../components/landing/LandingCTA";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import DeferredVideo from "../components/public-media/DeferredVideo";
import { PUBLIC_VIDEOS } from "@/lib/public-video-manifest";
import {
  TUTORIAL_GUIDES,
  TUTORIAL_PAGE_COPY,
  type TutorialId,
} from "./tutorial-content";

function TutorialSlot({ id }: { id: TutorialId }) {
  const { lang, t } = useLandingI18n();
  const title =
    id === "game" ? t("tutorial_game_title") : t("tutorial_web_title");
  const guide = TUTORIAL_GUIDES[lang][id];

  return (
    <section
      id={id}
      aria-labelledby={`${id}-tutorial-title`}
      className="scroll-mt-24 border-t border-[var(--color-border)] pt-10 first:border-t-0 first:pt-0"
    >
      <h2
        id={`${id}-tutorial-title`}
        className="mb-3 text-2xl font-bold tracking-tight text-[var(--color-white)] sm:text-3xl"
      >
        {title}
      </h2>
      <p className="max-w-3xl text-[15px] leading-relaxed text-[var(--color-bright)]">
        {guide.intro}
      </p>

      <div className="mt-8 max-w-3xl rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-5 sm:p-6">
        <h3 className="text-lg font-bold tracking-tight text-[var(--color-white)]">
          {guide.beforeYouBeginLabel}
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-bright)]">
          {guide.beforeYouBegin}
        </p>
      </div>

      <ol className="mt-8 max-w-3xl space-y-7">
        {guide.steps.map((step, index) => (
          <li key={step.title} className="grid grid-cols-[auto_1fr] gap-x-4">
            <span
              aria-hidden
              className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-[var(--color-border)] text-sm font-bold text-[var(--color-green)]"
            >
              {index + 1}
            </span>
            <div>
              <h3 className="text-lg font-bold tracking-tight text-[var(--color-white)]">
                {step.title}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--color-bright)]">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <aside
        aria-label={`${title}: ${guide.preferVideo}`}
        className="mt-10 max-w-3xl border-t border-[var(--color-border)] pt-8"
      >
        <h3 className="text-lg font-bold tracking-tight text-[var(--color-white)]">
          {guide.preferVideo}
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-bright)]">
          {guide.videoAvailable}
        </p>
        <div className="mt-4">
          <DeferredVideo video={PUBLIC_VIDEOS[id]} label={title} />
        </div>
      </aside>
    </section>
  );
}

function TutorialsContent() {
  const { lang, t } = useLandingI18n();
  const pageCopy = TUTORIAL_PAGE_COPY[lang];

  return (
    <>
      <LandingNav />
      <main id="main-content" className="mx-auto max-w-4xl px-6 pt-28 pb-20">
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-white)] sm:text-5xl">
          {t("tutorials_title")}
        </h1>
        <p className="mt-5 max-w-3xl text-[16px] leading-relaxed text-[var(--color-bright)]">
          {pageCopy.description}
        </p>
        <nav
          aria-label={pageCopy.pathNavLabel}
          className="mt-8 flex flex-wrap gap-3"
        >
          <a
            href="#game"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-white)] transition-colors hover:border-[var(--color-green)] hover:text-[var(--color-green)]"
          >
            {t("tutorial_game_title")}
          </a>
          <a
            href="#web"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-white)] transition-colors hover:border-[var(--color-green)] hover:text-[var(--color-green)]"
          >
            {t("tutorial_web_title")}
          </a>
        </nav>
        <div className="mt-14 space-y-16">
          <TutorialSlot id="game" />
          <TutorialSlot id="web" />
        </div>
      </main>
      <LandingFooter />
    </>
  );
}

export default function TutorialsClient() {
  return (
    <LandingI18nProvider>
      <TutorialsContent />
    </LandingI18nProvider>
  );
}
