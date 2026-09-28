// PostgREST applica un massimo server-side (1000 nel progetto) anche quando
// il chiamante non specifica alcun limite, e anche quando chiede di più con
// `.limit(10000)`. Una query secca sembra riuscire ma restituisce solo il
// primo blocco: un export che sembra completo, un mazzo in cui le posizioni
// già giudicate tornano, statistiche su 1000 righe a caso.
//
// Questo è l'unico lettore a pagine: web e desktop (che importa `@/lib/*`)
// passano tutti da qui. Il builder arriva DOPO filtri e order; `.range()`
// cambia soltanto la finestra, quindi ogni pagina mantiene esattamente la
// semantica della query del chiamante.
//
// Le pagine sono stabili solo se l'ordine lo è: chi chiama ordina per una
// colonna unica (o chiude l'ordine con una), altrimenti fra una pagina e
// l'altra PostgreSQL può restituire le righe in un altro ordine e una riga
// comparire due volte mentre un'altra non compare mai.

export const POSTGREST_PAGE_SIZE = 1000;

export type PostgrestRangeQuery<T> = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>;
};

/**
 * Tutte le righe della query, una pagina dopo l'altra. `limit` ferma prima
 * (le prime N), `offset` parte più avanti, `enough(rows)` ferma quando chi
 * chiama ha quello che gli serve (letto dopo ogni pagina). Su un errore
 * restituisce le righe lette fino a lì CON l'errore: chi chiama decide, ma
 * non può scambiarle per il risultato intero.
 */
export async function fetchPostgrestRows<T>(
  query: PostgrestRangeQuery<T>,
  opts: {
    offset?: number;
    limit?: number;
    enough?: (rows: T[]) => boolean;
  } = {},
): Promise<{ data: T[]; error: unknown | null; count: number | null }> {
  const rows: T[] = [];
  let offset = opts.offset ?? 0;
  let count: number | null = null;

  while (opts.limit == null || rows.length < opts.limit) {
    const remaining = opts.limit == null ? Infinity : opts.limit - rows.length;
    const pageSize = Math.min(POSTGREST_PAGE_SIZE, remaining);
    const {
      data,
      error,
      count: pageCount,
    } = await query.range(offset, offset + pageSize - 1);
    if (error || !data) {
      return {
        data: rows,
        error: error ?? new Error("PostgREST response did not contain data"),
        count,
      };
    }
    // Con `select(..., { count: "exact" })` ogni pagina porta il totale:
    // resta quello della prima, il totale al momento in cui si è cominciato.
    if (count === null && typeof pageCount === "number") count = pageCount;
    rows.push(...data);
    if (data.length < pageSize || opts.enough?.(rows)) break;
    offset += data.length;
  }

  return { data: rows, error: null, count };
}

export type PostgrestKeysetQuery<T> = {
  limit(
    n: number,
  ): PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>;
};

/**
 * Tutte le righe, a pagine per chiave invece che per posizione: ogni pagina
 * chiede le righe con `key` oltre l'ultima letta. Dove la tabella può
 * cambiare mentre si legge (un push durante un restore o un export), le
 * pagine per offset spostano la finestra: una riga inserita prima del punto
 * letto ne fa uscire una due volte, una cancellata ne fa saltare un'altra,
 * e il conteggio può tornare lo stesso. Per chiave no.
 *
 * `page(after)` costruisce la query di una pagina: filtri, poi
 * `.gt(key, after)` quando `after` non è null, poi `.order(key)`. La chiave
 * deve essere unica e fra le colonne selezionate. Con `{ count: "exact" }`
 * il totale è quello della prima pagina, quando si è cominciato.
 */
export async function fetchPostgrestRowsByKey<
  T extends Record<string, unknown>,
>(
  page: (after: unknown) => PostgrestKeysetQuery<T>,
  key: string,
  opts: { limit?: number } = {},
): Promise<{ data: T[]; error: unknown | null; count: number | null }> {
  const rows: T[] = [];
  let after: unknown = null;
  let count: number | null = null;

  while (opts.limit == null || rows.length < opts.limit) {
    const remaining = opts.limit == null ? Infinity : opts.limit - rows.length;
    const pageSize = Math.min(POSTGREST_PAGE_SIZE, remaining);
    const { data, error, count: pageCount } = await page(after).limit(pageSize);
    if (error || !data) {
      return {
        data: rows,
        error: error ?? new Error("PostgREST response did not contain data"),
        count,
      };
    }
    if (after === null && typeof pageCount === "number") count = pageCount;
    rows.push(...data);
    if (data.length < pageSize) break;
    after = data[data.length - 1][key];
    if (after === undefined || after === null) {
      return {
        data: rows,
        error: new Error(`keyset column ${key} missing from the rows`),
        count,
      };
    }
  }

  return { data: rows, error: null, count };
}
