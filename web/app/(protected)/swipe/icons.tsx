// Icone SVG stroke-based (stile Feather) per la pagina swipe — niente
// emoji nella UI di prodotto (scelta utente 18/07): tratto 2px,
// currentColor, round caps, scalabili via prop size.
import type { ReactNode } from "react";

function Svg({
  children,
  size = 20,
  filled = false,
}: {
  children: ReactNode;
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
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

export function IconX({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

export function IconClock({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function IconEye({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconStar({ size, filled }: { size?: number; filled?: boolean }) {
  return (
    <Svg size={size} filled={filled}>
      <path d="m12 3 2.7 5.8 6.3.8-4.7 4.3 1.3 6.2L12 17l-5.6 3.1 1.3-6.2L3 9.6l6.3-.8Z" />
    </Svg>
  );
}

export function IconUndo({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 6 6v2" />
    </Svg>
  );
}

export function IconMic({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v4" />
    </Svg>
  );
}

export function IconStop({ size }: { size?: number }) {
  return (
    <Svg size={size} filled>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </Svg>
  );
}

export function IconChat({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </Svg>
  );
}

export function IconPin({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  );
}

export function IconCards({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3" y="7" width="14" height="14" rx="2" />
      <path d="M8 3h11a2 2 0 0 1 2 2v11" />
    </Svg>
  );
}

export function IconSkip({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m6 17 5-5-5-5" />
      <path d="m13 17 5-5-5-5" />
    </Svg>
  );
}

export function IconCheckCircle({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </Svg>
  );
}
