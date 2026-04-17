const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readProviders, writeProviders, storePath } = require('./provider-store')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'provider-store-test-'))
}

test('readProviders returns [] when no file exists', () => {
  const dir = makeTempDir()
  assert.deepEqual(readProviders(dir), [])
})

test('writeProviders then readProviders round-trips valid ids', () => {
  const dir = makeTempDir()
  writeProviders(dir, ['claude', 'kimi'])
  assert.deepEqual(readProviders(dir), ['claude', 'kimi'])
  assert.ok(fs.existsSync(storePath(dir)))
})

test('writeProviders filters unknown ids', () => {
  const dir = makeTempDir()
  writeProviders(dir, ['claude', 'gemini', 'foo'])
  assert.deepEqual(readProviders(dir), ['claude'])
})

test('readProviders returns [] when the file is malformed', () => {
  const dir = makeTempDir()
  fs.writeFileSync(path.join(dir, 'providers.json'), '{not json')
  assert.deepEqual(readProviders(dir), [])
})

test('writeProviders rejects non-array input', () => {
  const dir = makeTempDir()
  assert.throws(() => writeProviders(dir, 'claude'))
})
