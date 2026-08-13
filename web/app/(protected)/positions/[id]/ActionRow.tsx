"use client";

import type { ReactNode } from "react";

// Riga-azione del popup "Feedback e richieste": icona in un riquadro
// colorato, titolo che dice COSA succede e descrizione che spiega cosa
// farà il team (i vecchi bottoni nudi "Geocodifica" / "Ricontrolla se
// attiva" non erano comprensibili — feedback utente 19/07). Quando la
// richiesta è attiva la riga diventa verde con la spunta e la
// descrizione spiega come annullare.
export function ActionRow({
  icon,
  title,
  description,
  accent,
  active = false,
  busy = false,
  disabled = false,
  onClick,
  error,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  // Colore del riquadro icona quando la richiesta NON è attiva.
  accent: string;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  error?: string | null;
}) {
  const color = active ? "var(--color-green)" : accent;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-[var(--color-row)] disabled:cursor-not-allowed"
        style={{
          borderColor: active ? "var(--color-green)" : "var(--color-border)",
          opacity: disabled ? 0.55 : busy ? 0.7 : undefined,
        }}
      >
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{
            color,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
          }}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-[var(--color-white)]">
            {title}
          </span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--color-muted)]">
            {description}
          </span>
        </span>
        {active && (
          <span
            className="mt-1 shrink-0 text-[14px] font-bold"
            style={{ color: "var(--color-green)" }}
            aria-hidden="true"
          >
            ✓
          </span>
        )}
      </button>
      {error && (
        <span className="text-[10px]" style={{ color: "var(--color-red)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

function Svg({
  children,
  icon,
  size = 17,
}: {
  children: ReactNode;
  icon: string;
  size?: number;
}) {
  return (
    <svg
      data-action-icon={icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconMapPin() {
  return (
    <Svg icon="geocode">
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  );
}

export function IconRefresh() {
  return (
    <Svg icon="rescore">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}

export function IconFileText() {
  return (
    <Svg icon="cv">
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h5" />
      <path d="M9 13h6M9 17h4" />
    </Svg>
  );
}

export function IconOpenCheck() {
  return (
    <Svg icon="open-check">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <path d="m9.5 12 1.7 1.7 3.8-4" />
    </Svg>
  );
}

export function IconCoverLetter() {
  return (
    <Svg icon="cover-letter">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
      <path d="m16.5 3.5 1 1 2-2" />
    </Svg>
  );
}
