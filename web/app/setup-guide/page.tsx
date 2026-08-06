import type { Metadata } from "next";

import SetupGuideClient from "./SetupGuideClient";

// ⛔ NON PUBBLICATA. Ordine dell'operatore del 7 agosto 2026: la guida deve
// essere raggiungibile per la sua review, non dal pubblico. Quindi:
//   · nessun link dal menu del sito né dall'indice /docs;
//   · `noindex, nofollow` qui sotto, così un motore che la trovasse per caso
//     non la indicizza;
//   · fuori dalla sitemap (`app/sitemap.ts` elenca le route una a una).
// Quando la pagina viene promossa: togliere `robots`, aggiungerla alla
// sitemap e linkarla dalla navigazione.
export const metadata: Metadata = {
  title: "Setup guide",
  robots: { index: false, follow: false },
  alternates: { canonical: "/setup-guide" },
};

export default function SetupGuidePage() {
  return <SetupGuideClient />;
}
