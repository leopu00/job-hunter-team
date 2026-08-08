import { NextResponse } from "next/server";
// Path relativo come `api/team/working-hours` fa con shared/config: è il
// modo in cui questo repo condivide codice fra web e CLI, e la logica di
// confronto DEVE essere la stessa che gira su `jht status` — un sito che
// dice "aggiorna" mentre il terminale dice che va tutto bene è peggio di
// nessuno dei due.
import { latestReleaseInfo } from "../../../../shared/release/version.js";

// Una risposta ogni ora per tutta l'istanza, non per visitatore: l'API
// pubblica di GitHub concede 60 richieste l'ora per indirizzo, e le Edge
// Function le paghiamo a invocazione. Le release non escono a raffica.
export const revalidate = 3600;

const REPO = "leopu00/job-hunter-team";

/**
 * Qual è l'ultima versione pubblicata.
 *
 * Serve al banner che avvisa quando il box è rimasto indietro: fino a
 * questo endpoint non esisteva alcun canale di aggiornamento, e un box
 * quattro release vecchio faceva leggere ogni sintomo come "il prodotto è
 * rotto" mentre la correzione era pubblicata da giorni.
 *
 * Non dice nulla dell'utente e non legge nulla di suo: è la stessa risposta
 * per chiunque, ed è per questo che si può cachare così a lungo.
 */
export async function GET() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5000),
        next: { revalidate },
      },
    );
    if (!res.ok) return NextResponse.json({ release: null });
    const info = latestReleaseInfo(await res.json(), REPO);
    return NextResponse.json({ release: info });
  } catch {
    // GitHub irraggiungibile: nessuna release nota, il banner tace. Un
    // avviso che non sappiamo dare non va dato a metà.
    return NextResponse.json({ release: null });
  }
}
