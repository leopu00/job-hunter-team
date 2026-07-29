// [JHT-CHAT-UNIFY] L'icona di un agente nella chat: il suo ritratto
// disegnato, ritagliato al busto, dentro un cerchio col colore del ruolo.
// Sostituisce le emoji che facevano da segnaposto — l'utente riconosce
// queste facce, sono le stesse del videogioco.
//
// Niente `next/image`: sono PNG statici di 3-4 KB serviti da /public a
// dimensione fissa; il loader di Next aggiungerebbe una route di
// ottimizzazione (e quindi invocazioni) per guadagnare zero byte.

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
    // PNG statico di 3-4 KB a dimensione fissa, next/image aggiungerebbe una
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
        // Il ritratto è tagliato al busto su fondo trasparente: il disco di
        // colore dietro gli dà il contorno e lo lega al ruolo.
        background: `color-mix(in srgb, ${info.color} 18%, var(--color-panel))`,
        border: ring
          ? `1px solid color-mix(in srgb, ${info.color} 55%, transparent)`
          : undefined,
        objectFit: "cover",
        // Il busto sta nella metà alta del quadrato: ancorando in basso il
        // taglio circolare prende testa e spalle, non l'aria sopra i capelli.
        objectPosition: "center bottom",
      }}
    />
  );
}
