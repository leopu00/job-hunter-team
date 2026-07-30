"use client";

// Il segno di stato sulla bolla dell'utente: invio → inviato → consegnato,
// e il giallo quando la consegna non è arrivata.
//
// Sobrio di proposito: un'icona da 11px accanto all'ora, nello stesso peso
// grafico del resto della chat. Niente emoji (regola di prodotto): SVG
// stroke, come ogni altra icona dell'app. La parola compare solo nello
// stato che va spiegato — gli altri tre parlano da sé e vivono nel `title`
// e nell'`aria-label`, così chi usa uno screen reader li sente comunque.

import { makeT } from "@/lib/i18n-dict";
import { CHAT_DELIVERY_T } from "@/lib/chat-delivery.i18n";
import type { ChatTurnDelivery } from "@/lib/chat-delivery";

const COLOR: Record<ChatTurnDelivery, string> = {
  sending: "var(--color-dim)",
  sent: "var(--color-dim)",
  delivered: "var(--color-green)",
  // Giallo e non rosso: non è un errore dell'utente né una perdita di
  // dati, è un'attesa che si è rotta. Stesso registro del "VPS lenta".
  stalled: "var(--color-yellow)",
};

function Glyph({ state }: { state: ChatTurnDelivery }) {
  const common = {
    width: 11,
    height: 11,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (state === "sending") {
    // Orologio: il turno è in volo, non è ancora una riga.
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    );
  }
  if (state === "delivered") {
    // Doppia spunta: la riga esiste E l'agente ce l'ha nel pane.
    return (
      <svg {...common}>
        <path d="M2 13l4 4 8.5-8.5" />
        <path d="M10 15.5l1.5 1.5L22 6.5" />
      </svg>
    );
  }
  if (state === "stalled") {
    return (
      <svg {...common}>
        <path d="M10.6 4.5L2.9 18a1.6 1.6 0 0 0 1.4 2.4h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.5a1.6 1.6 0 0 0-2.8 0z" />
        <path d="M12 10v3.5" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  // Spunta singola: il cloud ha la riga, il box non l'ha ancora ritirata.
  return (
    <svg {...common}>
      <path d="M4 13l5 5L20 7" />
    </svg>
  );
}

export default function ChatDeliveryMark({
  state,
  locale,
}: {
  state: ChatTurnDelivery;
  locale: string;
}) {
  const tr = makeT(CHAT_DELIVERY_T, locale);
  const label = tr(state);
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] leading-none"
      style={{ color: COLOR[state] }}
      title={label}
      aria-label={label}
      role="img"
    >
      <Glyph state={state} />
      {state === "stalled" && <span>{label}</span>}
    </span>
  );
}
