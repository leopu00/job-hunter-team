"use client";

import Link from "next/link";
import {
  PUBLIC_MUSIC_CREDIT,
  type PublicMusicCredit,
} from "@/lib/media-credits";
import { CREDITS_COPY } from "./credits.i18n";
import { LandingFooter } from "../components/landing/LandingCTA";
import {
  LandingI18nProvider,
  useLandingI18n,
  type Lang,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";

function fillCreditTemplate(template: string, credit: PublicMusicCredit) {
  return template
    .replace("{work}", credit.work)
    .replace("{composer}", credit.composer)
    .replace("{source}", credit.source);
}

export function MusicCreditLine({
  lang,
  credit,
}: {
  lang: Lang;
  credit: PublicMusicCredit;
}) {
  const [beforeLicense, afterLicense] = fillCreditTemplate(
    CREDITS_COPY.credit_line[lang],
    credit,
  ).split("{license}");

  return (
    <p data-music-credit className="leading-7 text-[var(--color-muted)]">
      {beforeLicense}
      <a
        className="font-semibold underline underline-offset-4 hover:text-[var(--color-white)]"
        href={credit.licenseUrl}
      >
        {credit.license}
      </a>
      {afterLicense}
    </p>
  );
}

function CreditsContent() {
  const { lang } = useLandingI18n();
  const copy = CREDITS_COPY;
  const musicCredit = PUBLIC_MUSIC_CREDIT;

  return (
    <>
      <LandingNav />
      <article
        aria-labelledby="credits-title"
        className="mx-auto flex max-w-3xl flex-col px-6 pt-28 pb-20 text-[var(--color-white)] sm:px-10"
      >
        <header className="max-w-2xl">
          <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-[var(--color-green)] uppercase">
            Job Hunter Team
          </p>
          <h1
            id="credits-title"
            className="text-4xl font-extrabold tracking-tight sm:text-5xl"
          >
            {copy.page_title[lang]}
          </h1>
          <p className="mt-5 leading-7 text-[var(--color-muted)]">
            {copy.page_intro[lang]}
          </p>
        </header>

        {musicCredit && (
          <section
            aria-labelledby="music-credit-title"
            className="mt-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 sm:p-8"
          >
            <h2 id="music-credit-title" className="text-xl font-bold">
              {copy.music_title[lang]}
            </h2>
            <div className="mt-5">
              <MusicCreditLine lang={lang} credit={musicCredit} />
            </div>
          </section>
        )}

        <footer className="mt-16 border-t border-[var(--color-border)] pt-8">
          <Link
            className="inline-flex min-h-11 items-center font-semibold text-[var(--color-green)] underline underline-offset-4"
            href="/"
          >
            {copy.back_home[lang]}
          </Link>
        </footer>
      </article>
      <LandingFooter />
    </>
  );
}

export default function CreditsClient() {
  return (
    <LandingI18nProvider>
      <CreditsContent />
    </LandingI18nProvider>
  );
}
