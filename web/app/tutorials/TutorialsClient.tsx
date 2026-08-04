"use client";

import { LandingFooter } from "../components/landing/LandingCTA";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import DeferredVideo from "../components/public-media/DeferredVideo";
import {
  PUBLIC_VIDEOS,
  type PublicVideoKey,
} from "@/lib/public-video-manifest";

function TutorialSlot({ id }: { id: Extract<PublicVideoKey, "game" | "web"> }) {
  const { t } = useLandingI18n();
  const title =
    id === "game" ? t("tutorial_game_title") : t("tutorial_web_title");

  return (
    <section
      id={id}
      aria-labelledby={`${id}-tutorial-title`}
      className="scroll-mt-24"
    >
      <h2
        id={`${id}-tutorial-title`}
        className="mb-4 text-lg font-bold tracking-tight text-[var(--color-white)]"
      >
        {title}
      </h2>
      <DeferredVideo video={PUBLIC_VIDEOS[id]} label={title} />
    </section>
  );
}

function TutorialsContent() {
  const { t } = useLandingI18n();
  return (
    <>
      <LandingNav />
      <main id="main-content" className="mx-auto max-w-5xl px-6 pt-28 pb-20">
        <h1 className="mb-12 text-3xl font-extrabold tracking-tight text-[var(--color-white)] sm:text-5xl">
          {t("tutorials_title")}
        </h1>
        <div className="grid gap-12 md:grid-cols-2 md:gap-8">
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
