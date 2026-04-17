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
  // @jacksontian/kimi-cli: config typically at ~/.kimi/config.json
  // once the user has signed in.
  kimi: [
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

module.exports = {
  AUTH_PATHS,
  authStateFor,
  authStates,
}
