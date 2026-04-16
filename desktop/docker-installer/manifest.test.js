const test = require('node:test')
const assert = require('node:assert/strict')
const { getStrategy } = require('./manifest')

test('windows x64 points to amd64 installer', () => {
  const s = getStrategy('win32', 'x64')
  assert.equal(s.kind, 'windows-docker-desktop')
  assert.match(s.download.url, /\/win\/main\/amd64\//)
  assert.equal(s.needsElevation, true)
  assert.equal(s.mayRequireReboot, true)
})

test('windows arm64 points to arm64 installer', () => {
  const s = getStrategy('win32', 'arm64')
  assert.match(s.download.url, /\/win\/main\/arm64\//)
})

test('mac uses Colima via brew, not Docker Desktop', () => {
  const s = getStrategy('darwin', 'arm64')
  assert.equal(s.kind, 'mac-colima')
  assert.deepEqual(s.packages, ['colima', 'docker'])
  assert.equal(s.manager, 'brew')
  assert.equal(s.needsElevation, false)
  assert.equal(s.mayRequireReboot, false)
})

test('linux uses get.docker.com script', () => {
  const s = getStrategy('linux', 'x64')
  assert.equal(s.kind, 'linux-docker-ce')
  assert.equal(s.scriptUrl, 'https://get.docker.com')
  assert.equal(s.needsElevation, true)
})

test('unknown platform returns null so UI can show a clear error', () => {
  assert.equal(getStrategy('freebsd', 'x64'), null)
})

test('each strategy advertises non-zero size estimates used by the preview UI', () => {
  for (const [p, a] of [['win32', 'x64'], ['darwin', 'arm64'], ['linux', 'x64']]) {
    const s = getStrategy(p, a)
    assert.ok(s.installedBytes > 0, `${p}/${a} needs installedBytes`)
    assert.ok(s.recommendedFreeBytes >= s.installedBytes, `${p}/${a} recommendedFreeBytes`)
    assert.ok(s.averageInstallSeconds > 0, `${p}/${a} averageInstallSeconds`)
  }
})
