// Detect whether each provider CLI is already authenticated.
//
// Approach v1: file-based. The CLIs write auth tokens into the user
// home directory which, inside the container, is bind-mounted to
// ~/.jht on the host. From the Electron main process we can check
// the host paths directly — no Docker call needed.
//
// This is a heuristic: we scan known credential-file locations for
// each CLI. Refine as we confirm the exact paths per provider.

const fs = require('node:fs')
const path = require('node:path')

const AUTH_PATHS = {
  // Claude Code stores OAuth credentials in ~/.claude/.credentials.json
  // on recent versions; older versions used ~/.config/claude/ or similar.
  claude: [
    '.claude/.credentials.json',
    '.claude/credentials.json',
    '.config/claude/credentials.json',
    '.config/claude/auth.json',
  ],
  // Codex (@openai/codex) stores auth under ~/.codex/ — exact filename
  // varies by version; we check any non-empty file under the dir.
  codex: [
    '.codex/auth.json',
    '.codex/credentials.json',
    '.config/codex/credentials.json',
  ],
  // Official Moonshot kimi-cli (github.com/MoonshotAI/kimi-cli) writes
  // auth + session state to ~/.kimi/kimi.json after the TUI /login
  // flow completes. Older @jacksontian wrapper used config.json; we
  // keep it in the list as a fallback for users mid-migration.
  kimi: [
    '.kimi/kimi.json',
    '.kimi/config.json',
    '.kimi/credentials.json',
    '.config/kimi/config.json',
  ],
}

function fileIsUsable(absPath) {
  try {
    const st = fs.statSync(absPath)
    return st.isFile() && st.size > 0
  } catch {
    return false
  }
}

function authStateFor(providerId, { bindHomeDir }) {
  const candidates = AUTH_PATHS[providerId] || []
  for (const rel of candidates) {
    if (fileIsUsable(path.join(bindHomeDir, rel))) {
      return { id: providerId, authed: true, match: rel }
    }
  }
  return { id: providerId, authed: false, match: null }
}

function authStates({ providers, bindHomeDir }) {
  const results = []
  for (const id of providers) {
    results.push(authStateFor(id, { bindHomeDir }))
  }
  return results
}

// VPS mode: check auth files NEL container remoto (/jht_home/<rel>)
// via SSH. Pattern parallelo a authStateFor ma con SshExec.run di un
// `docker exec jht test -s <path>` per ogni candidato. Exit 0 = file
// presente e non-vuoto, exit != 0 = mancante. Restituisce la STESSA
// shape di authStateFor ({id, authed, match}) cosi' il renderer non
// si accorge della differenza.
function authStateForViaSsh(providerId, { ssh }) {
  const candidates = AUTH_PATHS[providerId] || []
  for (const rel of candidates) {
    // /jht_home e' il path home dentro il container (vedi Dockerfile).
    // bash quoting: il path non contiene apici nei candidati conosciuti.
    const remotePath = '/jht_home/' + rel
    const r = ssh.run(
      `docker exec jht test -s '${remotePath}'`,
      { timeout: 8000 },
    )
    if (r.ok && r.code === 0) {
      return { id: providerId, authed: true, match: rel }
    }
  }
  return { id: providerId, authed: false, match: null }
}

function authStatesViaSsh({ providers, vpsIp }) {
  const SshExec = require('./vps/ssh-exec')
  const ssh = SshExec.forIp(vpsIp)
  const results = []
  for (const id of providers) {
    results.push(authStateForViaSsh(id, { ssh }))
  }
  return results
}

// VPS mode logout: rimuove i file auth nel container remoto via
// `docker exec jht rm -f <path>`. Parallelo a logoutProvider locale.
function logoutProviderViaSsh(providerId, { vpsIp }) {
  const SshExec = require('./vps/ssh-exec')
  const ssh = SshExec.forIp(vpsIp)
  const candidates = AUTH_PATHS[providerId] || []
  const removed = []
  for (const rel of candidates) {
    const remotePath = '/jht_home/' + rel
    // rm -f e' idempotente, exit 0 anche se il file non c'era.
    // Per registrare quali erano effettivamente presenti facciamo
    // prima un test -e, poi rm.
    const exists = ssh.run(`docker exec jht test -e '${remotePath}'`, { timeout: 8000 })
    if (exists.ok && exists.code === 0) {
      const r = ssh.run(`docker exec jht rm -f '${remotePath}'`, { timeout: 8000 })
      if (r.ok && r.code === 0) removed.push(rel)
    }
  }
  return { ok: true, removed }
}

// Wipe every known credential file for a provider so the next login
// starts from a clean slate ("switch account"). We delete individual
// files rather than rm -rf'ing the whole provider directory because
// some CLIs also keep non-credential state there (caches, settings)
// that's fine to preserve.
function logoutProvider(providerId, { bindHomeDir }) {
  const candidates = AUTH_PATHS[providerId] || []
  const removed = []
  for (const rel of candidates) {
    const abs = path.join(bindHomeDir, rel)
    try {
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs)
        removed.push(rel)
      }
    } catch (error) {
      // Permission / race — skip and keep going; the login flow will
      // overwrite anything stale when the user signs in again.
    }
  }
  return { ok: true, removed }
}

module.exports = {
  AUTH_PATHS,
  authStateFor,
  authStates,
  authStateForViaSsh,
  authStatesViaSsh,
  logoutProvider,
  logoutProviderViaSsh,
}
