"use client";

import { LandingFooter } from "../components/landing/LandingCTA";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import DeferredVideo from "../components/public-media/DeferredVideo";
import { PUBLIC_VIDEOS } from "@/lib/public-video-manifest";

function TrailerContent() {
  const { t } = useLandingI18n();
  const title = t("trailer_title");
  return (
    <>
      <LandingNav />
      <main id="main-content" className="mx-auto max-w-5xl px-6 pt-28 pb-20">
        <h1 className="mb-12 text-3xl font-extrabold tracking-tight text-[var(--color-white)] sm:text-5xl">
          {title}
        </h1>
        <DeferredVideo video={PUBLIC_VIDEOS.trailer} label={title} />
        <section
          aria-label="Music credit"
          className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-5 text-sm leading-6 text-[var(--color-text-muted)]"
        >
          <p>Covert Affair Kevin MacLeod (incompetech.com)</p>
          <p>Licensed under Creative Commons: By Attribution 4.0</p>
          <p>
            <a
              className="underline underline-offset-2 hover:text-[var(--color-text)]"
              href="https://creativecommons.org/licenses/by/4.0/"
            >
              https://creativecommons.org/licenses/by/4.0/
            </a>
          </p>
          <p>Edited for timing and mixed with a CC0 cymbal-roll intro.</p>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}

export default function TrailerClient() {
  return (
    <LandingI18nProvider>
      <TrailerContent />
    </LandingI18nProvider>
  );
}
