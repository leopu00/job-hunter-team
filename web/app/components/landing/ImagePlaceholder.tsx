// Placeholder per le immagini ancora da generare. Riquadro tratteggiato con
// l'etichetta di cosa andrà al suo posto e l'id del prompt corrispondente nel
// file docs/internal/landing-image-prompts.md. Componente client: legge
// l'etichetta "placeholder" localizzata dal router landing i18n.
"use client";

import { useLandingI18n } from "./LandingI18n";

export default function ImagePlaceholder({
  label,
  promptId,
  aspect = "16 / 9",
  className = "",
}: {
  label: string;
  promptId?: string;
  aspect?: string;
  className?: string;
}) {
  const { t } = useLandingI18n();
  return (
    <div
      role="img"
      aria-label={label}
      className={`relative w-full overflow-hidden border border-dashed border-[var(--color-border)] bg-[var(--color-panel)] flex items-center justify-center text-center ${className}`}
      style={{ aspectRatio: aspect }}
    >
      <div className="px-6 py-8">
        <div className="text-[9px] font-semibold tracking-[0.25em] uppercase text-[var(--color-muted)] mb-2">
          {t("image_placeholder")}
        </div>
        <div className="text-[12px] text-[var(--color-dim)] max-w-md mx-auto leading-relaxed">
          {label}
        </div>
        {promptId && (
          <div className="mt-3 inline-block text-[9px] font-mono text-[var(--color-muted)] border border-[var(--color-border)] px-2 py-0.5">
            prompt: {promptId}
          </div>
        )}
      </div>
    </div>
  );
}
