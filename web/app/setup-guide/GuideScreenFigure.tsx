"use client";

// La figura di una fase: la schermata più la sua didascalia.
//
// L'asset arriva dal registro, mai dalla fase: la stessa schermata usata in
// due fasi carica un file solo e il browser la serve dalla cache la seconda
// volta. Quando l'asset per il sistema selezionato non esiste ancora, al suo
// posto compare uno slot con le stesse proporzioni: la pagina non salta
// quando la schermata arriverà, e l'utente legge una frase onesta invece di
// un rettangolo rotto (W02).

import Image from "next/image";

import { GUIDE_UI } from "./guide-ui.i18n";
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

  if (!asset) {
    return (
      <figure className="mt-4">
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] px-6 text-center">
          <p className="text-[12px] font-semibold text-[var(--color-bright)]">
            {GUIDE_UI.screenshot_pending[lang]}
          </p>
          <p className="max-w-sm text-[11.5px] leading-relaxed text-[var(--color-muted)]">
            {GUIDE_UI.screenshot_pending_body[lang]}
          </p>
        </div>
        <figcaption className="mt-2 text-[12px] leading-relaxed text-[var(--color-muted)]">
          {caption[lang]}
        </figcaption>
      </figure>
    );
  }

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
