// Small persistent store for the user's provider selection.
// Stores ONLY which CLIs the user picked — never tokens, never keys
// (per ADR 0004 the subscription credentials live inside the container
// bind-mount, managed by the CLI's own `<cli> login` flow).

const fs = require('node:fs')
const path = require('node:path')

const FILE_NAME = 'providers.json'
const VALID_IDS = new Set(['claude', 'codex', 'kimi'])

function storePath(userDataDir) {
  return path.join(userDataDir, FILE_NAME)
}

// The user picks exactly one provider + one plan tier. The plan tier
// is informational (what subscription the user is paying for), used
// later by the runtime sentinel to size context windows and pace
// requests against the account's actual quota.
function readSelection(userDataDir) {
  const file = storePath(userDataDir)
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    // New shape: { provider: 'claude', plan: 'max20' }
    if (data && typeof data.provider === 'string' && VALID_IDS.has(data.provider)) {
      const plan = typeof data.plan === 'string' && data.plan ? data.plan : null
      return { provider: data.provider, plan }
    }
    // Legacy shape: { providers: ['claude', ...] } — take the first entry
    // as the selected provider, no plan info available.
    if (Array.isArray(data && data.providers)) {
      const first = data.providers.find((id) => VALID_IDS.has(id))
      if (first) return { provider: first, plan: null }
    }
  } catch {
    // Missing or malformed file → treat as "no selection yet".
  }
  return { provider: null, plan: null }
}

function writeSelection(userDataDir, { provider, plan } = {}) {
  if (!VALID_IDS.has(provider)) {
    throw new Error(`invalid provider: ${provider}`)
  }
  const file = storePath(userDataDir)
  fs.mkdirSync(userDataDir, { recursive: true })
  const payload = { provider, plan: plan || null }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  return payload
}

// Backwards-compatible helpers — still return an array so legacy
// callers (container-prep, provider-install, provider-auth) keep
// working until they're migrated to readSelection() directly.
function readProviders(userDataDir) {
  const sel = readSelection(userDataDir)
  return sel.provider ? [sel.provider] : []
}

function writeProviders(userDataDir, providerIds) {
  if (!Array.isArray(providerIds)) throw new Error('providerIds must be an array')
  const first = providerIds.find((id) => VALID_IDS.has(id))
  if (!first) {
    // Empty selection — truncate the file to an empty object so the
    // next read returns the "no selection" shape.
    const file = storePath(userDataDir)
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({}, null, 2))
    return []
  }
  // Preserve the existing plan (if any) when the array-based writer is
  // used — the renderer's new code always goes through writeSelection.
  const existing = readSelection(userDataDir)
  writeSelection(userDataDir, { provider: first, plan: existing.plan })
  return [first]
}

module.exports = {
  readSelection,
  writeSelection,
  readProviders,
  writeProviders,
  storePath,
  VALID_IDS,
}
