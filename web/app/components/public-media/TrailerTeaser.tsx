"use client";

import Link from "next/link";
import { useLandingI18n } from "../landing/LandingI18n";

/**
 * Teaser volutamente priva di player. L'home importa questo componente solo
 * dopo l'ok di ownership su LandingHome; il trailer vero resta in /trailer.
 */
export default function TrailerTeaser() {
  const { t } = useLandingI18n();

  return (
    <section
      aria-label={t("trailer_title")}
      data-trailer-teaser
      className="mt-12 w-full px-6"
    >
      <Link
        href="/trailer"
        className="mx-auto block max-w-4xl overflow-hidden border border-[var(--color-border)] no-underline transition-colors hover:border-[var(--color-green)]"
      >
        <div
          aria-hidden="true"
          className="bg-[var(--color-card)]"
          style={{ aspectRatio: "16 / 9" }}
        />
        <p className="px-4 py-3 text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--color-muted)]">
          {t("trailer_title")}
        </p>
      </Link>
    </section>
  );
}
