// [JHT-CHAT-UNIFY] L'icona di un agente nella chat: il suo ritratto in stile
// fumetto, ritagliato sul volto, dentro un cerchio col colore del ruolo.
// Sostituisce le emoji che facevano da segnaposto — l'utente riconosce
// queste facce, sono le stesse illustrazioni della pagina /agents.
//
// Niente `next/image`: sono PNG statici di 13-17 KB serviti da /public a
// dimensione fissa; il loader di Next aggiungerebbe una route di
// ottimizzazione (e quindi invocazioni) per guadagnare zero byte. Il
// ritaglio a 96px lo fa a monte `scripts/gen-chat-avatars.py`, non il
// browser: le illustrazioni intere pesano 400 KB-1,1 MB l'una.

import { agentInfo } from "@/lib/message-display";

interface Props {
  agent: string;
  locale: string;
  /** Lato in px del cerchio. */
  size: number;
  /** Anello colorato attorno: si usa dove l'icona è un elemento di lista. */
  ring?: boolean;
  className?: string;
}

export default function AgentAvatar({
  agent,
  locale,
  size,
  ring = false,
  className,
}: Props) {
  const info = agentInfo(agent, locale);

  // Mittente fuori roster (niente ritratto): resta l'emoji generica, come
  // prima. Meglio un segnaposto onesto che un cerchio vuoto.
  if (!info.avatar) {
    return (
      <span
        aria-hidden
        className={className}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.62),
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {info.emoji}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- vedi nota in testa:
    // PNG statico di 13-17 KB a dimensione fissa, next/image aggiungerebbe una
    // route di ottimizzazione (invocazioni) per guadagnare zero byte.
    <img
      src={info.avatar}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        // Il ritratto è ritagliato su fondo trasparente: il disco di colore
        // dietro gli dà il contorno e lo lega al ruolo.
        background: `color-mix(in srgb, ${info.color} 18%, var(--color-panel))`,
        border: ring
          ? `1px solid color-mix(in srgb, ${info.color} 55%, transparent)`
          : undefined,
        // Il PNG è già quadrato e inquadrato sul volto: `cover` è difensivo,
        // non c'è niente da riposizionare.
        objectFit: "cover",
      }}
    />
  );
}
