// [JHT-DASHBOARD-SPLIT] Sezioni dashboard NATIVE desktop. Niente webview: le
// view (Offerte, Statistiche, Candidature, Mappa, Attività) sono UI Electron
// native. I dati arrivano dal runtime locale via UN proxy generico
// window.dashboardApi.get(path) (IPC main → fetch localhost:PORT+path con
// local-token — lane dev3). Questo modulo è la lane renderer.

const _log = (typeof window !== 'undefined' && window.jhtLog && window.jhtLog.scope)
  ? window.jhtLog.scope('dashboard-native')
  : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

// Proxy dati generico: una sola dipendenza dall'IPC, tutte le view la usano.
async function apiGet(path) {
  if (!window.dashboardApi?.get) {
    const e = new Error('no-data-channel')
    e.code = 'no-channel'
    throw e
  }
  return window.dashboardApi.get(path)
}

function el(tag, className, text) {
  const n = document.createElement(tag)
  if (className) n.className = className
  if (text !== undefined && text !== null) n.textContent = String(text)
  return n
}

function emptyBox(text) {
  const box = el('div', 'dash__empty')
  box.appendChild(el('div', 'step__emoji', '📊'))
  box.appendChild(el('p', 'home__subtitle', text))
  return box
}

// Render generico in un container con gestione errori/empty uniforme.
async function renderInto(containerId, fetchAndBuild) {
  const c = document.getElementById(containerId)
  if (!c) return
  c.innerHTML = ''
  try {
    const node = await fetchAndBuild()
    c.appendChild(node)
  } catch (e) {
    const msg = e?.code === 'no-channel'
      ? 'Canale dati non disponibile. Avvia il team o aggiorna l’app.'
      : 'Il team non è raggiungibile. Avvialo dalla sezione Team e riprova.'
    c.appendChild(emptyBox(msg))
    _log.warn('render.failed', { containerId, err: String(e?.message || e) })
  }
}

function scoreClass(s) {
  if (typeof s !== 'number') return 'dash-score--none'
  if (s >= 75) return 'dash-score--high'
  if (s >= 40) return 'dash-score--mid'
  return 'dash-score--low'
}

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) } catch { return '' }
}

function locationLabel(p) {
  const remote = p.remote_type === 'full_remote' ? 'Remote' : p.remote_type === 'hybrid' ? 'Ibrido' : null
  const place = p.loc_city || p.location || p.loc_country || null
  return [place, remote].filter(Boolean).join(' · ')
}

// ───────────────────────── Offerte ─────────────────────────

function show(which) {
  const e = document.getElementById('dash-empty')
  const l = document.getElementById('dash-list')
  const d = document.getElementById('dash-detail')
  if (e) e.hidden = which !== 'empty'
  if (l) l.hidden = which !== 'list'
  if (d) d.hidden = which !== 'detail'
}
function setOffersEmpty(text) {
  const t = document.getElementById('dash-empty-text')
  if (t && text) t.textContent = text
  show('empty')
}

function renderCard(p) {
  const card = el('button', 'dash-card'); card.type = 'button'; card.dataset.id = p.id
  const main = el('div', 'dash-card__main')
  main.appendChild(el('div', 'dash-card__title', p.title || '—'))
  const meta = el('div', 'dash-card__meta')
  if (p.company) meta.appendChild(el('span', 'dash-card__company', p.company))
  const loc = locationLabel(p); if (loc) meta.appendChild(el('span', 'dash-card__loc', loc))
  if (p.role_family) meta.appendChild(el('span', 'dash-card__family', p.role_family))
  main.appendChild(meta)
  const side = el('div', 'dash-card__side')
  side.appendChild(el('div', `dash-score ${scoreClass(p.score)}`, typeof p.score === 'number' ? p.score : '—'))
  if (p.found_at) side.appendChild(el('span', 'dash-card__date', fmtDate(p.found_at)))
  card.append(main, side)
  card.addEventListener('click', () => showDetail(p.id))
  return card
}

function infoRow(label, value) {
  const row = el('div', 'dash-detail__row')
  row.append(el('span', 'dash-detail__label', label), el('span', 'dash-detail__value', value))
  return row
}

function renderDetail(data) {
  const d = document.getElementById('dash-detail'); if (!d) return
  const p = data.position || {}; d.innerHTML = ''
  const back = el('button', 'btn btn--ghost dash-detail__back', '← Indietro'); back.type = 'button'
  back.addEventListener('click', () => loadDashboard())
  d.appendChild(back)
  const head = el('div', 'dash-detail__head')
  head.appendChild(el('h2', 'dash-detail__title', p.title || '—'))
  const sc = data.score?.total_score ?? p.score
  if (typeof sc === 'number') head.appendChild(el('div', `dash-score ${scoreClass(sc)}`, sc))
  d.appendChild(head)
  const rows = el('div', 'dash-detail__rows')
  if (p.company) rows.appendChild(infoRow('Azienda', p.company))
  const loc = locationLabel(p); if (loc) rows.appendChild(infoRow('Luogo', loc))
  if (p.role_family) rows.appendChild(infoRow('Categoria', p.role_family))
  if (p.status) rows.appendChild(infoRow('Stato', p.status))
  if (p.url) {
    const row = el('div', 'dash-detail__row')
    const link = el('a', 'dash-detail__value', p.url); link.href = '#'
    link.addEventListener('click', (e) => { e.preventDefault(); window.launcherApi?.openExternal?.(p.url) })
    row.append(el('span', 'dash-detail__label', 'Annuncio'), link); rows.appendChild(row)
  }
  d.appendChild(rows)
  const hls = Array.isArray(data.highlights) ? data.highlights : []
  const pros = hls.filter((h) => h.type === 'pro'); const cons = hls.filter((h) => h.type === 'con')
  if (pros.length || cons.length) {
    const wrap = el('div', 'dash-detail__highlights')
    const col = (title, items, cls) => {
      const c = el('div', `dash-detail__hlcol ${cls}`); c.appendChild(el('div', 'dash-detail__hltitle', title))
      const ul = el('ul', 'dash-detail__hllist'); for (const it of items) ul.appendChild(el('li', null, it.text)); c.appendChild(ul); return c
    }
    if (pros.length) wrap.appendChild(col('Pro', pros, 'is-pro'))
    if (cons.length) wrap.appendChild(col('Contro', cons, 'is-con'))
    d.appendChild(wrap)
  }
  if (p.jd_text) {
    const desc = el('div', 'dash-detail__desc')
    desc.appendChild(el('div', 'dash-detail__label', 'Descrizione'))
    desc.appendChild(el('p', null, p.jd_text)); d.appendChild(desc)
  }
  show('detail')
}

async function showDetail(id) {
  try {
    const data = await apiGet('/api/positions/' + encodeURIComponent(id))
    if (data && data.position) renderDetail(data)
  } catch (e) { _log.error('detail.failed', { id, err: String(e?.message || e) }) }
}

export async function loadDashboard() {
  try {
    const res = await apiGet('/api/positions/recent?limit=50')
    const positions = Array.isArray(res?.positions) ? res.positions : []
    if (positions.length === 0) { setOffersEmpty('Nessuna offerta ancora. Avvia il team: appena trova offerte compaiono qui.'); return }
    positions.sort((a, b) => {
      const sa = typeof a.score === 'number' ? a.score : -1
      const sb = typeof b.score === 'number' ? b.score : -1
      if (sb !== sa) return sb - sa
      return String(b.found_at || '').localeCompare(String(a.found_at || ''))
    })
    const list = document.getElementById('dash-list'); if (!list) return
    list.innerHTML = ''
    for (const p of positions) list.appendChild(renderCard(p))
    show('list')
    _log.info('offers.ok', { count: positions.length })
  } catch (e) {
    setOffersEmpty(e?.code === 'no-channel'
      ? 'Canale dati non disponibile. Avvia il team o aggiorna l’app.'
      : 'Il team non è raggiungibile. Avvialo dalla sezione Team e riprova.')
  }
}

// ───────────────────────── Statistiche ─────────────────────────

const STAT_CARDS = [
  ['total', 'Totali'], ['new', 'Nuove'], ['checked', 'Verificate'], ['scored', 'Valutate'],
  ['writing', 'In scrittura'], ['review', 'In revisione'], ['ready', 'Pronte'],
  ['applied', 'Inviate'], ['response', 'Risposte'], ['excluded', 'Escluse'],
]

export function loadStats() {
  return renderInto('dash-stats', async () => {
    const s = await apiGet('/api/dashboard/stats')
    const grid = el('div', 'dash-stats__grid')
    for (const [key, label] of STAT_CARDS) {
      const card = el('div', 'dash-stat')
      card.appendChild(el('div', 'dash-stat__num', typeof s?.[key] === 'number' ? s[key] : 0))
      card.appendChild(el('div', 'dash-stat__label', label))
      grid.appendChild(card)
    }
    return grid
  })
}

// ───────────────────────── Candidature ─────────────────────────

export function loadApplications() {
  return renderInto('dash-apps', async () => {
    const res = await apiGet('/api/applications')
    const apps = Array.isArray(res?.applications) ? res.applications : []
    const counts = res?.counts || {}
    const wrap = el('div', 'dash-apps')
    const countRow = el('div', 'dash-apps__counts')
    for (const [k, label] of [['draft', 'Bozze'], ['sent', 'Inviate'], ['viewed', 'Viste'], ['interview', 'Colloqui'], ['offer', 'Offerte'], ['rejected', 'Rifiutate']]) {
      const chip = el('div', 'dash-apps__count')
      chip.appendChild(el('span', 'dash-apps__count-num', counts[k] ?? 0))
      chip.appendChild(el('span', 'dash-apps__count-label', label))
      countRow.appendChild(chip)
    }
    wrap.appendChild(countRow)
    if (apps.length === 0) { wrap.appendChild(el('p', 'home__subtitle', 'Nessuna candidatura ancora.')); return wrap }
    const list = el('div', 'dash__list')
    for (const a of apps) {
      const card = el('div', 'dash-card')
      const main = el('div', 'dash-card__main')
      main.appendChild(el('div', 'dash-card__title', a.position_title || a.position_id || '—'))
      const meta = el('div', 'dash-card__meta')
      meta.appendChild(el('span', null, `Stato: ${a.status || '—'}`))
      if (a.applied_at) meta.appendChild(el('span', null, `Inviata: ${fmtDate(a.applied_at)}`))
      if (a.response) meta.appendChild(el('span', null, 'Risposta ricevuta'))
      main.appendChild(meta)
      const side = el('div', 'dash-card__side')
      if (typeof a.critic_score === 'number') side.appendChild(el('div', `dash-score ${scoreClass(a.critic_score * 10)}`, a.critic_score))
      card.append(main, side)
      list.appendChild(card)
    }
    wrap.appendChild(list)
    return wrap
  })
}

// ───────────────────────── Mappa (raggruppamento per luogo) ─────────────────────────

export function loadMap() {
  return renderInto('dash-map', async () => {
    const coords = await apiGet('/api/positions/coords')
    const arr = Array.isArray(coords) ? coords : []
    if (arr.length === 0) return emptyBox('Nessuna offerta geolocalizzata ancora.')
    const byPlace = new Map()
    for (const c of arr) {
      const key = c.is_remote ? 'Remote' : (c.loc_city || c.loc_country || c.location || 'Altro')
      const g = byPlace.get(key) || { count: 0, best: null }
      g.count += 1
      if (typeof c.score === 'number' && (g.best == null || c.score > g.best)) g.best = c.score
      byPlace.set(key, g)
    }
    const rows = [...byPlace.entries()].sort((a, b) => b[1].count - a[1].count)
    const list = el('div', 'dash__list')
    for (const [place, g] of rows) {
      const card = el('div', 'dash-card')
      const main = el('div', 'dash-card__main')
      main.appendChild(el('div', 'dash-card__title', place))
      main.appendChild(el('div', 'dash-card__meta', `${g.count} offerte`))
      const side = el('div', 'dash-card__side')
      if (g.best != null) side.appendChild(el('div', `dash-score ${scoreClass(g.best)}`, g.best))
      card.append(main, side)
      list.appendChild(card)
    }
    return list
  })
}

// ───────────────────────── Attività ─────────────────────────

export function loadActivity() {
  return renderInto('dash-activity', async () => {
    const data = await apiGet('/api/positions/state-history')
    const arr = Array.isArray(data) ? data : (Array.isArray(data?.transitions) ? data.transitions : [])
    if (arr.length === 0) return emptyBox('Nessuna attività registrata ancora.')
    const rows = arr.slice(0, 100)
    const list = el('div', 'dash__list')
    for (const t of rows) {
      const card = el('div', 'dash-activity__row')
      const left = el('div', 'dash-activity__main')
      left.appendChild(el('div', 'dash-activity__what', `${t.by_agent || t.agent || '—'} → ${t.to_state || t.state || '—'}`))
      if (t.position_title || t.title) left.appendChild(el('div', 'dash-card__meta', t.position_title || t.title))
      card.appendChild(left)
      const ts = t.ts || t.at || t.created_at
      if (ts) card.appendChild(el('span', 'dash-card__date', fmtDate(ts)))
      list.appendChild(card)
    }
    return list
  })
}
