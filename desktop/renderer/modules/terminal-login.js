import { state, dom, showStep } from './state.js'
import { t } from './i18n.js'
import { STEP_PROVIDER_CHOOSE, STEP_READY, PROVIDER_OPTIONS } from './constants.js'
import { camelId } from './docker-card.js'
import { enterReady } from './wizard-flow.js'

// -------- Step: provider login (tmux/subscription auth) --------

dom.btnLoginBack.addEventListener('click', () => {
  // Bounce-back per tre origini possibili:
  //   1. STEP_READY  → utente in setup wizard ha cliccato "Manage login"
  //   2. 'home'      → utente in home ha cliccato "Cambia provider" o
  //                    "Provider login": back deve riportare alla home,
  //                    NON al wizard di setup (era il bug "loop wizard").
  //   3. default     → flusso wizard normale, torna a provider-choose.
  if (state.loginOrigin === STEP_READY) {
    state.loginOrigin = null
    enterReady()
  } else if (state.loginOrigin === 'home') {
    state.loginOrigin = null
    showHome('team')
  } else {
    showStep(STEP_PROVIDER_CHOOSE)
  }
})
dom.btnLoginContinue.addEventListener('click', () => {
  if (dom.btnLoginContinue.disabled) return
  // Stesso discriminatore del back: se siamo arrivati dalla home,
  // continue ritorna alla home (provider/auth gia' applicati al
  // jht.config.json dal flow di login). Niente STEP_READY/startTeam:
  // quello e' il flow di primo setup, non un cambio provider runtime.
  if (state.loginOrigin === 'home') {
    state.loginOrigin = null
    showHome('team')
    return
  }
  state.loginOrigin = null
  enterReady()
})

if (dom.btnReadyManageLogin) {
  dom.btnReadyManageLogin.addEventListener('click', () => {
    state.loginOrigin = STEP_READY
    enterProviderLogin()
  })
}

function providerNeedsLoginContinue() {
  const anyUnauthed = state.authStates.some((a) => !a.authed)
  dom.btnLoginContinue.disabled = anyUnauthed
}

export async function enterProviderLogin() {
  showStep(STEP_PROVIDER_LOGIN)
  await refreshAuthList()
}

export async function refreshAuthList() {
  try {
    const res = await window.setupApi.getAuthStates()
    state.authStates = Array.isArray(res?.auth) ? res.auth : []
  } catch {
    state.authStates = []
  }
  renderAuthList()
  providerNeedsLoginContinue()
}

function renderAuthList() {
  const list = dom.authList
  list.innerHTML = ''
  for (const entry of state.authStates) {
    const opt = PROVIDER_OPTIONS.find((p) => p.id === entry.id)
    if (!opt) continue

    const card = document.createElement('div')
    card.className = `dep-card dep-card--compact ${entry.authed ? 'dep-card--ok' : 'dep-card--warn'}`

    const header = document.createElement('div')
    header.className = 'dep-card__header'

    const name = document.createElement('span')
    name.className = 'dep-card__name'
    name.textContent = opt.label

    const badge = document.createElement('span')
    badge.className = 'dep-card__badge'
    badge.textContent = entry.authed ? t('login.status.signedIn') : t('login.status.notSignedIn')

    header.appendChild(name)
    header.appendChild(badge)
    card.appendChild(header)

    if (!entry.authed) {
      // Provider-specific hint: Codex's loopback OAuth doesn't work
      // through the container, steer the user to the device-code flow.
      const hintKey = `login.hint.${camelId(entry.id)}`
      const hintText = t(hintKey)
      if (hintText && hintText !== hintKey) {
        const hint = document.createElement('p')
        hint.className = 'dep-card__hint'
        hint.textContent = hintText
        card.appendChild(hint)
      }

      const actions = document.createElement('div')
      actions.className = 'dep-card__actions'

      const btnOpen = document.createElement('button')
      btnOpen.className = 'btn btn--primary'
      btnOpen.textContent = t('login.action.open')
      btnOpen.addEventListener('click', () => openLoginTerminal(entry.id, opt.label))
      actions.appendChild(btnOpen)

      const btnRecheck = document.createElement('button')
      btnRecheck.className = 'btn btn--ghost'
      btnRecheck.textContent = t('login.action.recheck')
      btnRecheck.addEventListener('click', refreshAuthList)
      actions.appendChild(btnRecheck)

      card.appendChild(actions)
    } else {
      // Signed-in state: let the user log out / switch account. Wipes
      // the CLI's credential files on the host bind-mount; the next
      // login flow re-populates them from scratch.
      const actions = document.createElement('div')
      actions.className = 'dep-card__actions'

      // Even when we detect the user as authenticated, keep the
      // terminal door open — Kimi needs /login inside the TUI even
      // after the auth file exists (partial session), and users
      // may want to re-run /login to switch account or troubleshoot.
      const btnOpen = document.createElement('button')
      btnOpen.className = 'btn btn--ghost'
      btnOpen.textContent = t('login.action.openWhenAuthed')
      btnOpen.addEventListener('click', () => openLoginTerminal(entry.id, opt.label))
      actions.appendChild(btnOpen)

      const btnLogout = document.createElement('button')
      btnLogout.className = 'btn btn--ghost'
      btnLogout.textContent = t('login.action.logout')
      btnLogout.addEventListener('click', async () => {
        btnLogout.disabled = true
        try {
          await window.setupApi.logoutProvider(entry.id)
        } finally {
          btnLogout.disabled = false
          await refreshAuthList()
        }
      })
      actions.appendChild(btnLogout)

      card.appendChild(actions)
    }
    list.appendChild(card)
  }
}

// -------- Terminal modal (xterm + node-pty via IPC) --------

let activeTerminal = null
let activeFit = null
let activeSessionId = null
let activeUnsubData = null
let activeUnsubExit = null
let activeResizeObserver = null
let activeLastUrl = null
let activeUrlDebounceTimer = null
// Raw unfiltered pty stream (ANSI stripped) — ground truth for URL
// detection. xterm's rendered buffer sometimes chops long URLs when the
// TUI uses cursor-positioning escape sequences; the raw stream has
// whatever the CLI actually wrote, wrap-free.
let activeRawStream = ''
const URL_STABILIZE_MS = 700
const RAW_STREAM_MAX = 80 * 1024

const TERMINAL_URL_RE = /https?:\/\/[^\s"'<>`]+/g
// Strip ANSI CSI (color/cursor) sequences before URL extraction.
const ANSI_CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

function updateUrlButtons() {
  const visible = !!activeLastUrl
  dom.btnTerminalOpenUrl.hidden = !visible
  dom.btnTerminalCopyUrl.hidden = !visible
}

// Walk xterm's active buffer joining wrapped continuations seamlessly,
// so a URL that spans multiple rendered rows is a single string.
function collectBufferText(term) {
  const buf = term.buffer.active
  const parts = []
  let current = ''
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped) {
      current += text
    } else {
      if (current) parts.push(current)
      current = text
    }
  }
  if (current) parts.push(current)
  return parts.join('\n')
}

function extractLongestUrl(text) {
  const matches = text.match(TERMINAL_URL_RE)
  if (!matches || matches.length === 0) return null
  let best = matches[0]
  for (const m of matches) if (m.length > best.length) best = m
  return best.replace(/[.,:;)\]}>]+$/, '')
}

// Pane-capture style URL extraction, mirroring what a user would do
// reading the terminal screen: dump every visible row as flat text,
// find the row that contains "https://", scan forward until the row
// that starts the CLI's prompt ("Paste code here if prompted"), then
// glue all those rows together dropping every whitespace character.
// Works regardless of xterm soft-wrap flags, cursor repositioning,
// or ANSI frames — whatever is on the screen is what we capture.
const URL_END_MARKER_RE = /paste\s+(the\s+)?code\s+(here|below)|paste\s+code\b|^\s*>\s*$/i

function extractUrlViaPaneCapture(term) {
  if (!term || !term.buffer || !term.buffer.active) return null
  const buf = term.buffer.active
  const rows = []
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    rows.push(line.translateToString(true))
  }
  let startIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (/https?:\/\//i.test(rows[i])) { startIdx = i; break }
  }
  if (startIdx < 0) return null

  let endIdx = rows.length
  for (let i = startIdx; i < rows.length; i++) {
    // Skip the very first row — it carries the scheme itself and
    // would false-match if the CLI wrote hints on the same line.
    if (i === startIdx) continue
    if (URL_END_MARKER_RE.test(rows[i])) { endIdx = i; break }
  }

  // Join without separators and strip every whitespace run. URLs never
  // contain whitespace, so collapsing is safe; soft-wrap artefacts
  // (padding spaces, leading indents) disappear.
  const joined = rows.slice(startIdx, endIdx).join('').replace(/\s+/g, '')
  const m = joined.match(/https?:\/\/[^\s"'<>`]+/i)
  if (!m) return null
  return m[0].replace(/[.,:;)\]}>]+$/, '')
}

async function openLoginTerminal(providerId, displayName) {
  const Terminal = window.Terminal
  const FitAddon = window.FitAddon && window.FitAddon.FitAddon
  if (!Terminal || !FitAddon) {
    console.error('xterm not loaded')
    return
  }
  activeLastUrl = null
  activeRawStream = ''
  updateUrlButtons()

  dom.terminalModalTitle.textContent = t('login.terminalTitle', { name: displayName })
  dom.terminalModal.hidden = false

  // Reset any previous instance.
  dom.terminalModalBody.innerHTML = ''

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    theme: {
      background: '#0e0e10',
      foreground: '#f5f5f7',
    },
    convertEol: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(dom.terminalModalBody)
  fit.fit()

  // Custom link provider: xterm's stock web-links addon only matches
  // URLs within a single rendered row, so long wrapped URLs become
  // unusable fragments. This provider uses the raw-stream URL we've
  // already tracked (activeLastUrl) and registers every line that
  // contains any part of it — click anywhere in the visible URL and
  // shell.openExternal is called with the full, intact URL.
  term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const links = []
      const line = term.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) return callback(links)
      const text = line.translateToString(true)

      const openFull = (url) => () => {
        window.launcherApi.openExternal(url).catch(() => {})
      }

      // URL begins on this line — take the intra-line match, but if we
      // have a tracked URL that starts with it, prefer the tracked one.
      const startRe = /https?:\/\/\S+/g
      let m
      while ((m = startRe.exec(text)) !== null) {
        const hit = m[0].replace(/[.,:;)\]}>]+$/, '')
        const full = activeLastUrl && activeLastUrl.startsWith(hit) ? activeLastUrl : hit
        links.push({
          range: {
            start: { x: m.index + 1, y: bufferLineNumber },
            end: { x: m.index + m[0].length, y: bufferLineNumber },
          },
          text: full,
          activate: openFull(full),
        })
      }

      // Wrapped continuation: no scheme on this line, but it holds a
      // substring of the tracked URL. Make the whole non-whitespace
      // run on the line clickable, pointing at the full URL.
      if (links.length === 0 && activeLastUrl) {
        const stride = 20
        for (let i = 0; i + stride <= activeLastUrl.length; i += 10) {
          const seg = activeLastUrl.slice(i, i + stride)
          const idx = text.indexOf(seg)
          if (idx < 0) continue
          let sx = idx
          let ex = idx + seg.length
          while (sx > 0 && /\S/.test(text[sx - 1])) sx--
          while (ex < text.length && /\S/.test(text[ex])) ex++
          links.push({
            range: {
              start: { x: sx + 1, y: bufferLineNumber },
              end: { x: ex, y: bufferLineNumber },
            },
            text: activeLastUrl,
            activate: openFull(activeLastUrl),
          })
          break
        }
      }
      callback(links)
    },
  })

  // Intercept bare 'c' before it reaches the pty: the CLI inside the
  // container has no access to the Windows clipboard, so its "link
  // copied" message is a lie. We do the real copy on the host side
  // and still forward the key so the CLI's UI feedback stays.
  term.attachCustomKeyEventHandler((event) => {
    if (
      event.type === 'keydown' &&
      event.key === 'c' &&
      !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
      activeLastUrl
    ) {
      window.clipboardApi.write(activeLastUrl).catch(() => {})
    }
    return true
  })

  // Right-click: copy the current xterm selection to the host clipboard
  // (reliable manual fallback if auto-open / click-to-open misbehaves);
  // if nothing is selected, paste from the clipboard into the pty.
  dom.terminalModalBody.addEventListener('contextmenu', async (event) => {
    event.preventDefault()
    const selection = term.getSelection()
    if (selection && selection.length > 0) {
      try { await window.clipboardApi.write(selection) } catch { /* ignore */ }
      term.clearSelection()
      return
    }
    try {
      const text = await window.clipboardApi.read()
      if (text && activeSessionId) window.terminalApi.write(activeSessionId, text)
    } catch { /* ignore */ }
  })

  let result
  try {
    result = await window.terminalApi.start({ providerId })
  } catch (error) {
    term.writeln(`\r\n[error] ${error && error.message ? error.message : error}`)
    return
  }
  if (!result?.ok) {
    term.writeln(`\r\n[error] ${result?.error || 'failed to start'}`)
    return
  }

  activeTerminal = term
  activeFit = fit
  activeSessionId = result.sessionId

  activeUnsubData = window.terminalApi.onData(activeSessionId, (data) => {
    // Accumulate the raw pty stream too, independent of xterm rendering.
    // URL detection on the raw stream is bulletproof against wrap/chop
    // issues caused by cursor-positioning escape sequences.
    activeRawStream += data
    if (activeRawStream.length > RAW_STREAM_MAX) {
      activeRawStream = activeRawStream.slice(-RAW_STREAM_MAX / 2)
    }
    term.write(data, () => {
      // Prefer the raw stream (ANSI stripped) — falls back to xterm's
      // reassembled buffer only if the raw scan misses.
      const rawText = activeRawStream.replace(ANSI_CSI_RE, '')
      const url =
        extractLongestUrl(rawText) ||
        extractLongestUrl(collectBufferText(term))
      if (url && url.length >= 12 && url !== activeLastUrl) {
        activeLastUrl = url
        updateUrlButtons()
      }
      // Debounced refresh of the cached URL (keeps the Open URL button
      // enabled with the latest detection). We deliberately do NOT
      // auto-open the browser here: Ink-based TUIs render the URL
      // progressively, and an early catch can open a truncated URL.
      // The Open URL button re-extracts from the pane on click, which
      // is the only reliable path — let the user drive it.
      if (activeUrlDebounceTimer) clearTimeout(activeUrlDebounceTimer)
      activeUrlDebounceTimer = setTimeout(() => {
        const latest =
          (activeTerminal && extractUrlViaPaneCapture(activeTerminal)) ||
          extractLongestUrl(activeRawStream.replace(ANSI_CSI_RE, '')) ||
          extractLongestUrl(collectBufferText(term))
        if (latest && latest.length >= 12 && latest !== activeLastUrl) {
          activeLastUrl = latest
          updateUrlButtons()
        }
      }, URL_STABILIZE_MS)
    })
  })
  activeUnsubExit = window.terminalApi.onExit(activeSessionId, (exit) => {
    const code = exit && typeof exit.exitCode === 'number' ? exit.exitCode : '?'
    term.writeln(`\r\n\x1b[90m[session closed — exit ${code}]\x1b[0m`)
    // Don't auto-close on non-zero exit so the user can read any error;
    // they must press the ✕ button. Re-check auth in the background.
    activeSessionId = null
    refreshAuthList()
  })

  term.onData((data) => window.terminalApi.write(activeSessionId, data))
  term.onResize(({ cols, rows }) => {
    if (activeSessionId) window.terminalApi.resize(activeSessionId, cols, rows)
  })

  activeResizeObserver = new ResizeObserver(() => {
    try { fit.fit() } catch { /* noop */ }
  })
  activeResizeObserver.observe(dom.terminalModalBody)
}

export function closeTerminalModal({ skipKill = false } = {}) {
  if (activeResizeObserver) {
    activeResizeObserver.disconnect()
    activeResizeObserver = null
  }
  if (activeUnsubData) { activeUnsubData(); activeUnsubData = null }
  if (activeUnsubExit) { activeUnsubExit(); activeUnsubExit = null }
  if (activeSessionId && !skipKill) {
    window.terminalApi.kill(activeSessionId).catch(() => {})
  }
  activeSessionId = null
  if (activeTerminal) {
    try { activeTerminal.dispose() } catch { /* noop */ }
    activeTerminal = null
  }
  activeFit = null
  activeLastUrl = null
  activeRawStream = ''
  if (activeUrlDebounceTimer) {
    clearTimeout(activeUrlDebounceTimer)
    activeUrlDebounceTimer = null
  }
  updateUrlButtons()
  dom.terminalModalBody.innerHTML = ''
  dom.terminalModal.hidden = true
}

dom.btnTerminalClose.addEventListener('click', () => {
  closeTerminalModal()
  refreshAuthList()
})

dom.btnTerminalDone.addEventListener('click', () => {
  closeTerminalModal()
  refreshAuthList()
})

dom.btnTerminalPaste.addEventListener('click', async () => {
  if (!activeSessionId) return
  try {
    const text = await window.clipboardApi.read()
    if (text) window.terminalApi.write(activeSessionId, text)
  } catch { /* ignore */ }
})

function freshUrlFromBuffer() {
  // 1) Pane-capture of the visible terminal screen — the authoritative
  //    source because it is exactly what the user sees. Glues rows
  //    together dropping whitespace; uses the "Paste code here"-style
  //    row as the end marker, so nothing past the URL leaks in.
  if (activeTerminal) {
    const fromPane = extractUrlViaPaneCapture(activeTerminal)
    if (fromPane) return fromPane
  }
  // 2) Raw pty stream (ANSI stripped) — helps when the URL has scrolled
  //    off-screen.
  const rawUrl = activeRawStream
    ? extractLongestUrl(activeRawStream.replace(ANSI_CSI_RE, ''))
    : null
  if (rawUrl) return rawUrl
  // 3) Fall back to the cached value if nothing is live.
  if (!activeTerminal) return activeLastUrl
  return extractLongestUrl(collectBufferText(activeTerminal)) || activeLastUrl
}

dom.btnTerminalOpenUrl.addEventListener('click', () => {
  const url = freshUrlFromBuffer()
  if (url) window.launcherApi.openExternal(url).catch(() => {})
})

dom.btnTerminalCopyUrl.addEventListener('click', () => {
  const url = freshUrlFromBuffer()
  if (url) window.clipboardApi.write(url).catch(() => {})
})

