// [JHT-DASHBOARD-SPLIT] Sezioni dashboard NATIVE desktop. Niente webview: le
// view (Offerte, Statistiche, Candidature, Mappa, Attività) sono UI Electron
// native. I dati arrivano dal runtime locale via UN proxy generico
// window.dashboardApi.get(path) (IPC main → fetch localhost:PORT+path con
// local-token — lane dev3). Questo modulo è la lane renderer.

import { t } from './i18n.js'

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
  box.appendChild(el('span', null, t('dash.loading')))
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
      ? t('dash.error.noChannel')
      : t('dash.error.unreachable')
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
  const remote = p.remote_type === 'full_remote' ? t('dash.location.remote') : p.remote_type === 'hybrid' ? t('dash.location.hybrid') : null
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
  const back = el('button', 'btn btn--ghost dash-detail__back', t('dash.detail.back')); back.type = 'button'
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
    actions.appendChild(mkBtn(t('dash.actions.requestCv'), t('dash.actions.cvRequested'), 'write-request', !!p.write_requested))
    actions.appendChild(mkBtn(t('dash.actions.recheck'), t('dash.actions.recheckRequested'), 'recheck-request', !!p.recheck_requested))
    actions.appendChild(mkBtn(t('dash.actions.geocode'), t('dash.actions.geocodeRequested'), 'geocode-request', !!p.geocode_requested))
    const excluded = p.status === 'excluded' || !!p.user_excluded_reason
    actions.appendChild(mkBtn(t('dash.actions.exclude'), t('dash.actions.excluded'), 'user-exclude', excluded, { reason: 'other', note: t('dash.actions.excludedNote') }))
    d.appendChild(actions)

    // Ticket: richiesta libera al team su questa offerta.
    const tk = el('div', 'dash-ticket')
    tk.appendChild(el('div', 'dash-detail__label', t('dash.ticket.title')))
    const tkRow = el('div', 'dash-ticket__row')
    const tkIn = el('input', 'dash-ticket__input'); tkIn.type = 'text'
    tkIn.placeholder = t('dash.ticket.placeholder')
    const tkBtn = el('button', 'btn btn--ghost', t('dash.ticket.send')); tkBtn.type = 'button'
    const sendTicket = async () => {
      const text = tkIn.value.trim()
      if (!text) return
      tkBtn.disabled = true; const orig = tkBtn.textContent; tkBtn.textContent = '…'
      try {
        await window.dashboardApi.post(`/api/positions/${legacyId}/ticket`, { request_text: text })
        tkIn.value = ''; tkBtn.textContent = t('dash.ticket.sent')
        setTimeout(() => { tkBtn.textContent = orig; tkBtn.disabled = false }, 2000)
      } catch (e) {
        tkBtn.textContent = orig; tkBtn.disabled = false
        _log.error('ticket.failed', { err: String(e?.message || e) })
      }
    }
    tkBtn.addEventListener('click', sendTicket)
    tkIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendTicket() } })
    tkRow.append(tkIn, tkBtn)
    tk.appendChild(tkRow)
    d.appendChild(tk)
  }

  const rows = el('div', 'dash-detail__rows')
  if (p.company) rows.appendChild(infoRow(t('dash.detail.company'), p.company))
  const loc = locationLabel(p); if (loc) rows.appendChild(infoRow(t('dash.detail.location'), loc))
  if (p.role_family) rows.appendChild(infoRow(t('dash.detail.category'), p.role_family))
  if (p.status) rows.appendChild(infoRow(t('dash.detail.status'), p.status))
  if (p.url) {
    const row = el('div', 'dash-detail__row')
    const link = el('a', 'dash-detail__value', p.url); link.href = '#'
    link.addEventListener('click', (e) => { e.preventDefault(); window.launcherApi?.openExternal?.(p.url) })
    row.append(el('span', 'dash-detail__label', t('dash.detail.listing')), link); rows.appendChild(row)
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
    if (pros.length) wrap.appendChild(col(t('dash.detail.pros'), pros, 'is-pro'))
    if (cons.length) wrap.appendChild(col(t('dash.detail.cons'), cons, 'is-con'))
    d.appendChild(wrap)
  }
  // Azienda (se analizzata): verdetto + settore + rating + red flag
  const co = data.company
  if (co && (co.verdict || co.sector || co.glassdoor_rating || co.red_flags)) {
    const box = el('div', 'dash-detail__rows')
    box.appendChild(el('div', 'dash-detail__label', t('dash.detail.company')))
    if (co.verdict) box.appendChild(infoRow(t('dash.detail.verdict'), co.verdict))
    if (co.sector) box.appendChild(infoRow(t('dash.detail.sector'), co.sector))
    if (co.size) box.appendChild(infoRow(t('dash.detail.size'), co.size))
    if (typeof co.glassdoor_rating === 'number') box.appendChild(infoRow('Glassdoor', `${co.glassdoor_rating}/5`))
    if (co.red_flags) box.appendChild(infoRow(t('dash.detail.redFlags'), co.red_flags))
    d.appendChild(box)
  }

  // Candidatura collegata (se esiste): stato + voto critico + risposta
  const ap = data.application
  if (ap && (ap.status || typeof ap.critic_score === 'number' || ap.response)) {
    const box = el('div', 'dash-detail__rows')
    box.appendChild(el('div', 'dash-detail__label', t('dash.detail.application')))
    if (ap.status) box.appendChild(infoRow(t('dash.detail.status'), ap.status))
    if (ap.critic_verdict) box.appendChild(infoRow(t('dash.detail.critic'), ap.critic_verdict))
    if (typeof ap.critic_score === 'number') box.appendChild(infoRow(t('dash.detail.criticScore'), `${ap.critic_score}/10`))
    if (ap.response) box.appendChild(infoRow(t('dash.detail.response'), ap.response))
    d.appendChild(box)
  }

  if (p.jd_text) {
    const desc = el('div', 'dash-detail__desc')
    desc.appendChild(el('div', 'dash-detail__label', t('dash.detail.description')))
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
  setOffersEmpty(t('dash.loading'))
  try {
    // facets = lista COMPLETA leggera di tutte le offerte (id/title/company/
    // role_family/score/loc/status), ideale per lista + filtri client.
    const res = await apiGet('/api/positions/facets')
    _offers = Array.isArray(res) ? res : (Array.isArray(res?.facets) ? res.facets : [])
    if (_offers.length === 0) {
      setOffersEmpty(t('dash.offers.empty'))
      return
    }
    wireFilters()
    renderOffers()
    _log.info('offers.ok', { count: _offers.length })
  } catch (e) {
    setOffersEmpty(e?.code === 'no-channel'
      ? t('dash.error.noChannel')
      : t('dash.error.unreachable'))
  }
}

// ───────────────────────── Statistiche ─────────────────────────

// Le label sono CHIAVI i18n: tradotte al render con t(), non a import-time,
// così il cambio lingua si riflette al render successivo.
const STAT_CARDS = [
  ['total', 'dash.stats.total'], ['new', 'dash.stats.new'], ['checked', 'dash.stats.checked'], ['scored', 'dash.stats.scored'],
  ['writing', 'dash.stats.writing'], ['review', 'dash.stats.review'], ['ready', 'dash.stats.ready'],
  ['applied', 'dash.stats.applied'], ['response', 'dash.stats.response'], ['excluded', 'dash.stats.excluded'],
]

const PIPELINE = [
  ['new', 'dash.stats.new'], ['checked', 'dash.stats.checked'], ['scored', 'dash.stats.scored'],
  ['writing', 'dash.stats.writing'], ['review', 'dash.stats.review'], ['ready', 'dash.stats.ready'],
  ['applied', 'dash.stats.applied'], ['response', 'dash.stats.response'],
]

export function loadStats() {
  return renderInto('dash-stats', async () => {
    const s = await apiGet('/api/dashboard/stats')
    const wrap = el('div', 'dash-statswrap')

    // Card riepilogo
    const grid = el('div', 'dash-stats__grid')
    for (const [key, labelKey] of STAT_CARDS) {
      const card = el('div', 'dash-stat')
      card.appendChild(el('div', 'dash-stat__num', typeof s?.[key] === 'number' ? s[key] : 0))
      card.appendChild(el('div', 'dash-stat__label', t(labelKey)))
      grid.appendChild(card)
    }
    wrap.appendChild(grid)

    // Pipeline a barre (largezza ∝ conteggio): funnel del flusso di lavoro
    const counts = PIPELINE.map(([k]) => (typeof s?.[k] === 'number' ? s[k] : 0))
    const max = Math.max(1, ...counts)
    const pipe = el('div', 'dash-pipeline')
    pipe.appendChild(el('div', 'dash-detail__label', t('dash.stats.pipeline')))
    PIPELINE.forEach(([key, labelKey], i) => {
      const row = el('div', 'dash-pipeline__row')
      row.appendChild(el('span', 'dash-pipeline__label', t(labelKey)))
      const track = el('div', 'dash-pipeline__track')
      const bar = el('div', 'dash-pipeline__bar')
      bar.style.width = `${Math.round((counts[i] / max) * 100)}%`
      track.appendChild(bar)
      row.appendChild(track)
      row.appendChild(el('span', 'dash-pipeline__num', counts[i]))
      pipe.appendChild(row)
    })
    wrap.appendChild(pipe)

    // Distribuzione score (da facets): quante offerte per banda di punteggio.
    try {
      const facets = await apiGet('/api/positions/facets')
      const arr = Array.isArray(facets) ? facets : (Array.isArray(facets?.facets) ? facets.facets : [])
      if (arr.length) {
        const bands = [
          ['90–100', (v) => v >= 90], ['75–89', (v) => v >= 75 && v < 90],
          ['50–74', (v) => v >= 50 && v < 75], ['25–49', (v) => v >= 25 && v < 50],
          ['0–24', (v) => v >= 0 && v < 25],
        ]
        const counts = bands.map(([, fn]) => arr.filter((p) => typeof p.score === 'number' && fn(p.score)).length)
        const unscored = arr.filter((p) => typeof p.score !== 'number').length
        const labels = [...bands.map(([l]) => l), t('dash.stats.unscored')]
        const vals = [...counts, unscored]
        const max = Math.max(1, ...vals)
        const dist = el('div', 'dash-pipeline')
        dist.appendChild(el('div', 'dash-detail__label', t('dash.stats.scoreDistribution')))
        labels.forEach((label, i) => {
          const row = el('div', 'dash-pipeline__row')
          row.appendChild(el('span', 'dash-pipeline__label', label))
          const track = el('div', 'dash-pipeline__track')
          const bar = el('div', 'dash-pipeline__bar')
          bar.style.width = `${Math.round((vals[i] / max) * 100)}%`
          track.appendChild(bar)
          row.appendChild(track)
          row.appendChild(el('span', 'dash-pipeline__num', vals[i]))
          dist.appendChild(row)
        })
        wrap.appendChild(dist)
      }
    } catch { /* facets non disponibili: salta la distribuzione */ }

    return wrap
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
    for (const [k, labelKey] of [['draft', 'dash.apps.draft'], ['sent', 'dash.apps.sent'], ['viewed', 'dash.apps.viewed'], ['interview', 'dash.apps.interview'], ['offer', 'dash.apps.offer'], ['rejected', 'dash.apps.rejected']]) {
      const chip = el('div', 'dash-apps__count')
      chip.appendChild(el('span', 'dash-apps__count-num', counts[k] ?? 0))
      chip.appendChild(el('span', 'dash-apps__count-label', t(labelKey)))
      countRow.appendChild(chip)
    }
    wrap.appendChild(countRow)
    if (apps.length === 0) { wrap.appendChild(el('p', 'home__subtitle', t('dash.apps.empty'))); return wrap }
    const list = el('div', 'dash__list')
    for (const a of apps) {
      const card = el('div', 'dash-card')
      const main = el('div', 'dash-card__main')
      main.appendChild(el('div', 'dash-card__title', a.position_title || a.position_id || '—'))
      const meta = el('div', 'dash-card__meta')
      meta.appendChild(el('span', null, t('dash.apps.status', { status: a.status || '—' })))
      if (a.applied_at) meta.appendChild(el('span', null, t('dash.apps.sentOn', { date: fmtDate(a.applied_at) })))
      if (a.response) meta.appendChild(el('span', null, t('dash.apps.responseReceived')))
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
    if (arr.length === 0) return emptyBox(t('dash.map.empty'))
    const byPlace = new Map()
    for (const c of arr) {
      const key = c.is_remote ? t('dash.location.remote') : (c.loc_city || c.loc_country || c.location || t('dash.map.other'))
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
      main.appendChild(el('div', 'dash-card__meta', t('dash.map.offersCount', { count: g.count })))
      const side = el('div', 'dash-card__side')
      if (g.best != null) side.appendChild(el('div', `dash-score ${scoreClass(g.best)}`, g.best))
      card.append(main, side)
      list.appendChild(card)
    }
    return list
  })
}

// ───────────────────────── Profilo ─────────────────────────

function assistantButton(label) {
  const b = el('button', 'btn btn--primary dash-profile__assistant', label)
  b.type = 'button'
  b.addEventListener('click', () => {
    const nav = document.querySelector('.home__nav-item[data-section="chat"]')
    if (nav) nav.click()
    // Seleziona il tab Assistente nella chat appena aperta.
    setTimeout(() => {
      const tab = document.querySelector('.chat-tab[data-agent="assistente"]')
      if (tab) tab.click()
    }, 60)
  })
  return b
}

export function loadProfile() {
  return renderInto('dash-profile', async () => {
    const res = await apiGet('/api/profile')
    const p = res?.profile || null
    if (!p || (!p.name && !p.target_role)) {
      const box = emptyBox(t('dash.profile.notConfigured'))
      box.appendChild(assistantButton(t('dash.profile.buildWithAssistant')))
      return box
    }
    const wrap = el('div', 'dash-profile')
    wrap.appendChild(assistantButton(t('dash.profile.editWithAssistant')))
    const head = el('div', 'dash-detail__head')
    head.appendChild(el('h2', 'dash-detail__title', p.name || '—'))
    wrap.appendChild(head)
    if (p.target_role) wrap.appendChild(el('p', 'home__subtitle', p.target_role))

    const rows = el('div', 'dash-detail__rows')
    const exp = [p.experience_years ? t('dash.profile.years', { n: p.experience_years }) : null, p.experience_months ? t('dash.profile.months', { n: p.experience_months }) : null].filter(Boolean).join(' ')
    if (p.email) rows.appendChild(infoRow(t('dash.profile.email'), p.email))
    if (p.location) rows.appendChild(infoRow(t('dash.detail.location'), p.location))
    if (exp) rows.appendChild(infoRow(t('dash.profile.experience'), exp))
    rows.appendChild(infoRow(t('dash.profile.degree'), p.has_degree ? t('dash.common.yes') : t('dash.common.no')))
    if (Array.isArray(p.job_titles) && p.job_titles.length) rows.appendChild(infoRow(t('dash.profile.roles'), p.job_titles.join(', ')))
    if (Array.isArray(p.languages) && p.languages.length) {
      rows.appendChild(infoRow(t('dash.profile.languages'), p.languages.map((l) => l.name || l.language || l).join(', ')))
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

// ───────────────────────── Notifiche ─────────────────────────

const NOTIF_ICON = { info: 'ℹ️', warning: '⚠️', success: '✅', error: '⛔' }

export function loadNotifications() {
  return renderInto('dash-notifs', async () => {
    const res = await apiGet('/api/notifications')
    const items = Array.isArray(res?.notifications) ? res.notifications : (Array.isArray(res) ? res : [])
    if (items.length === 0) return emptyBox(t('dash.notifs.empty'))
    const list = el('div', 'dash__list')
    for (const n of items) {
      const row = el('div', `dash-notif ${n.read ? 'is-read' : ''}`)
      row.appendChild(el('span', 'dash-notif__icon', NOTIF_ICON[n.type] || 'ℹ️'))
      const main = el('div', 'dash-notif__main')
      main.appendChild(el('div', 'dash-notif__title', n.title || '—'))
      if (n.body) main.appendChild(el('div', 'dash-card__meta', n.body))
      row.appendChild(main)
      list.appendChild(row)
    }
    return list
  })
}

// ───────────────────────── Orari di lavoro ─────────────────────────

// Valori = chiavi i18n, tradotte al render con t().
const WH_LABELS = {
  enabled: 'dash.hours.enabled', start: 'dash.hours.start', end: 'dash.hours.end', timezone: 'dash.hours.timezone',
  tz: 'dash.hours.timezone', days: 'dash.hours.days', start_hour: 'dash.hours.startHour', end_hour: 'dash.hours.endHour',
}

export function loadWorkingHours() {
  return renderInto('dash-hours', async () => {
    const res = await apiGet('/api/team/working-hours')
    const wh = res?.working_hours || res || {}
    const wrap = el('div', 'dash-profile')
    // Stato corrente (preview): il team sta lavorando ora?
    const pv = res?.preview
    if (pv) {
      const active = pv.working === true || pv.active === true || pv.is_working === true || pv.in_hours === true
      const badge = el('div', 'dash-hours__status')
      const dot = el('span', 'home__status-dot'); dot.dataset.state = active ? 'running' : 'stopped'
      badge.append(dot, el('span', null, active ? t('dash.hours.inHours') : t('dash.hours.outOfHours')))
      wrap.appendChild(badge)
    }
    const rows = el('div', 'dash-detail__rows')
    let any = false
    for (const [k, v] of Object.entries(wh)) {
      if (v == null || typeof v === 'object') continue
      const label = WH_LABELS[k] ? t(WH_LABELS[k]) : k
      const val = typeof v === 'boolean' ? (v ? t('dash.common.yes') : t('dash.common.no')) : String(v)
      rows.appendChild(infoRow(label, val)); any = true
    }
    if (Array.isArray(wh.days) && wh.days.length) { rows.appendChild(infoRow(t('dash.hours.days'), wh.days.join(', '))); any = true }
    if (!any) return emptyBox(t('dash.hours.empty'))
    wrap.appendChild(rows)
    return wrap
  })
}

// ───────────────────────── Agenti ─────────────────────────

// Titoli = chiavi i18n, tradotte al render con t().
const AGENT_GROUPS = [
  ['dash.agents.groupCore', ['capitano', 'sentinella', 'assistente', 'mentor', 'dottore']],
  ['dash.agents.groupPipeline', ['scout', 'analista', 'scorer', 'scrittore', 'critico']],
]

export function loadAgents() {
  return renderInto('dash-agents', async () => {
    const res = await apiGet('/api/agents')
    const agents = Array.isArray(res) ? res : (Array.isArray(res?.agents) ? res.agents : [])
    if (agents.length === 0) return emptyBox(t('dash.agents.empty'))
    const idOf = (a) => String(a.id || a.role || a.name || '').toLowerCase()
    const isRunning = (a) => a.running === true || a.status === 'running' || a.active === true
    const renderRow = (a) => {
      const row = el('div', 'dash-agent')
      const left = el('div', 'dash-agent__main')
      const dot = el('span', 'home__status-dot'); dot.dataset.state = isRunning(a) ? 'running' : 'stopped'
      left.append(dot, el('span', 'dash-agent__name', a.name || a.role || a.id || '—'))
      row.appendChild(left)
      const right = el('div', 'dash-agent__actions')
      right.appendChild(el('span', 'dash-card__date', isRunning(a) ? t('dash.agents.active') : t('dash.agents.stopped')))
      // Controlli per-agente: Ferma (se attivo) / Riavvia. Via agentApi →
      // docker exec tmux kill-session / start-agent.sh nel container.
      const role = idOf(a)
      if (window.agentApi && role) {
        const mkBtn = (label, fn) => {
          const b = el('button', 'btn btn--ghost btn--small', label)
          b.addEventListener('click', async (e) => {
            e.stopPropagation()
            b.disabled = true; b.textContent = '…'
            try { await fn(role) } catch { /* lo stato reale lo mostra il refresh */ }
            loadAgents()
          })
          return b
        }
        if (isRunning(a)) right.appendChild(mkBtn(t('dash.agents.stop'), (r) => window.agentApi.stop(r)))
        right.appendChild(mkBtn(t('dash.agents.restart'), (r) => window.agentApi.restart(r)))
      }
      row.appendChild(right)
      return row
    }
    const wrap = el('div', 'dash-agents')
    const placed = new Set()
    for (const [titleKey, ids] of AGENT_GROUPS) {
      const inGroup = agents.filter((a) => ids.some((id) => idOf(a).startsWith(id)))
      if (inGroup.length === 0) continue
      const grp = el('div', 'dash-agentgroup')
      grp.appendChild(el('div', 'dash-detail__label', t(titleKey)))
      const list = el('div', 'dash__list')
      for (const a of inGroup) { list.appendChild(renderRow(a)); placed.add(idOf(a)) }
      grp.appendChild(list)
      wrap.appendChild(grp)
    }
    // Eventuali agenti non categorizzati
    const rest = agents.filter((a) => !placed.has(idOf(a)))
    if (rest.length) {
      const grp = el('div', 'dash-agentgroup')
      grp.appendChild(el('div', 'dash-detail__label', t('dash.agents.groupOther')))
      const list = el('div', 'dash__list')
      for (const a of rest) list.appendChild(renderRow(a))
      grp.appendChild(list)
      wrap.appendChild(grp)
    }
    return wrap
  })
}

// ───────────────────────── Attività ─────────────────────────

export function loadActivity() {
  return renderInto('dash-activity', async () => {
    const data = await apiGet('/api/positions/state-history')
    const arr = Array.isArray(data) ? data : (Array.isArray(data?.transitions) ? data.transitions : [])
    if (arr.length === 0) return emptyBox(t('dash.activity.empty'))
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
