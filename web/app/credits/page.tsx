import type { Metadata } from "next";
import Link from "next/link";

const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

export const CANONICAL_MUSIC_CREDIT = [
  "Covert Affair Kevin MacLeod (incompetech.com)",
  "Licensed under Creative Commons: By Attribution 4.0",
  LICENSE_URL,
  "Edited for timing and mixed with a CC0 cymbal-roll intro.",
] as const;

export const MUSIC_PROVENANCE = {
  work: "Covert Affair",
  composer: "Kevin MacLeod",
  source: "incompetech.com",
  isrc: "USUAN1100795",
  license: "CC BY 4.0",
  sourceAudioSha256:
    "279be47ea7880460be1393d66a83bcc7bee18e10d73537420098e4e1b1c0646f",
  intro: "Orch 006 cymbal roll — Karma-Ron",
  introLicense: "CC0",
  introAudioSha256:
    "215972193c783912bcd1fd249b4ed909d36d9d43145923bfb6fd3357160cd907",
} as const;

export const metadata: Metadata = {
  title: "Credits",
  description:
    "Music attribution and source provenance for official Job Hunter Team media.",
  alternates: { canonical: "/credits" },
  robots: { index: true, follow: true },
};

export default function CreditsPage() {
  return (
    <article
      aria-labelledby="credits-title"
      className="mx-auto flex max-w-3xl flex-col px-6 py-20 text-[var(--color-white)] sm:px-10 sm:py-28"
    >
      <header className="max-w-2xl">
        <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-[var(--color-green)] uppercase">
          Job Hunter Team
        </p>
        <h1
          id="credits-title"
          className="text-4xl font-extrabold tracking-tight sm:text-5xl"
        >
          Credits
        </h1>
        <p className="mt-5 leading-7 text-[var(--color-muted)]">
          Music attribution and source provenance for official Job Hunter Team
          media.
        </p>
      </header>

      <section
        aria-labelledby="music-credit-title"
        className="mt-12 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 sm:p-8"
      >
        <h2 id="music-credit-title" className="text-xl font-bold">
          Music credit
        </h2>
        <div
          data-canonical-credit
          className="mt-5 space-y-2 leading-7 text-[var(--color-muted)]"
        >
          {CANONICAL_MUSIC_CREDIT.map((line) => (
            <p key={line}>
              {line === LICENSE_URL ? (
                <a
                  className="break-all underline underline-offset-4 hover:text-[var(--color-white)]"
                  href={line}
                >
                  {line}
                </a>
              ) : (
                line
              )}
            </p>
          ))}
        </div>
      </section>

      <section aria-labelledby="provenance-title" className="mt-12">
        <h2 id="provenance-title" className="text-xl font-bold">
          Provenance
        </h2>
        <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-[11rem_1fr]">
          <dt className="font-semibold text-[var(--color-muted)]">Work</dt>
          <dd>{MUSIC_PROVENANCE.work}</dd>

          <dt className="font-semibold text-[var(--color-muted)]">
            Composer
          </dt>
          <dd>{MUSIC_PROVENANCE.composer}</dd>

          <dt className="font-semibold text-[var(--color-muted)]">
            Source
          </dt>
          <dd>
            <a
              className="underline underline-offset-4 hover:text-[var(--color-green)]"
              href="https://incompetech.com/"
            >
              {MUSIC_PROVENANCE.source}
            </a>
          </dd>

          <dt className="font-semibold text-[var(--color-muted)]">ISRC</dt>
          <dd>{MUSIC_PROVENANCE.isrc}</dd>

          <dt className="font-semibold text-[var(--color-muted)]">
            License
          </dt>
          <dd>{MUSIC_PROVENANCE.license}</dd>

          <dt className="font-semibold text-[var(--color-muted)]">
            Music source SHA-256
          </dt>
          <dd>
            <code className="break-all text-sm">
              {MUSIC_PROVENANCE.sourceAudioSha256}
            </code>
          </dd>

          <dt className="font-semibold text-[var(--color-muted)]">
            Intro
          </dt>
          <dd>{MUSIC_PROVENANCE.intro}</dd>

          <dt className="font-semibold text-[var(--color-muted)]">
            Intro license
          </dt>
          <dd>{MUSIC_PROVENANCE.introLicense}</dd>

          <dt className="font-semibold text-[var(--color-muted)]">
            Intro source SHA-256
          </dt>
          <dd>
            <code className="break-all text-sm">
              {MUSIC_PROVENANCE.introAudioSha256}
            </code>
          </dd>
        </dl>
      </section>

      <footer className="mt-16 border-t border-[var(--color-border)] pt-8">
        <Link
          className="font-semibold text-[var(--color-green)] underline underline-offset-4"
          href="/"
        >
          Back to Job Hunter Team
        </Link>
      </footer>
    </article>
  );
}
