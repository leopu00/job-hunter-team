/**
 * `positions.score` è una sorgente che non è una sorgente.
 *
 * La colonna esiste dalla migrazione 001 e **non la scrive nessuno**: il
 * `jobs.db` locale non ha una colonna `score` su `positions` — i punteggi
 * stanno nella tabella `scores` — quindi il push non può riempirla e non la
 * riempirà mai. Misurato sul cloud il 17/08: 0 valorizzate su 1634 per
 * l'operatore, e 0 per ogni altro utente reale. Le uniche 168 righe piene
 * appartengono a quattro account di prova, e **tutte** hanno anche la loro
 * riga in `scores`: la colonna non porta un'informazione unica a nessuno.
 *
 * Non ha mai rotto niente, perché ogni lettura la usava come prima scelta con
 * la tabella `scores` come ripiego. Ma una colonna vuota che sta dentro una
 * select è una trappola armata: chi scrive la query successiva la vede
 * nell'elenco, se ne fida in buona fede, e ottiene il vuoto senza nessun
 * errore che glielo dica. È lo stesso difetto che abbiamo inseguito tutto il
 * giorno — qualcosa che sembra coprire e non copre — solo che qui la cosa che
 * sembra una fonte è una colonna.
 *
 * Questo test non elenca le query di oggi: le CERCA nel sorgente. Una query
 * nuova che nominasse di nuovo quella colonna lo fa diventare rosso, e questo
 * commento le spiega perché.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const QUERIES = join(__dirname, "../../../web/lib/queries.ts");

/** Le select su `positions`, prese dal sorgente e non ricopiate qui. */
function selectSuPositions(src: string): string[] {
  const out: string[] = [];
  const re =
    /\.from\(\s*"positions"\s*\)\s*(?:\.\w+\([^)]*\)\s*)*?\.select\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

/** Le colonne di primo livello: gli embed `tabella ( a, b )` restano interi. */
function colonneDiPrimoLivello(select: string): string[] {
  const fuori: string[] = [];
  let profondita = 0;
  let corrente = "";
  for (const ch of select) {
    if (ch === "(") profondita++;
    if (ch === ")") profondita--;
    if (ch === "," && profondita === 0) {
      fuori.push(corrente.trim());
      corrente = "";
      continue;
    }
    corrente += ch;
  }
  if (corrente.trim()) fuori.push(corrente.trim());
  return fuori;
}

describe("nessuna query si fida di positions.score", () => {
  const src = readFileSync(QUERIES, "utf-8");

  it("le select su positions non chiedono la colonna morta", () => {
    const select = selectSuPositions(src);
    // Una ricerca vuota non è una ricerca: se l'estrattore smette di trovare
    // le query, questo file passerebbe senza aver guardato niente.
    expect(
      select.length,
      "nessuna select su `positions` trovata: l'estrattore è da aggiornare, non il verdetto",
    ).toBeGreaterThan(8);

    const colpevoli = select.filter((s) =>
      colonneDiPrimoLivello(s).includes("score"),
    );
    expect(
      colpevoli.map((s) => s.slice(0, 60)),
      "queste select chiedono `positions.score`, che è sempre NULL",
    ).toEqual([]);
  });

  it("e nessun mapping tiene il ripiego «prima la colonna, poi la tabella»", () => {
    // Togliere la colonna dalla select e lasciare il ripiego nel codice
    // sarebbe la stessa malattia un piano più su: il lettore successivo
    // troverebbe scritto `p.score ?? …total_score` e ne dedurrebbe che una
    // sorgente c'è.
    //
    // Si cerca ESATTAMENTE quella forma — un `score` a sinistra di un `??` che
    // ripiega su `total_score` — e non ogni lettura di `.score`: il campo
    // `score` del modello `Position` è quello vero, lo legge mezza interfaccia
    // e deve restare. Un test che vietasse anche quello proibirebbe il nome
    // invece del difetto.
    const compatto = src.replace(/\s+/g, " ");
    const ripieghi =
      compatto.match(
        /\b\w+\??\.score\b(?:\s+as[^)]*\))?\s*\?\?[^;,]{0,80}total_score/g,
      ) ?? [];

    expect(ripieghi, "ripieghi sulla colonna morta rimasti nel codice").toEqual(
      [],
    );
  });

  it("il punteggio continua ad avere la sua vera fonte", () => {
    // La clausola falsa: se qualcuno «riparasse» questo test cancellando anche
    // le letture di `scores`, i due sopra resterebbero verdi e il punteggio
    // sparirebbe davvero. La fonte deve restare nominata.
    const select = selectSuPositions(src);
    const conScores = select.filter((s) => /scores\s*\(/.test(s));
    expect(conScores.length).toBeGreaterThan(5);
    expect(src).toContain("total_score");
  });
});
