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
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);
  return null;
}
