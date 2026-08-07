"use client";

// La figura di una fase: la schermata più la sua didascalia.
//
// L'asset arriva dal registro, mai dalla fase: la stessa schermata usata in
// due fasi carica un file solo e il browser la serve dalla cache la seconda
// volta. Quando l'asset per il sistema selezionato non esiste ancora, non si
// rende alcun DOM: `pending` resta un dato operativo del registro e la fase
// pubblica si chiude naturalmente dopo il suo testo.

import Image from "next/image";

import { SCREENS } from "./guide-screens";
import {
  assetFor,
  type GuideText,
  type OsId,
  type ScreenRef,
} from "./guide-types";
import type { Lang } from "../components/landing/LandingI18n";

export default function GuideScreenFigure({
  screenRef,
  os,
  lang,
}: {
  screenRef: ScreenRef;
  os: OsId;
  lang: Lang;
}) {
  const screen = SCREENS[screenRef.screenId];
  if (!screen) return null;

  const asset = assetFor(screen, os);
  const caption: GuideText = screenRef.caption ?? screen.caption;

  if (!asset) return null;

  return (
    <figure className="mt-4">
      <Image
        src={asset.src}
        alt={screen.alt[lang]}
        width={asset.width}
        height={asset.height}
        sizes="(min-width: 1024px) 720px, calc(100vw - 3rem)"
        className="h-auto w-full rounded-md border border-[var(--color-border)]"
      />
      <figcaption className="mt-2 text-[12px] leading-relaxed text-[var(--color-muted)]">
        {caption[lang]}
      </figcaption>
    </figure>
  );
}
