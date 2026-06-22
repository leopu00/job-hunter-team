// [JHT-DASHBOARD-NATIVE] Chat NATIVA con gli agenti (Capitano / Assistente).
// GET history via window.dashboardApi.get('/api/<agent>/chat?after=<ts>');
// invio via window.dashboardApi.post('/api/<agent>/chat', {text}) (lane dev3).
// Polling incrementale col cursore `after` = ts dell'ultimo messaggio visto.

const _log = (typeof window !== 'undefined' && window.jhtLog && window.jhtLog.scope)
  ? window.jhtLog.scope('dash-chat')
  : { debug() {}, info() {}, warn() {}, error() {} }

const state = { agent: 'capitano', lastTs: 0, timer: null, sending: false }

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = String(text)
  return n
}

function msgsEl() { return document.getElementById('chat-messages') }

// Mini-markdown safe: **bold**, *italic*, `code`. Niente HTML raw (textContent).
function renderText(container, text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  for (const p of parts) {
    if (/^\*\*[^*]+\*\*$/.test(p)) container.appendChild(el('strong', null, p.slice(2, -2)))
    else if (/^\*[^*]+\*$/.test(p)) container.appendChild(el('em', null, p.slice(1, -1)))
    else if (/^`[^`]+`$/.test(p)) container.appendChild(el('code', null, p.slice(1, -1)))
    else if (p) container.appendChild(document.createTextNode(p))
  }
}

function appendMessages(messages) {
  const box = msgsEl()
  if (!box) return
  let added = false
  for (const m of messages) {
    if (typeof m.ts === 'number' && m.ts <= state.lastTs) continue
    const role = m.role === 'user' ? 'user' : 'agent'
    const row = el('div', `chat-msg chat-msg--${role}`)
    const bubble = el('div', 'chat-bubble')
    renderText(bubble, m.text || '')
    row.appendChild(bubble)
    box.appendChild(row)
    if (typeof m.ts === 'number' && m.ts > state.lastTs) state.lastTs = m.ts
    added = true
  }
  if (added) box.scrollTop = box.scrollHeight
}

async function poll() {
  if (!window.dashboardApi?.get) return
  try {
    const res = await window.dashboardApi.get(`/api/${state.agent}/chat?after=${state.lastTs}`)
    const messages = Array.isArray(res?.messages) ? res.messages : []
    if (messages.length) appendMessages(messages)
  } catch (e) { _log.warn('poll.failed', { err: String(e?.message || e) }) }
}

function startPoll() {
  stopPoll()
  state.timer = setInterval(poll, 3000)
}
export function stopChat() {
  stopPoll()
}
function stopPoll() {
  if (state.timer) { clearInterval(state.timer); state.timer = null }
}

async function switchAgent(agent) {
  if (agent === state.agent && msgsEl()?.childElementCount) return
  state.agent = agent
  state.lastTs = 0
  const box = msgsEl()
  if (box) box.innerHTML = ''
  // Tab attivo
  for (const b of document.querySelectorAll('.chat-tab')) {
    b.classList.toggle('is-active', b.dataset.agent === agent)
  }
  await poll()
  startPoll()
}

async function send() {
  const input = document.getElementById('chat-input')
  const btn = document.getElementById('chat-send')
  if (!input) return
  const text = input.value.trim()
  if (!text || state.sending) return
  if (!window.dashboardApi?.post) {
    appendMessages([{ role: 'agent', text: '⚠️ Invio non disponibile (canale dati in aggiornamento). Riprova tra poco.', ts: Date.now() / 1000 }])
    return
  }
  state.sending = true
  if (btn) btn.disabled = true
  input.value = ''
  // Echo ottimistico del messaggio utente (il poll poi lo riconcilia).
  appendMessages([{ role: 'user', text, ts: 0 }])
  try {
    await window.dashboardApi.post(`/api/${state.agent}/chat`, { text })
    await poll()
  } catch (e) {
    _log.error('send.failed', { err: String(e?.message || e) })
    appendMessages([{ role: 'agent', text: `⚠️ Invio fallito: ${e?.message || e}`, ts: Date.now() / 1000 }])
  } finally {
    state.sending = false
    if (btn) btn.disabled = false
    input.focus()
  }
}

let _wired = false
function wireOnce() {
  if (_wired) return
  _wired = true
  for (const b of document.querySelectorAll('.chat-tab')) {
    b.addEventListener('click', () => switchAgent(b.dataset.agent))
  }
  const btn = document.getElementById('chat-send')
  if (btn) btn.addEventListener('click', send)
  const input = document.getElementById('chat-input')
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    })
  }
}

export function loadChat() {
  wireOnce()
  switchAgent(state.agent)
}
