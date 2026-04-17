const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { authStateFor, authStates, AUTH_PATHS } = require('./provider-auth')

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'provider-auth-test-'))
}

function writeFileDeep(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

test('authStateFor returns authed=false for empty bindHomeDir', () => {
  const dir = makeTempHome()
  const state = authStateFor('claude', { bindHomeDir: dir })
  assert.equal(state.authed, false)
  assert.equal(state.match, null)
})

test('authStateFor returns authed=true when a credentials file exists', () => {
  const dir = makeTempHome()
  writeFileDeep(path.join(dir, '.claude', '.credentials.json'), '{"token":"x"}')
  const state = authStateFor('claude', { bindHomeDir: dir })
  assert.equal(state.authed, true)
  assert.equal(state.match, '.claude/.credentials.json')
})

test('authStateFor returns authed=false for an empty credentials file', () => {
  const dir = makeTempHome()
  writeFileDeep(path.join(dir, '.codex', 'auth.json'), '')
  const state = authStateFor('codex', { bindHomeDir: dir })
  assert.equal(state.authed, false)
})

test('authStates aggregates over a provider list', () => {
  const dir = makeTempHome()
  writeFileDeep(path.join(dir, '.kimi', 'config.json'), '{"k":1}')
  const states = authStates({ providers: ['claude', 'kimi'], bindHomeDir: dir })
  assert.equal(states.length, 2)
  assert.equal(states.find((s) => s.id === 'claude').authed, false)
  assert.equal(states.find((s) => s.id === 'kimi').authed, true)
})

test('AUTH_PATHS covers each supported provider', () => {
  for (const id of ['claude', 'codex', 'kimi']) {
    assert.ok(Array.isArray(AUTH_PATHS[id]), `missing paths for ${id}`)
    assert.ok(AUTH_PATHS[id].length > 0)
  }
})
