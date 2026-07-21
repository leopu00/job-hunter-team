"use client";

import { useEffect } from "react";

// La pagina /map è full-viewport (il globo riempie tutto e le 4 card
// sono overlay assoluti): non c'è nulla da scrollare. Senza questo, la
// rotellina sopra una card NON scrollabile (grafico score, donut) o
// sopra l'header di una lista finiva sul documento, che era alto
// qualche px in più della viewport → compariva una banda nera sotto la
// mappa. Blocchiamo lo scroll di html/body finché /map è montata.
export default function LockBodyScroll() {
  useEffect(() => {
    // Su MOBILE (≤767px) la pagina /map SCORRE (globo in alto, card dei
    // filtri in colonna sotto — vedi CSS .map-shell in page.tsx): niente
    // lock. Il breakpoint deve combaciare con quella media query.
    if (window.matchMedia("(max-width: 767px)").matches) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    const prevAnchor = html.style.overflowAnchor;
    // La navbar del sito è `sticky top-0`: su /map deve restare visibile in
    // cima. Se si arriva qui con il documento GIÀ scrollato — dopo una nav
    // client-side (con l'App Router + loading.tsx lo scroll-to-top a volte
    // non scatta e resta la posizione della pagina precedente), o per uno
    // scroll indotto dal canvas WebGL — bloccare l'overflow SENZA riportare
    // lo scroll a 0 congela la pagina in quella posizione: la navbar finisce
    // fuori schermo e non si può più tornare su ("pagina spostata verso
    // l'alto, header sparito, impossibile interagire"). Quindi: prima
    // riportiamo lo scroll in cima, poi blocchiamo. `overflow-anchor: none`
    // evita che lo scroll-anchoring del browser risposti la pagina quando il
    // globo monta in modo asincrono.
    window.scrollTo(0, 0);
    html.style.overflowAnchor = "none";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      html.style.overflowAnchor = prevAnchor;
    };
  }, []);
  return null;
}
