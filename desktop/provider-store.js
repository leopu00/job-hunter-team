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

function readProviders(userDataDir) {
  const file = storePath(userDataDir)
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    if (Array.isArray(data.providers)) {
      return data.providers.filter((id) => VALID_IDS.has(id))
    }
  } catch {
    // Missing or malformed file → treat as "no selection yet".
  }
  return []
}

function writeProviders(userDataDir, providerIds) {
  if (!Array.isArray(providerIds)) throw new Error('providerIds must be an array')
  const sanitized = providerIds.filter((id) => VALID_IDS.has(id))
  const file = storePath(userDataDir)
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ providers: sanitized }, null, 2))
  return sanitized
}

module.exports = {
  readProviders,
  writeProviders,
  storePath,
  VALID_IDS,
}
