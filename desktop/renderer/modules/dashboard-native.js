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

function loadingBox() {
  const box = el('div', 'dash__loading')
  box.appendChild(el('span', 'status-icon'))
  box.appendChild(el('span', null, 'Caricamento…'))
  box.firstChild.dataset.state = 'busy'
  return box
}

// Render generico in un container con gestione errori/empty/loading uniforme.
async function renderInto(containerId, fetchAndBuild) {
  const c = document.getElementById(containerId)
  if (!c) return
  c.innerHTML = ''
  c.appendChild(loadingBox())
  try {
    const node = await fetchAndBuild()
    c.innerHTML = ''
    c.appendChild(node)
  } catch (e) {
    c.innerHTML = ''
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
  const f = document.getElementById('dash-filters')
  if (e) e.hidden = which !== 'empty'
  if (l) l.hidden = which !== 'list'
  if (d) d.hidden = which !== 'detail'
  if (f) f.hidden = which !== 'list'
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
  // Azioni per-offerta (write/recheck/geocode): POST flag via dashboardApi.post.
  const legacyId = p.legacy_id
  if (legacyId != null && window.dashboardApi?.post) {
    const actions = el('div', 'dash-detail__actions')
    const mkBtn = (label, doneLabel, path, already, body = { requested: true }) => {
      const b = el('button', 'btn btn--ghost dash-action', already ? doneLabel : label)
      b.type = 'button'
      if (already) b.disabled = true
      b.addEventListener('click', async () => {
        b.disabled = true; const orig = b.textContent; b.textContent = '…'
        try {
          await window.dashboardApi.post(`/api/positions/${legacyId}/${path}`, body)
          b.textContent = doneLabel
        } catch (e) {
          b.textContent = orig; b.disabled = false
          _log.error('action.failed', { path, err: String(e?.message || e) })
        }
      })
      return b
    }
    actions.appendChild(mkBtn('📝 Richiedi CV', '✓ CV richiesto', 'write-request', !!p.write_requested))
    actions.appendChild(mkBtn('🔄 Ricontrolla', '✓ In ricontrollo', 'recheck-request', !!p.recheck_requested))
    actions.appendChild(mkBtn('📍 Geocodifica', '✓ Geocodifica richiesta', 'geocode-request', !!p.geocode_requested))
    const excluded = p.status === 'excluded' || !!p.user_excluded_reason
    actions.appendChild(mkBtn('🚫 Escludi', '✓ Esclusa', 'user-exclude', excluded, { reason: 'other', note: 'Esclusa dalla dashboard' }))
    d.appendChild(actions)
  }

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
  // Azienda (se analizzata): verdetto + settore + rating + red flag
  const co = data.company
  if (co && (co.verdict || co.sector || co.glassdoor_rating || co.red_flags)) {
    const box = el('div', 'dash-detail__rows')
    box.appendChild(el('div', 'dash-detail__label', 'Azienda'))
    if (co.verdict) box.appendChild(infoRow('Verdetto', co.verdict))
    if (co.sector) box.appendChild(infoRow('Settore', co.sector))
    if (co.size) box.appendChild(infoRow('Dimensione', co.size))
    if (typeof co.glassdoor_rating === 'number') box.appendChild(infoRow('Glassdoor', `${co.glassdoor_rating}/5`))
    if (co.red_flags) box.appendChild(infoRow('Red flag', co.red_flags))
    d.appendChild(box)
  }

  // Candidatura collegata (se esiste): stato + voto critico + risposta
  const ap = data.application
  if (ap && (ap.status || typeof ap.critic_score === 'number' || ap.response)) {
    const box = el('div', 'dash-detail__rows')
    box.appendChild(el('div', 'dash-detail__label', 'Candidatura'))
    if (ap.status) box.appendChild(infoRow('Stato', ap.status))
    if (ap.critic_verdict) box.appendChild(infoRow('Critico', ap.critic_verdict))
    if (typeof ap.critic_score === 'number') box.appendChild(infoRow('Voto critico', `${ap.critic_score}/10`))
    if (ap.response) box.appendChild(infoRow('Risposta', ap.response))
    d.appendChild(box)
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

let _offers = []
let _filtersWired = false

function renderOffers() {
  const q = (document.getElementById('dash-search')?.value || '').trim().toLowerCase()
  const fstatus = document.getElementById('dash-fstatus')?.value || ''
  const fscore = document.getElementById('dash-fscore')?.value || ''
  const rows = _offers.filter((p) => {
    if (q && !(`${p.title || ''} ${p.company || ''}`.toLowerCase().includes(q))) return false
    if (fstatus && p.status !== fstatus) return false
    if (fscore === 'unscored') { if (typeof p.score === 'number') return false }
    else if (fscore) { if (!(typeof p.score === 'number' && p.score >= Number(fscore))) return false }
    return true
  })
  rows.sort((a, b) => {
    const sa = typeof a.score === 'number' ? a.score : -1
    const sb = typeof b.score === 'number' ? b.score : -1
    return sb - sa
  })
  const list = document.getElementById('dash-list'); if (!list) return
  list.innerHTML = ''
  for (const p of rows) list.appendChild(renderCard(p))
  const cnt = document.getElementById('dash-count')
  if (cnt) cnt.textContent = `${rows.length} / ${_offers.length}`
  show('list')
}

function wireFilters() {
  if (_filtersWired) return
  _filtersWired = true
  for (const id of ['dash-search', 'dash-fstatus', 'dash-fscore']) {
    const e2 = document.getElementById(id)
    if (e2) e2.addEventListener('input', renderOffers)
  }
}

export async function loadDashboard() {
  setOffersEmpty('Caricamento…')
  try {
    // facets = lista COMPLETA leggera di tutte le offerte (id/title/company/
    // role_family/score/loc/status), ideale per lista + filtri client.
    const res = await apiGet('/api/positions/facets')
    _offers = Array.isArray(res) ? res : (Array.isArray(res?.facets) ? res.facets : [])
    if (_offers.length === 0) {
      setOffersEmpty('Nessuna offerta ancora. Avvia il team: appena trova offerte compaiono qui.')
      return
    }
    wireFilters()
    renderOffers()
    _log.info('offers.ok', { count: _offers.length })
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

// ───────────────────────── Profilo ─────────────────────────

export function loadProfile() {
  return renderInto('dash-profile', async () => {
    const res = await apiGet('/api/profile')
    const p = res?.profile || null
    if (!p || (!p.name && !p.target_role)) {
      return emptyBox('Profilo non ancora configurato. Lo costruisci con l’assistente del team.')
    }
    const wrap = el('div', 'dash-profile')
    const head = el('div', 'dash-detail__head')
    head.appendChild(el('h2', 'dash-detail__title', p.name || '—'))
    wrap.appendChild(head)
    if (p.target_role) wrap.appendChild(el('p', 'home__subtitle', p.target_role))

    const rows = el('div', 'dash-detail__rows')
    const exp = [p.experience_years ? `${p.experience_years} anni` : null, p.experience_months ? `${p.experience_months} mesi` : null].filter(Boolean).join(' ')
    if (p.email) rows.appendChild(infoRow('Email', p.email))
    if (p.location) rows.appendChild(infoRow('Luogo', p.location))
    if (exp) rows.appendChild(infoRow('Esperienza', exp))
    rows.appendChild(infoRow('Laurea', p.has_degree ? 'Sì' : 'No'))
    if (Array.isArray(p.job_titles) && p.job_titles.length) rows.appendChild(infoRow('Ruoli', p.job_titles.join(', ')))
    if (Array.isArray(p.languages) && p.languages.length) {
      rows.appendChild(infoRow('Lingue', p.languages.map((l) => l.name || l.language || l).join(', ')))
    }
    wrap.appendChild(rows)

    // Skills: Record<categoria, string[]> → chip raggruppate
    if (p.skills && typeof p.skills === 'object') {
      const skillsWrap = el('div', 'dash-profile__skills')
      for (const [cat, list] of Object.entries(p.skills)) {
        if (!Array.isArray(list) || list.length === 0) continue
        const group = el('div', 'dash-profile__skillgroup')
        group.appendChild(el('div', 'dash-detail__label', cat))
        const chips = el('div', 'dash-profile__chips')
        for (const s of list) chips.appendChild(el('span', 'dash-chip', s))
        group.appendChild(chips)
        skillsWrap.appendChild(group)
      }
      if (skillsWrap.childElementCount) wrap.appendChild(skillsWrap)
    }
    return wrap
  })
}

// ───────────────────────── Agenti ─────────────────────────

export function loadAgents() {
  return renderInto('dash-agents', async () => {
    const res = await apiGet('/api/agents')
    const agents = Array.isArray(res) ? res : (Array.isArray(res?.agents) ? res.agents : [])
    if (agents.length === 0) return emptyBox('Nessun agente. Avvia il team dalla sezione Team.')
    const list = el('div', 'dash__list')
    for (const a of agents) {
      const running = a.running === true || a.status === 'running' || a.active === true
      const row = el('div', 'dash-agent')
      const left = el('div', 'dash-agent__main')
      const dot = el('span', `home__status-dot`); dot.dataset.state = running ? 'running' : 'stopped'
      left.append(dot, el('span', 'dash-agent__name', a.name || a.role || a.id || '—'))
      row.appendChild(left)
      row.appendChild(el('span', 'dash-card__date', running ? 'attivo' : 'fermo'))
      list.appendChild(row)
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
