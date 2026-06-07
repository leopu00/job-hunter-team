"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wrapper tabella con DOPPIA scrollbar orizzontale: una in alto (sempre
 * visibile, sincronizzata) + quella nativa in basso. Serve quando la tabella
 * eccede la viewport e la barra in fondo resta fuori schermo: l'utente non
 * deve scrollare fino in fondo per trovarla.
 *
 * La barra superiore è un div scrollabile con uno spacer largo quanto il
 * contenuto; lo scroll è specchiato bidirezionalmente con il corpo.
 */
export default function TableScrollSync({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const [scrollW, setScrollW] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => {
      setScrollW(body.scrollWidth);
      setOverflowing(body.scrollWidth > body.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    if (body.firstElementChild) ro.observe(body.firstElementChild);
    return () => ro.disconnect();
  }, [children]);

  // Specchio dello scroll con guardia anti-loop (setScrollLeft riemette scroll).
  const onScroll = (src: "top" | "body") => () => {
    if (lock.current) return;
    lock.current = true;
    const top = topRef.current;
    const body = bodyRef.current;
    if (top && body) {
      if (src === "top") body.scrollLeft = top.scrollLeft;
      else top.scrollLeft = body.scrollLeft;
    }
    requestAnimationFrame(() => {
      lock.current = false;
    });
  };

  return (
    // relative: la barra in alto è ASSOLUTA (fuori dal flusso) così non spinge
    // giù il bordo della tabella → il bordo resta allineato con la prima card
    // dei filtri. La barra galleggia nello spazio sopra la tabella.
    <div className="relative">
      {overflowing && (
        <div
          ref={topRef}
          onScroll={onScroll("top")}
          className="h-scroll-top overflow-x-scroll overflow-y-hidden absolute left-0 right-0"
          style={{ height: 14, top: -16 }}
          aria-hidden="true"
        >
          <div style={{ width: scrollW, height: 1 }} />
        </div>
      )}
      <div ref={bodyRef} onScroll={onScroll("body")} className={className}>
        {children}
      </div>
    </div>
  );
}
