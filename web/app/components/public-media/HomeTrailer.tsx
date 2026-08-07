"use client";

import { PUBLIC_VIDEOS } from "@/lib/public-video-manifest";
import { useLandingI18n } from "../landing/LandingI18n";
import DeferredVideo from "./DeferredVideo";

/**
 * Il trailer vive direttamente sulla home. Finché `published` resta falso il
 * manifest impedisce a poster, sorgenti e richieste media di raggiungere il
 * DOM; dopo il GO il player viene creato soltanto dal click dell'utente.
 */
export default function HomeTrailer() {
  const { t } = useLandingI18n();
  const title = t("trailer_title");

  return (
    <section
      id="trailer"
      aria-labelledby="trailer-title"
      data-trailer-inline
      className="mt-12 w-full px-6"
    >
      <div className="mx-auto max-w-4xl text-left">
        <h2
          id="trailer-title"
          className="mb-4 text-xl font-extrabold tracking-tight text-[var(--color-white)] sm:text-2xl"
        >
          {title}
        </h2>

        <DeferredVideo video={PUBLIC_VIDEOS.trailer} label={title} />
      </div>
    </section>
  );
}
