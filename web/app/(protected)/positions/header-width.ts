// Quanto spazio chiede l'INTESTAZIONE di una colonna della tabella
// /positions, nella lingua in cui è più lunga.
//
// O-39: le larghezze minime erano state scelte guardando l'italiano, e sei
// colonne su diciassette uscivano troncate in tedesco o ungherese — con
// l'ellissi sopra la freccia di ordinamento, che è anche il comando per
// ordinare. Le sette lingue sono nel dizionario: la larghezza si calcola,
// non si stima a occhio.
//
// I tre numeri sono MISURATI nel browser il 2026-08-10 (JetBrains Mono
// 9.5px, uppercase, tracking 0.15em) su 238 campioni — 7 lingue × 17
// intestazioni — e arrotondati per eccesso: nessun campione supera la
// formula. Se cambia il font dell'header, o la sua dimensione, o il padding
// della cella, vanno rimisurati: è una misura, non una costante di natura.
const CELL_PADDING_PX = 32; // px-4 a sinistra + px-4 a destra
const SORT_ARROW_PX = 16; // freccia ↕/↑/↓ + gap dal testo
const PX_PER_CHAR = 7.2; // glifo + tracking, maiuscolo

export function headerMinWidth(label: string): number {
  return Math.ceil(
    CELL_PADDING_PX + SORT_ARROW_PX + PX_PER_CHAR * label.length,
  );
}

/** La più lunga fra le traduzioni, che è l'unica che conta per il layout. */
export function widestHeaderWidth(labels: string[]): number {
  return Math.max(...labels.map(headerMinWidth));
}
