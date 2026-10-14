import { FormEvent, useEffect, useState } from "react";
import { readDesktopVpsPosition, readDesktopVpsPositions } from "../lib/existing-team-positions";

interface PositionRow { id: string; title: string; company: string; }
interface PositionDetail { position: { title: string; company: string; location: string | null; jd_summary: string | null }; highlights: Array<{ id: string; type: string; text: string }>; }
const PAGE_SIZE = 20;

export function ReadonlyExistingPositions({ readiness, onClose }: { readiness: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PositionRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<PositionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(nextQuery = query, nextOffset = offset) {
    setLoading(true); setError(null); setDetail(null);
    const result = await readDesktopVpsPositions({ ...(nextQuery ? { q: nextQuery } : {}), limit: PAGE_SIZE, offset: nextOffset });
    if (result.source !== "vps") { setItems([]); setError("Annunci non disponibili per questa connessione."); }
    else setItems(result.data);
    setLoading(false);
  }
  async function select(id: string) {
    const result = await readDesktopVpsPosition(id);
    if (result.source !== "vps" || !result.data) { setDetail(null); setError("Dettaglio non disponibile."); return; }
    setDetail(result.data);
  }
  useEffect(() => { void load("", 0); }, []);
  return <section className="existing-team-modal__status existing-team-modal__status--readonly" aria-live="polite">
    <strong>Annunci in sola lettura</strong>
    <p>{readiness ? "Squadra attiva." : "Assistente non attivo: la lettura resta disponibile, nessuna azione operativa è abilitata."}</p>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); setOffset(0); void load(query, 0); }}>
      <label>Filtro annunci <input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="submit" disabled={loading}>Filtra</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <ul>{items.map((item) => <li key={item.id}><button type="button" onClick={() => void select(item.id)}>{item.title} — {item.company}</button></li>)}</ul>
    <div><button type="button" disabled={loading || offset === 0} onClick={() => { const next = Math.max(0, offset - PAGE_SIZE); setOffset(next); void load(query, next); }}>Precedente</button><button type="button" disabled={loading || items.length < PAGE_SIZE} onClick={() => { const next = offset + PAGE_SIZE; setOffset(next); void load(query, next); }}>Successivo</button></div>
    {detail && <article><h3>{detail.position.title}</h3><p>{detail.position.company}</p><p>{detail.position.location}</p><p>{detail.position.jd_summary}</p><ul>{detail.highlights.map((highlight) => <li key={highlight.id}>{highlight.type}: {highlight.text}</li>)}</ul></article>}
    <button type="button" onClick={onClose}>Torna alla configurazione</button>
  </section>;
}
