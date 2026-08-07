"use client";

import Link from "next/link";
import { CANONICAL_MUSIC_CREDIT, MUSIC_LICENSE_URL } from "@/lib/media-credits";
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

        <section
          aria-label="Music credit"
          data-canonical-credit
          className="mt-4 border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-xs leading-5 text-[var(--color-muted)]"
        >
          {CANONICAL_MUSIC_CREDIT.map((line, index) => (
            <p key={line}>
              {index === 0 ? (
                <Link
                  className="underline underline-offset-2 hover:text-[var(--color-white)]"
                  href="/credits"
                >
                  {line}
                </Link>
              ) : line === MUSIC_LICENSE_URL ? (
                <a
                  className="break-all underline underline-offset-2 hover:text-[var(--color-white)]"
                  href={line}
                >
                  {line}
                </a>
              ) : (
                line
              )}
            </p>
          ))}
        </section>
      </div>
    </section>
  );
}
