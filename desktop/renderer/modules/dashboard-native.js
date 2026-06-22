// [JHT-DASHBOARD-SPLIT] Dashboard NATIVA desktop. Niente webview: le offerte
// del team sono renderizzate con UI Electron nativa. I dati arrivano dal
// runtime locale via window.dashboardApi (IPC main → fetch localhost:PORT/api
// con local-token, esposto dal preload — lane dev3). Questo modulo è la lane
// renderer: fetch via IPC + render lista/dettaglio.

const _log = (typeof window !== 'undefined' && window.jhtLog && window.jhtLog.scope)
  ? window.jhtLog.scope('dashboard-native')
  : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const dom = {
  empty: () => document.getElementById('dash-empty'),
  emptyText: () => document.getElementById('dash-empty-text'),
  list: () => document.getElementById('dash-list'),
  detail: () => document.getElementById('dash-detail'),
}

function show(which) {
  // which: 'empty' | 'list' | 'detail'
  const e = dom.empty(); const l = dom.list(); const d = dom.detail()
  if (e) e.hidden = which !== 'empty'
  if (l) l.hidden = which !== 'list'
  if (d) d.hidden = which !== 'detail'
}

function setEmpty(text) {
  const t = dom.emptyText()
  if (t && text) t.textContent = text
  show('empty')
}

// Banda colore neutra per lo score (0-100): alto=verde, medio=ambra, basso=dim.
// Coerente con la scelta "solo score + gradiente neutro, niente etichette".
function scoreClass(score) {
  if (typeof score !== 'number') return 'dash-score--none'
  if (score >= 75) return 'dash-score--high'
  if (score >= 40) return 'dash-score--mid'
  return 'dash-score--low'
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  } catch { return '' }
}

function locationLabel(p) {
  const remote = p.remote_type === 'full_remote'
    ? 'Remote'
    : p.remote_type === 'hybrid' ? 'Ibrido' : null
  const place = p.loc_city || p.location || p.loc_country || null
  return [place, remote].filter(Boolean).join(' · ')
}

function el(tag, className, text) {
  const n = document.createElement(tag)
  if (className) n.className = className
  if (text !== undefined && text !== null) n.textContent = String(text)
  return n
}

function renderCard(p) {
  const card = el('button', 'dash-card')
  card.type = 'button'
  card.dataset.id = p.id

  const main = el('div', 'dash-card__main')
  main.appendChild(el('div', 'dash-card__title', p.title || '—'))
  const meta = el('div', 'dash-card__meta')
  if (p.company) meta.appendChild(el('span', 'dash-card__company', p.company))
  const loc = locationLabel(p)
  if (loc) meta.appendChild(el('span', 'dash-card__loc', loc))
  if (p.role_family) meta.appendChild(el('span', 'dash-card__family', p.role_family))
  main.appendChild(meta)

  const side = el('div', 'dash-card__side')
  const badge = el('div', `dash-score ${scoreClass(p.score)}`, typeof p.score === 'number' ? p.score : '—')
  side.appendChild(badge)
  if (p.found_at) side.appendChild(el('span', 'dash-card__date', fmtDate(p.found_at)))

  card.append(main, side)
  card.addEventListener('click', () => showDetail(p.id))
  return card
}

function renderList(positions) {
  const list = dom.list()
  if (!list) return
  list.innerHTML = ''
  for (const p of positions) list.appendChild(renderCard(p))
  show('list')
}

function infoRow(label, value) {
  const row = el('div', 'dash-detail__row')
  row.append(el('span', 'dash-detail__label', label), el('span', 'dash-detail__value', value))
  return row
}

function renderDetail(data) {
  const d = dom.detail()
  if (!d) return
  const p = data.position || {}
  d.innerHTML = ''

  const back = el('button', 'btn btn--ghost dash-detail__back', '← Indietro')
  back.type = 'button'
  back.addEventListener('click', () => loadDashboard())
  d.appendChild(back)

  const head = el('div', 'dash-detail__head')
  head.appendChild(el('h2', 'dash-detail__title', p.title || '—'))
  if (typeof data.score?.total_score === 'number' || typeof p.score === 'number') {
    const sc = data.score?.total_score ?? p.score
    head.appendChild(el('div', `dash-score ${scoreClass(sc)}`, sc))
  }
  d.appendChild(head)

  const rows = el('div', 'dash-detail__rows')
  if (p.company) rows.appendChild(infoRow('Azienda', p.company))
  const loc = locationLabel(p); if (loc) rows.appendChild(infoRow('Luogo', loc))
  if (p.role_family) rows.appendChild(infoRow('Categoria', p.role_family))
  if (p.status) rows.appendChild(infoRow('Stato', p.status))
  if (p.url) {
    const row = el('div', 'dash-detail__row')
    const link = el('a', 'dash-detail__value', p.url)
    link.href = '#'
    link.addEventListener('click', (e) => { e.preventDefault(); window.launcherApi?.openExternal?.(p.url) })
    row.append(el('span', 'dash-detail__label', 'Annuncio'), link)
    rows.appendChild(row)
  }
  d.appendChild(rows)

  // Pro/Contro
  const highlights = Array.isArray(data.highlights) ? data.highlights : []
  const pros = highlights.filter((h) => h.type === 'pro')
  const cons = highlights.filter((h) => h.type === 'con')
  if (pros.length || cons.length) {
    const hl = el('div', 'dash-detail__highlights')
    const col = (title, items, cls) => {
      const c = el('div', `dash-detail__hlcol ${cls}`)
      c.appendChild(el('div', 'dash-detail__hltitle', title))
      const ul = el('ul', 'dash-detail__hllist')
      for (const it of items) ul.appendChild(el('li', null, it.text))
      c.appendChild(ul)
      return c
    }
    if (pros.length) hl.appendChild(col('Pro', pros, 'is-pro'))
    if (cons.length) hl.appendChild(col('Contro', cons, 'is-con'))
    d.appendChild(hl)
  }

  // Descrizione
  if (p.jd_text) {
    const desc = el('div', 'dash-detail__desc')
    desc.appendChild(el('div', 'dash-detail__label', 'Descrizione'))
    desc.appendChild(el('p', null, p.jd_text))
    d.appendChild(desc)
  }

  show('detail')
}

async function showDetail(id) {
  if (!window.dashboardApi?.getPosition) return
  try {
    const data = await window.dashboardApi.getPosition(id)
    if (data && data.position) renderDetail(data)
    else _log.warn('detail.empty', { id })
  } catch (e) {
    _log.error('detail.failed', { id, err: String(e?.message || e) })
  }
}

// Carica la lista offerte. Chiamata quando si entra nella sezione Dashboard.
export async function loadDashboard() {
  if (!window.dashboardApi?.listPositions) {
    // Canale dati non ancora disponibile (IPC main/preload non cablato o app
    // vecchia): mostra empty informativo, non un errore.
    setEmpty('Canale dati non disponibile. Avvia il team o aggiorna l’app.')
    return
  }
  try {
    const res = await window.dashboardApi.listPositions({ limit: 50 })
    const positions = Array.isArray(res?.positions) ? res.positions : []
    if (positions.length === 0) {
      setEmpty('Nessuna offerta ancora. Avvia il team dalla sezione Team: appena trova offerte compaiono qui.')
      return
    }
    renderList(positions)
    _log.info('list.ok', { count: positions.length })
  } catch (e) {
    _log.error('list.failed', { err: String(e?.message || e) })
    setEmpty('Il team non è raggiungibile. Avvialo dalla sezione Team e riprova.')
  }
}
