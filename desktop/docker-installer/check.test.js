const test = require('node:test')
const assert = require('node:assert/strict')
const { hintForState, checkDocker } = require('./check')

test('hintForState maps states to platform-specific copy', () => {
  assert.match(hintForState('missing', 'win32'), /Docker Desktop/)
  assert.match(hintForState('missing', 'darwin'), /Docker Desktop/)
  assert.match(hintForState('missing', 'linux'), /Docker Engine/)

  assert.match(hintForState('needs-reboot', 'win32'), /Riavvia/)
  assert.match(hintForState('needs-reboot', 'darwin'), /Docker/)
  assert.match(hintForState('needs-reboot', 'linux'), /systemctl|Riavvia/)

  assert.match(hintForState('ok', 'win32'), /Pronto/)
})

test('hintForState for unknown state returns empty string', () => {
  assert.equal(hintForState('unknown', 'win32'), '')
})

test('checkDocker returns a well-shaped result', async () => {
  const result = await checkDocker()
  assert.ok(['ok', 'missing', 'needs-reboot'].includes(result.state))
  assert.equal(typeof result.installed, 'boolean')
  assert.equal(typeof result.responsive, 'boolean')
  assert.equal(typeof result.hint, 'string')
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
