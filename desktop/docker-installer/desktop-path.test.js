const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { candidatePaths, dockerDesktopPath } = require('./desktop-path')

test('windows candidates include Docker Desktop.exe under ProgramFiles', () => {
  const env = { ProgramFiles: 'C:\\Program Files' }
  const paths = candidatePaths('win32', env)
  assert.ok(paths.some((p) => p.endsWith('Docker Desktop.exe')))
})

test('darwin candidates include standard brew prefixes for colima', () => {
  const paths = candidatePaths('darwin', { PATH: '' })
  assert.ok(paths.includes('/opt/homebrew/bin/colima'))
  assert.ok(paths.includes('/usr/local/bin/colima'))
})

test('darwin candidates also derive from PATH entries', () => {
  const env = { PATH: ['/tmp/fakebin', '/opt/homebrew/bin'].join(path.delimiter) }
  const paths = candidatePaths('darwin', env)
  assert.ok(paths.includes('/tmp/fakebin/colima'))
  // existing explicit candidate should not be duplicated
  const homebrewMatches = paths.filter((p) => p === '/opt/homebrew/bin/colima')
  assert.equal(homebrewMatches.length, 1)
})

test('linux returns no candidates', () => {
  assert.deepEqual(candidatePaths('linux', {}), [])
})

test('dockerDesktopPath returns null when no candidate exists on disk', () => {
  const env = { PATH: '/definitely/does/not/exist' }
  assert.equal(dockerDesktopPath('darwin', env), null)
})

test('dockerDesktopPath finds a colima binary when present on disk (darwin)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jht-colima-test-'))
  const binPath = path.join(tmpDir, 'colima')
  fs.writeFileSync(binPath, '#!/bin/sh\n')
  try {
    const env = { PATH: tmpDir }
    assert.equal(dockerDesktopPath('darwin', env), binPath)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
