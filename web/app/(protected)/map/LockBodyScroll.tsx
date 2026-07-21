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
    // Vale anche su mobile: lì la colonna .map-shell è alta esattamente
    // la viewport e scorre INTERNAMENTE (overflow-y auto) — il documento
    // sotto non deve muoversi comunque.
    const html = document.documentElement;
    const body = document.body;
    // --map-vh: altezza VISIBILE reale in px (numero puro), per la shell
    // mobile. Le unità CSS vh/dvh dentro il contesto zoom (--zoom) sono
    // ambigue: Safari le scala per lo zoom, Chromium no — qualunque
    // formula pura-CSS è giusta su un motore e sbagliata sull'altro.
    // visualViewport.height invece è sempre in px non zoomati (e segue
    // la barra dinamica di Safari via evento resize).
    const setVh = () =>
      html.style.setProperty(
        "--map-vh",
        String(window.visualViewport?.height ?? window.innerHeight),
      );
    setVh();
    window.visualViewport?.addEventListener("resize", setVh);
    window.addEventListener("resize", setVh);
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
      html.style.removeProperty("--map-vh");
      window.visualViewport?.removeEventListener("resize", setVh);
      window.removeEventListener("resize", setVh);
    };
  }, []);
  return null;
}
