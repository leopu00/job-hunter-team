// desktop/telegram/index.js — Telegram Bot API + VPS config persistence.
//
// Used by the desktop wizard's STEP_TELEGRAM_TOKENS (3 bot obbligatori,
// VPS-only). Mirrors the logic in cli/wizard/setup-steps.js but exposed
// over IPC so the renderer doesn't have to hit api.telegram.org directly
// (CSP keeps the renderer thin, every outbound HTTPS goes through main).
//
// Three public entry points:
//   - verifyBot(token)               → /getMe wrapper
//   - waitForFirstChat(token, ddlMs) → long-polls getUpdates, returns chat_id
//   - saveBotsToVps(vpsIp, bots)     → reads /root/.jht/jht.config.json on
//                                      the VPS, merges the 3 bots into
//                                      channels.telegram.bots, writes back
//                                      atomically. Idempotent.
//
// The SSH path uses desktop/vps/ssh-exec.js (T1 deliverable). We require
// it lazily so this module loads even if T1 hasn't merged yet — the
// caller gets a clear error from saveBotsToVps in that case.

const https = require('node:https')
const path = require('node:path')
const log = require('../logger').child('telegram')

const TG_API_HOST = 'api.telegram.org'
const REMOTE_CONFIG_PATH = '/root/.jht/jht.config.json'
const REMOTE_CONFIG_DIR = path.posix.dirname(REMOTE_CONFIG_PATH)

// Active long-polls keyed by token. The renderer can fire-and-forget
// waitForFirstChat and later call cancelWaitForFirstChat(token) when the
// user navigates away or re-edits the token. Without this, a stale poll
// keeps eating updates and the next /start hits the dead promise.
const activePolls = new Map()

function tgFetchJson(token, method, params = {}, timeoutMs = 30000) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const url = `https://${TG_API_HOST}/bot${encodeURIComponent(token)}/${method}${qs ? `?${qs}` : ''}`
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
  })
}

// /getMe — validates the token and returns the bot username so the
// renderer can build the t.me deep-link. Errors are surfaced as
// { ok: false, error } so the UI can show a clean message instead of
// throwing into the IPC layer.
async function verifyBot(rawToken) {
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  if (!token) return { ok: false, error: 'token-empty' }
  try {
    const r = await tgFetchJson(token, 'getMe', {}, 10000)
    if (!r.ok) {
      log.warn('verifyBot.api-error', { description: r.description })
      return { ok: false, error: r.description || 'getMe failed' }
    }
    return {
      ok: true,
      botId: r.result.id,
      username: r.result.username,
      name: r.result.first_name || r.result.username,
    }
  } catch (e) {
    log.warn('verifyBot.network-error', { err: e.message })
    return { ok: false, error: e.message || 'network error' }
  }
}

// Long-poll Telegram getUpdates until an incoming message gives us a
// chat_id, or the per-call deadline elapses. Mirrors the CLI logic in
// setup-steps.js (skip backlog → loop with timeout=20s/round).
//
// Cancellation: the renderer may call cancelWaitForFirstChat(token) to
// abort early (user changed token, navigated back, etc.). The loop
// checks the cancelled flag each round.
async function waitForFirstChat(rawToken, deadlineMs) {
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  if (!token) return { ok: false, error: 'token-empty' }
  const deadline = Number.isFinite(deadlineMs) && deadlineMs > 0
    ? Date.now() + deadlineMs
    : Date.now() + 15 * 60 * 1000

  // Replace any previous poll for the same token: if the renderer
  // re-enters the step, the older one is cancelled first.
  const prev = activePolls.get(token)
  if (prev) prev.cancel()
  const state = { cancelled: false }
  state.cancel = () => { state.cancelled = true }
  activePolls.set(token, state)

  try {
    // Skip backlog: start from current update_id + 1 so a /start sent
    // hours ago in dev doesn't immediately resolve the poll.
    let offset = 0
    try {
      const init = await tgFetchJson(token, 'getUpdates', { offset: -1, timeout: 0 }, 8000)
      if (init.ok && init.result.length > 0) {
        offset = init.result[init.result.length - 1].update_id
      }
    } catch { /* network glitch on init: start from 0 */ }
    if (state.cancelled) return { ok: false, cancelled: true }

    while (!state.cancelled && Date.now() < deadline) {
      try {
        const r = await tgFetchJson(
          token, 'getUpdates',
          { offset: offset + 1, timeout: 20 },
          30000,
        )
        if (state.cancelled) return { ok: false, cancelled: true }
        if (r.ok && r.result.length > 0) {
          for (const u of r.result) {
            const chat = u.message?.chat || u.edited_message?.chat
            if (chat?.id) {
              return { ok: true, chatId: String(chat.id) }
            }
          }
          offset = r.result[r.result.length - 1].update_id
        }
      } catch (e) {
        // Network blip — retry until deadline. Log so we don't lose
        // signal on a flaky connection.
        log.debug('waitForFirstChat.retry', { err: e.message })
      }
    }
    if (state.cancelled) return { ok: false, cancelled: true }
    return { ok: false, error: 'timeout' }
  } finally {
    activePolls.delete(token)
  }
}

function cancelWaitForFirstChat(rawToken) {
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  const p = activePolls.get(token)
  if (p) p.cancel()
  return { ok: true, cancelled: Boolean(p) }
}

// ── SSH bridge (depends on T1: desktop/vps/ssh-exec.js) ────────────────
//
// Loaded lazily so this module imports cleanly pre-T1. Once T1 lands
// and ssh-exec.js exists on master, the saveBotsToVps call succeeds.
// Pre-T1 it returns a clean { ok: false, error: 'ssh-exec-not-available' }
// so the UI can surface the actual blocker instead of a crash.
let cachedSshExec = null
function loadSshExec() {
  if (cachedSshExec) return cachedSshExec
  try {
    cachedSshExec = require('../vps/ssh-exec.js')
    return cachedSshExec
  } catch (e) {
    log.debug('ssh-exec.not-loaded', { err: e.message })
    return null
  }
}

// Merge new bots into the existing remote config without clobbering
// unrelated fields. Reads the remote file (404 → empty object), deep-
// merges channels.telegram.bots, then atomic write. The atomic flag on
// SshExec.writeFile handles the tmp-file rename so a half-written file
// never lands at REMOTE_CONFIG_PATH even if the SSH connection drops
// mid-stream.
async function saveBotsToVps(vpsIp, bots) {
  if (!vpsIp) return { ok: false, error: 'vps-ip-missing' }
  if (!bots || typeof bots !== 'object') return { ok: false, error: 'bots-missing' }
  const ssh = loadSshExec()
  if (!ssh) {
    return { ok: false, error: 'ssh-exec-not-available', hint: 'T1 (desktop/vps/ssh-exec.js) not merged yet' }
  }

  // Read existing remote config. cat returns non-zero on missing file
  // (or empty stdout if the file is empty); both cases mean "start from
  // a fresh object". We do NOT use a fallback marker — the SSH stderr
  // distinguishes "file missing" from "host unreachable" if needed.
  let remote = {}
  try {
    const readRes = await ssh.run(vpsIp, `cat '${REMOTE_CONFIG_PATH}' 2>/dev/null || true`, { timeoutMs: 15000 })
    if (readRes.ok && readRes.stdout && readRes.stdout.trim()) {
      try {
        remote = JSON.parse(readRes.stdout)
      } catch (parseErr) {
        log.warn('saveBotsToVps.remote-config-malformed', { err: parseErr.message })
        return { ok: false, error: 'remote-config-malformed', detail: parseErr.message }
      }
    } else if (!readRes.ok) {
      // Connection issue, not just missing file. Surface it.
      log.warn('saveBotsToVps.read-failed', { code: readRes.code, stderr: readRes.stderr })
      return { ok: false, error: 'ssh-read-failed', stderr: readRes.stderr }
    }
  } catch (e) {
    return { ok: false, error: 'ssh-read-error', detail: e.message }
  }

  // Defensive defaults — never assume the file's shape.
  if (!remote || typeof remote !== 'object') remote = {}
  if (!remote.channels || typeof remote.channels !== 'object') remote.channels = {}
  if (!remote.channels.telegram || typeof remote.channels.telegram !== 'object') {
    remote.channels.telegram = {}
  }
  if (!remote.channels.telegram.bots || typeof remote.channels.telegram.bots !== 'object') {
    remote.channels.telegram.bots = {}
  }

  for (const key of ['assistente', 'capitano', 'mentor']) {
    const entry = bots[key]
    if (!entry || !entry.token) {
      return { ok: false, error: `bot-${key}-incomplete` }
    }
    remote.channels.telegram.bots[key] = {
      bot_token: entry.token,
      chat_id: entry.chatId ? String(entry.chatId) : undefined,
    }
    // Strip undefined so the JSON stays clean.
    if (remote.channels.telegram.bots[key].chat_id === undefined) {
      delete remote.channels.telegram.bots[key].chat_id
    }
  }

  // /root/.jht may not exist on a brand-new VPS (install.sh creates
  // it but we don't depend on its run order). mkdir is a no-op if it
  // already exists, so cheaper than branching.
  try {
    const mkdirRes = await ssh.run(vpsIp, `mkdir -p '${REMOTE_CONFIG_DIR}'`, { timeoutMs: 15000 })
    if (!mkdirRes.ok) {
      log.warn('saveBotsToVps.mkdir-failed', { code: mkdirRes.code, stderr: mkdirRes.stderr })
      return { ok: false, error: 'ssh-mkdir-failed', stderr: mkdirRes.stderr }
    }
  } catch (e) {
    return { ok: false, error: 'ssh-mkdir-error', detail: e.message }
  }

  const serialized = JSON.stringify(remote, null, 2) + '\n'
  try {
    const writeRes = await ssh.writeFile(vpsIp, REMOTE_CONFIG_PATH, serialized, {
      mode: '0600',
      atomic: true,
    })
    if (!writeRes.ok) {
      log.warn('saveBotsToVps.write-failed', { err: writeRes.err })
      return { ok: false, error: 'ssh-write-failed', detail: writeRes.err }
    }
  } catch (e) {
    return { ok: false, error: 'ssh-write-error', detail: e.message }
  }

  log.info('saveBotsToVps.ok', { vpsIp, botKeys: Object.keys(bots) })
  return { ok: true, path: REMOTE_CONFIG_PATH }
}

module.exports = {
  verifyBot,
  waitForFirstChat,
  cancelWaitForFirstChat,
  saveBotsToVps,
}
