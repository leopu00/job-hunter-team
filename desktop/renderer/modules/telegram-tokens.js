// Wizard step: 3 Telegram bot tokens (Assistente, Capitano, Mentor).
//
// Active only in VPS mode (inserted between supabase-login and vps-
// provision). Each bot row drives 3 transitions:
//
//   idle → verifying → verified
//                    ↓
//                  failed (clear error, user retries)
//                    ↓
//   verified → waiting-chat → chat-captured
//                            ↓
//                          failed (timeout / cancelled)
//
// We don't fetch api.telegram.org from the renderer directly — the IPC
// proxy in main keeps the renderer thin and CSP-clean (see
// desktop/telegram/index.js).
//
// State machine, deep-link and auto-chat_id polling mirror the CLI
// wizard in cli/wizard/setup-steps.js so a user who has done it once on
// the CLI sees the same flow in the desktop launcher.

import { state, dom, showStep } from './state.js'
import { STEP_TELEGRAM_TOKENS } from './constants.js'

const log = (typeof window !== 'undefined' && window.jhtLog && window.jhtLog.scope)
  ? window.jhtLog.scope('telegram-tokens')
  : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const POLL_DEADLINE_MS = 15 * 60 * 1000

// Single source of truth for bot identity. The wizard never asks the
// user to invent role names; the order here is the order shown in the
// UI.
export const TELEGRAM_BOT_ROLES = [
  { key: 'assistente', label: 'Assistente', hint: 'profile onboarding + document drop-zone' },
  { key: 'capitano',   label: 'Capitano',   hint: 'team direction + ready-position notifications' },
  { key: 'mentor',     label: 'Mentor',     hint: 'growth coach + strategic positioning' },
]

// BotFather rate-limits consecutive /newbot calls (~2 min cooldown
// observed empirically — no public spec). When the user finishes
// verifying bot N, lock bot N+1 for this window so they can't even try
// to /newbot too fast and get a confusing BotFather refusal mid-flow.
// First bot (assistente) is never locked.
const TG_COOLDOWN_MS = 2 * 60 * 1000
const TG_NEXT_ROLE = { assistente: 'capitano', capitano: 'mentor', mentor: null }

function ensureState() {
  if (state.telegram && typeof state.telegram === 'object') return
  state.telegram = {}
  for (const role of TELEGRAM_BOT_ROLES) {
    state.telegram[role.key] = {
      token: '',
      botUsername: null,
      chatId: null,
      status: 'idle',
      error: null,
    }
  }
}

function getRow(roleKey) {
  return {
    root: document.getElementById(`tg-row-${roleKey}`),
    input: document.getElementById(`tg-input-${roleKey}`),
    verifyBtn: document.getElementById(`tg-verify-${roleKey}`),
    status: document.getElementById(`tg-status-${roleKey}`),
    deepLink: document.getElementById(`tg-deeplink-${roleKey}`),
  }
}

function setStatus(els, text, level) {
  if (!els.status) return
  if (!text) {
    els.status.hidden = true
    els.status.textContent = ''
    els.status.removeAttribute('data-level')
    return
  }
  els.status.hidden = false
  els.status.textContent = text
  if (level) els.status.setAttribute('data-level', level)
  else els.status.removeAttribute('data-level')
}

function setDeepLink(els, botUsername) {
  if (!els.deepLink) return
  if (!botUsername) {
    els.deepLink.hidden = true
    els.deepLink.removeAttribute('href')
    return
  }
  const url = `https://t.me/${botUsername}?start=jht`
  els.deepLink.href = url
  els.deepLink.textContent = `Open @${botUsername} and press Start`
  els.deepLink.hidden = false
}

function isLocked(roleKey) {
  const t = state.tgRateLimit?.[roleKey]
  return typeof t === 'number' && Date.now() < t
}

function lockCountdownText(roleKey) {
  const secs = Math.max(0, Math.ceil(((state.tgRateLimit?.[roleKey] || 0) - Date.now()) / 1000))
  const mm = Math.floor(secs / 60).toString().padStart(2, '0')
  const ss = (secs % 60).toString().padStart(2, '0')
  return `BotFather rate limit — available in ${mm}:${ss}`
}

function renderRow(roleKey) {
  const bot = state.telegram[roleKey]
  const els = getRow(roleKey)
  if (!els.root) return

  // Rate-limit lock takes precedence over the normal state machine —
  // user can't paste/verify until the cooldown for this slot expires.
  if (isLocked(roleKey)) {
    if (els.input) els.input.disabled = true
    els.verifyBtn.disabled = true
    els.verifyBtn.textContent = 'Verify'
    setStatus(els, lockCountdownText(roleKey), 'progress')
    setDeepLink(els, null)
    els.root.setAttribute('data-status', 'locked')
    return
  }
  if (els.input) els.input.disabled = false

  // Token field reflects state, but never trash a value the user is
  // still typing — only set when the bot status indicates we owe them
  // a re-render of the stored value.
  if (els.input && document.activeElement !== els.input) {
    els.input.value = bot.token || ''
  }

  els.root.setAttribute('data-status', bot.status)

  switch (bot.status) {
    case 'idle':
      els.verifyBtn.disabled = !bot.token || !bot.token.trim()
      els.verifyBtn.textContent = 'Verify'
      setStatus(els, '', null)
      setDeepLink(els, null)
      break
    case 'verifying':
      els.verifyBtn.disabled = true
      els.verifyBtn.textContent = 'Verifying…'
      setStatus(els, 'Calling Telegram /getMe…', 'progress')
      setDeepLink(els, null)
      break
    case 'verified':
    case 'waiting-chat':
      els.verifyBtn.disabled = true
      els.verifyBtn.textContent = `@${bot.botUsername}`
      setStatus(els, `Open the chat with @${bot.botUsername} and press Start — auto-detecting…`, 'progress')
      setDeepLink(els, bot.botUsername)
      break
    case 'chat-captured':
      els.verifyBtn.disabled = false
      els.verifyBtn.textContent = `Re-verify`
      setStatus(els, `✓ @${bot.botUsername} · chat_id ${bot.chatId}`, 'ok')
      setDeepLink(els, null)
      break
    case 'failed':
      els.verifyBtn.disabled = !bot.token || !bot.token.trim()
      els.verifyBtn.textContent = 'Retry'
      setStatus(els, bot.error || 'failed', 'error')
      setDeepLink(els, null)
      break
    default:
      els.verifyBtn.disabled = true
      setStatus(els, '', null)
      setDeepLink(els, null)
  }
}

function renderActions() {
  const btn = dom.btnTelegramContinue
  if (!btn) return
  const allOk = TELEGRAM_BOT_ROLES.every((r) =>
    state.telegram[r.key].status === 'chat-captured' && state.telegram[r.key].chatId,
  )
  btn.disabled = !allOk
}

function renderAll() {
  ensureState()
  for (const role of TELEGRAM_BOT_ROLES) renderRow(role.key)
  renderActions()
}

// Optional before-enter hook so wizard-flow.js can populate the new
// per-row meta slots (suggested name + suggested username + copy/regen)
// without telegram-tokens.js having to know about that UI. Avoids a
// circular import.
let beforeEnterHook = null
export function setTelegramTokensBeforeEnter(fn) {
  beforeEnterHook = typeof fn === 'function' ? fn : null
}

export function enterTelegramTokens() {
  ensureState()
  if (beforeEnterHook) {
    try { beforeEnterHook() } catch (e) { log.warn('before-enter.hook.failed', { err: e?.message }) }
  }
  showStep(STEP_TELEGRAM_TOKENS)
  renderAll()
  // Resume the rate-limit ticker if there's a still-in-future lock
  // when re-entering the step (e.g., user backed out and came back).
  const future = Object.values(state.tgRateLimit || {}).some((t) => typeof t === 'number' && t > Date.now())
  if (future) startRateLimitTick()
}

async function startChatPolling(roleKey) {
  const bot = state.telegram[roleKey]
  const tokenAtStart = bot.token.trim()
  bot.status = 'waiting-chat'
  renderRow(roleKey)
  renderActions()

  let res
  try {
    res = await window.telegramApi.waitForChatId(tokenAtStart, POLL_DEADLINE_MS)
  } catch (e) {
    log.warn('chat-poll.crash', { roleKey, err: e?.message })
    res = { ok: false, error: e?.message || 'unknown' }
  }

  // While polling, the user may have:
  //  - changed the token (we cancelled this poll already from onTokenInput)
  //  - re-clicked Verify (same)
  //  - navigated back (re-render on re-enter restores correct state)
  // Guard: only apply the result if the token is unchanged AND we're
  // still in waiting-chat state for the same poll.
  if (state.telegram[roleKey].token.trim() !== tokenAtStart) return
  if (state.telegram[roleKey].status !== 'waiting-chat') return

  if (res?.ok && res.chatId) {
    bot.chatId = res.chatId
    bot.status = 'chat-captured'
    bot.error = null
    log.info('chat-captured', { roleKey, botUsername: bot.botUsername })
  } else if (res?.cancelled) {
    // Cancelled by token change — leave whatever state the new flow
    // already set. Do not overwrite.
    return
  } else {
    bot.status = 'failed'
    bot.error = res?.error === 'timeout'
      ? 'No /start received within 15 min — open the link again and press Start.'
      : (res?.error || 'unknown error during chat polling')
  }
  renderRow(roleKey)
  renderActions()
}

async function onVerify(roleKey) {
  ensureState()
  const bot = state.telegram[roleKey]
  const token = (bot.token || '').trim()
  if (!token) return

  // Cancel any previous poll for the same token to avoid stale resolutions.
  try {
    if (window.telegramApi?.cancelWaitForChatId) {
      await window.telegramApi.cancelWaitForChatId(token)
    }
  } catch { /* ignore */ }

  bot.botUsername = null
  bot.chatId = null
  bot.error = null
  bot.status = 'verifying'
  renderRow(roleKey)
  renderActions()

  let res
  try {
    res = await window.telegramApi.verifyBot(token)
  } catch (e) {
    log.warn('verify.crash', { roleKey, err: e?.message })
    res = { ok: false, error: e?.message || 'unknown' }
  }

  if (!res?.ok) {
    bot.status = 'failed'
    bot.error = res?.error || 'verification failed'
    renderRow(roleKey)
    renderActions()
    return
  }

  bot.botUsername = res.username
  bot.status = 'verified'
  log.info('verified', { roleKey, username: res.username })

  // Arm the rate-limit cooldown on the NEXT bot — verifying this
  // token is the earliest signal we get that the user has just done
  // /newbot on BotFather. Assume the next /newbot is imminent and
  // gate it. Only set once per role (don't reset if user re-verifies).
  const next = TG_NEXT_ROLE[roleKey]
  if (next) {
    if (!state.tgRateLimit) state.tgRateLimit = {}
    if (!state.tgRateLimit[next]) {
      state.tgRateLimit[next] = Date.now() + TG_COOLDOWN_MS
      log.info('rate-limit.armed', { next, untilMs: state.tgRateLimit[next] })
      startRateLimitTick()
      renderRow(next)
    }
  }

  // Immediately enter chat-polling mode — the user already has the
  // deep-link and they're expected to press Start within the 15-min
  // window. Don't make them click anything else.
  startChatPolling(roleKey)
}

let rateLimitTickHandle = null
function startRateLimitTick() {
  if (rateLimitTickHandle) return
  rateLimitTickHandle = setInterval(() => {
    // Stop if the step isn't visible (user navigated away).
    const step = document.getElementById('step-telegram-tokens')
    if (!step || step.hidden) {
      stopRateLimitTick()
      return
    }
    // Stop if no lock is still in the future.
    const future = Object.values(state.tgRateLimit || {}).some((t) => typeof t === 'number' && t > Date.now())
    if (!future) {
      stopRateLimitTick()
      // Final pass to clear the lock display.
      renderAll()
      return
    }
    // Re-render locked rows only — cheap.
    for (const role of TELEGRAM_BOT_ROLES) {
      if (isLocked(role.key)) renderRow(role.key)
    }
  }, 1000)
}
function stopRateLimitTick() {
  if (rateLimitTickHandle) {
    clearInterval(rateLimitTickHandle)
    rateLimitTickHandle = null
  }
}

function onTokenInput(roleKey, value) {
  ensureState()
  const bot = state.telegram[roleKey]
  const trimmed = (value || '').trim()
  if (bot.token === trimmed) return
  // Cancel any in-flight poll for the OLD token so the result doesn't
  // race in after the user has moved on.
  if (bot.token && bot.token.trim() && window.telegramApi?.cancelWaitForChatId) {
    try { window.telegramApi.cancelWaitForChatId(bot.token.trim()) } catch { /* ignore */ }
  }
  bot.token = trimmed
  // A new token resets the chat side too — user might be replacing a
  // bot with a different one.
  bot.botUsername = null
  bot.chatId = null
  bot.error = null
  bot.status = 'idle'
  renderRow(roleKey)
  renderActions()
}

export function getTelegramBotsForSave() {
  ensureState()
  const out = {}
  for (const role of TELEGRAM_BOT_ROLES) {
    const bot = state.telegram[role.key]
    out[role.key] = {
      token: bot.token.trim(),
      chatId: bot.chatId,
    }
  }
  return out
}

export function isTelegramTokensReady() {
  ensureState()
  return TELEGRAM_BOT_ROLES.every((r) => {
    const bot = state.telegram[r.key]
    return bot.status === 'chat-captured' && bot.token && bot.chatId
  })
}

// ── DOM wiring (side-effect on import) ─────────────────────────────────

for (const role of TELEGRAM_BOT_ROLES) {
  const els = getRow(role.key)
  if (els.input) {
    els.input.addEventListener('input', (ev) => onTokenInput(role.key, ev.target.value))
    els.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault()
        if (!els.verifyBtn.disabled) onVerify(role.key)
      }
    })
  }
  if (els.verifyBtn) {
    els.verifyBtn.addEventListener('click', () => onVerify(role.key))
  }
  if (els.deepLink) {
    els.deepLink.addEventListener('click', (ev) => {
      // Let the OS open the URL in the default browser instead of
      // hijacking the Electron window. launcherApi.openExternal already
      // does this in the rest of the wizard.
      const href = els.deepLink.getAttribute('href')
      if (!href || !window.launcherApi?.openExternal) return
      ev.preventDefault()
      window.launcherApi.openExternal(href).catch(() => {})
    })
  }
}
