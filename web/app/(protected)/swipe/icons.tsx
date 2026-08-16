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

// Timbro «esclusa»: cerchio sbarrato. Distinto dalla X del verdetto
// «non interessante» di proposito — sono due esiti diversi e sullo stesso
// mazzo si vedono uno dopo l'altro.
export function IconBan({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </Svg>
  );
}

export function IconStar({
  size,
  filled,
}: {
  size?: number;
  filled?: boolean;
}) {
  return (
    <Svg size={size} filled={filled}>
      <path d="m12 3 2.7 5.8 6.3.8-4.7 4.3 1.3 6.2L12 17l-5.6 3.1 1.3-6.2L3 9.6l6.3-.8Z" />
    </Svg>
  );
}

export function IconThumbsUp({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </Svg>
  );
}

export function IconThumbsMeh({ size }: { size?: number }) {
  // Pollice ORIZZONTALE che punta a SINISTRA ("così così", versante
  // negativo della scala): il giudizio 'poco interessante'. È il pollice
  // VERSO ruotato di 90° in senso orario — la mezza stella non si capiva
  // e il pollice-su ruotato pendeva dal lato sbagliato (utente 20/07).
  return (
    <Svg size={size}>
      <g transform="rotate(90 12 12)">
        <path d="M17 14V2" />
        <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
      </g>
    </Svg>
  );
}

export function IconChevronLeft({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function IconChevronRight({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m9 18 6-6-6-6" />
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

export function IconCalendar({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="3" y="5" width="18" height="17" rx="2" />
      <path d="M16 2v5M8 2v5M3 11h18" />
    </Svg>
  );
}

export function IconFilter({ size }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M22 3H2l8 9.5V21l4-2v-6.5L22 3Z" />
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
