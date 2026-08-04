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
