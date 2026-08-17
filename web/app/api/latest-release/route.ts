import { NextResponse } from "next/server";
// Path relativo come `api/team/working-hours` fa con shared/config: è il
// modo in cui questo repo condivide codice fra web e CLI, e la logica di
// confronto DEVE essere la stessa che gira su `jht status` — un sito che
// dice "aggiorna" mentre il terminale dice che va tutto bene è peggio di
// nessuno dei due.
import {
  latestReleaseInfo,
  updateCheckDisabled,
} from "../../../../shared/release/version.js";

const REPO = "leopu00/job-hunter-team";
const CACHE_SECONDS = 3600;

// La route è dinamica e la cache sta sulla FETCH, non sulla risposta. È una
// correzione, non una preferenza: con `export const revalidate` la route
// veniva prerenderizzata al build, quindi la risposta la decideva la rete
// del builder. Misurato il 2026-08-08 con `next build` + `next start`: se
// GitHub non risponde durante il build, `{"release":null}` viene servito con
// `x-nextjs-cache: HIT` per un'ora **anche quando a runtime la situazione è
// cambiata**. La fascia degli aggiornamenti semplicemente non compare, e
// nessuno se ne accorge: la stessa forma del guasto che il banner esiste per
// chiudere.
//
// La Data Cache di Next NON memorizza le fetch fallite, quindi un errore si
// ritenta al giro dopo invece di restare congelato, e una risposta buona
// resta condivisa fra le invocazioni: GitHub continua a vedere al massimo
// una richiesta all'ora, che è il vincolo vero (60/ora per indirizzo, e gli
// indirizzi di Vercel sono condivisi).
export const dynamic = "force-dynamic";

/**
 * Qual è l'ultima versione pubblicata.
 *
 * Non dice nulla dell'utente e non legge nulla di suo: è la stessa risposta
 * per chiunque. `status` distingue i due modi di non avere una release —
 * «non l'ho chiesto» e «non sono riuscito a chiederlo» — perché un endpoint
 * che avvisa gli utenti non può fallire in modo indistinguibile dal silenzio.
 */
export async function GET() {
  if (updateCheckDisabled(process.env)) {
    // Spento di proposito: non è un guasto, ed è giusto che si veda che è
    // una scelta e non una rete che non va.
    return NextResponse.json({ release: null, status: "disabled" });
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5000),
        next: { revalidate: CACHE_SECONDS },
      },
    );
    if (!res.ok) {
      // Il caso che si vuole poter vedere nei log: 403 = quota di GitHub
      // esaurita sull'indirizzo condiviso. Da fuori è indistinguibile da
      // «nessuna release», e senza questa riga resterebbe tale.
      console.error(
        `[latest-release] GitHub ha risposto ${res.status}: nessun avviso di aggiornamento verrà mostrato`,
      );
      return NextResponse.json({
        release: null,
        status: "unreachable",
        http_status: res.status,
      });
    }
    const info = latestReleaseInfo(await res.json(), REPO);
    if (!info) {
      console.error(
        "[latest-release] risposta di GitHub non utilizzabile (draft, prerelease o tag illeggibile)",
      );
      return NextResponse.json({ release: null, status: "unusable" });
    }
    return NextResponse.json({ release: info, status: "ok" });
  } catch (err) {
    console.error(
      `[latest-release] GitHub irraggiungibile: ${(err as Error).message}`,
    );
    return NextResponse.json({ release: null, status: "unreachable" });
  }
}
