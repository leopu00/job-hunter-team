const test = require('node:test')
const assert = require('node:assert/strict')
const { hintKeyForState, checkDocker, isDockerDesktopRunning } = require('./check')

test('hintKeyForState maps states to platform-specific translation keys', () => {
  assert.equal(hintKeyForState('missing', 'win32'), 'docker.hint.missing.win32')
  assert.equal(hintKeyForState('missing', 'darwin'), 'docker.hint.missing.darwin')
  assert.equal(hintKeyForState('missing', 'linux'), 'docker.hint.missing.linux')

  assert.equal(hintKeyForState('not-running', 'win32'), 'docker.hint.notRunning.win32')
  assert.equal(hintKeyForState('not-running', 'darwin'), 'docker.hint.notRunning.darwin')

  assert.equal(hintKeyForState('starting', 'win32'), 'docker.hint.starting')
  assert.equal(hintKeyForState('starting', 'darwin'), 'docker.hint.starting')

  assert.equal(hintKeyForState('needs-reboot', 'win32'), 'docker.hint.needsReboot.win32')
  assert.equal(hintKeyForState('needs-reboot', 'darwin'), 'docker.hint.needsReboot.darwin')
  assert.equal(hintKeyForState('needs-reboot', 'linux'), 'docker.hint.needsReboot.linux')

  assert.equal(hintKeyForState('ok', 'win32'), 'docker.hint.ok')
  assert.equal(hintKeyForState('ok', 'darwin'), 'docker.hint.ok')
  assert.equal(hintKeyForState('ok', 'linux'), 'docker.hint.ok')
})

test('hintKeyForState for unknown state returns empty string', () => {
  assert.equal(hintKeyForState('unknown', 'win32'), '')
})

test('isDockerDesktopRunning returns a boolean on darwin (colima status)', async () => {
  const result = await isDockerDesktopRunning('darwin')
  assert.equal(typeof result, 'boolean')
})

test('isDockerDesktopRunning returns null on linux', async () => {
  const result = await isDockerDesktopRunning('linux')
  assert.equal(result, null)
})

test('checkDocker returns a well-shaped result', async () => {
  const result = await checkDocker()
  assert.ok(
    ['ok', 'missing', 'not-running', 'starting', 'needs-reboot'].includes(result.state),
    `unexpected state: ${result.state}`,
  )
  assert.equal(typeof result.installed, 'boolean')
  assert.equal(typeof result.responsive, 'boolean')
  assert.equal(typeof result.hintKey, 'string')
  if (result.state === 'missing') {
    assert.equal(result.installed, false)
    assert.equal(result.responsive, false)
  } else if (result.state === 'ok') {
    assert.equal(result.installed, true)
    assert.equal(result.responsive, true)
  } else {
    assert.equal(result.installed, true)
    assert.equal(result.responsive, false)
  }
})
