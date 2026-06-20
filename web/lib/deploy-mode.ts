// Modalità di DEPLOY — decisa a BUILD/DEPLOY, non per-richiesta a runtime.
//
// È il cuore di [JHT-DASHBOARD-SPLIT]: una sola codebase, due modalità
// mutuamente esclusive fissate quando l'app viene buildata/deployata, NON
// indovinate richiesta-per-richiesta dagli header. Una data istanza in
// esecuzione è SEMPRE una modalità sola → sparisce l'ambiguità "quali dati
// vedo / dove scrivo".
//
//   'cloud'  → deploy su Vercel (browser + Supabase). Dati in SOLA LETTURA +
//              la sola corsia richieste async (ticket/feedback/azioni-posizione).
//              Nessun SQLite, nessuna scrittura di controllo/config/dati.
//   'local'  → container CO-LOCATO col team: PC dell'utente dentro l'app
//              desktop, oppure VPS via tunnel SSH. SQLite source-of-truth,
//              scrittura piena. La STESSA immagine Docker vale per PC e VPS:
//              entrambi sono co-locati → entrambi 'local'.
//
// Relazione con le primitive runtime esistenti:
//   - isLocalOnlyMode() (workspace.ts) = filesystem (SQLite presente + cloud off)
//   - isLocalRequest()  (auth.ts)      = header host == localhost
// Restano valide e COERENTI con questo flag in tutti i casi reali (su Vercel
// non c'è SQLite e l'host è il dominio → entrambe dicono "non locale"; nel
// container l'host è localhost → "locale"). Questo flag le rende DETERMINISTICHE
// e — essendo NEXT_PUBLIC_ — leggibili anche dal CLIENT senza un round-trip.
//
// Sorgente: env NEXT_PUBLIC_JHT_DEPLOY ('cloud' | 'local'), inlinata a build
// (client) / letta a runtime (server, container in `next dev`/`next start`).
//   - Vercel:            impostare NEXT_PUBLIC_JHT_DEPLOY=cloud (env progetto).
//   - Container/desktop: default 'local' (env assente) — vedi docker-compose.yml.
// Fallback solo server-side: env assente ma `VERCEL` presente → 'cloud'.
// Stesso pattern "default sicuro" di getSupabaseConfig() (default + override env).

export type DeployMode = "cloud" | "local";

export function getDeployMode(): DeployMode {
  const explicit = process.env.NEXT_PUBLIC_JHT_DEPLOY?.trim().toLowerCase();
  if (explicit === "cloud") return "cloud";
  if (explicit === "local") return "local";
  // Fallback solo server-side: `VERCEL` è presente a build e runtime su Vercel.
  // Sul client `process.env.VERCEL` non è inlinato → undefined → ignorato.
  if (process.env.VERCEL) return "cloud";
  return "local";
}

export function isCloudDeploy(): boolean {
  return getDeployMode() === "cloud";
}

export function isLocalDeploy(): boolean {
  return getDeployMode() === "local";
}
