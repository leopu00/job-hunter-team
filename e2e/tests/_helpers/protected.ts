import { expect, test, type Page } from "@playwright/test";

/**
 * Ingresso nell'area riservata con il dataset demo.
 *
 * Le spec dell'area protetta hanno due condizioni d'ambiente, e nessun'altra
 * scusa per saltare: il server dev'essere in modalità cloud e ci vuole una
 * sessione. Entrambe si annunciano con un motivo esplicito — la regola di
 * casa è **skip loudly, and only on the environment** (`e2e/README.md`), ed è
 * la regola che la quarantena del 2026-07-26 ha dovuto imporre a 75 spec che
 * si auto-skippavano nascondendo asserzioni vuote.
 *
 * Perché la demo e non i dati veri dell'account di test: il dataset demo è
 * versionato nel repo (`web/lib/demo/seeds/`), quindi si può asserire sul
 * CONTENUTO — «questa posizione, questa azienda, questo nome» — invece che
 * su «esiste almeno una riga», che è il genere di asserzione che passa
 * anche quando la pagina è rotta.
 */

/** La persona demo su cui sono tarate le spec dell'area protetta. */
export const PERSONA = "software";

/** Il server non è in modalità cloud: l'area riservata non esiste proprio. */
export async function cloudOrSkip(page: Page): Promise<void> {
  const res = await page.request.get("/api/demo");
  test.skip(
    res.status() === 404,
    "server non in modalità cloud (NEXT_PUBLIC_JHT_DEPLOY=cloud)",
  );
}

/** Attiva la demo e pretende una sessione: senza, si salta dicendolo. */
export async function demoSessionOrSkip(page: Page): Promise<void> {
  const res = await page.request.post("/api/demo", {
    data: { persona: PERSONA },
  });
  expect(res.ok(), "POST /api/demo non ha attivato la demo").toBe(true);

  const dash = await page.request.get("/dashboard", { maxRedirects: 0 });
  test.skip(
    dash.status() === 307,
    "serve una sessione autenticata per l'area riservata — vedi e2e/README.md § Sessione",
  );
}

/**
 * Apre una pagina protetta pretendendo un 200.
 *
 * `domcontentloaded` e mai `networkidle`: queste pagine sono server component
 * serviti in streaming e su `/map` la rete non tace mai (i tile continuano a
 * chiedere). L'attesa del contenuto la fa l'asserzione che segue, con i suoi
 * ritenta — non un'inattività che potrebbe non arrivare.
 */
export async function openProtected(page: Page, path: string): Promise<void> {
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res?.status(), `${path} non risponde 200`).toBe(200);
}
