const test = require('node:test')
const assert = require('node:assert/strict')
const { decideRuntimeAction, RUNTIME_CHOICES, DEFAULT_RUNTIME } = require('./container')

// Helper: a runtime-state snapshot with sensible defaults, overridable.
function state(over = {}) {
  return {
    platform: 'darwin',
    dockerResponds: false,
    colimaInstalled: false,
    dockerDesktopInstalled: false,
    ...over,
  }
}

test('detect-first: a responding daemon wins regardless of choice/platform', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const choice of RUNTIME_CHOICES) {
      const { action } = decideRuntimeAction(state({ platform, dockerResponds: true }), choice)
      assert.equal(action, 'ok', `${platform}/${choice} with a live daemon should be 'ok'`)
    }
  }
})

test('detect-first beats an explicit Docker Desktop choice (no second VM)', () => {
  // User picked docker-desktop but Colima is already serving docker → reuse it.
  const { action } = decideRuntimeAction(
    state({ dockerResponds: true, colimaInstalled: true }),
    'docker-desktop',
  )
  assert.equal(action, 'ok')
})

test('linux with no daemon reports daemon-down (host-managed service)', () => {
  const { action } = decideRuntimeAction(state({ platform: 'linux', dockerResponds: false }), 'auto')
  assert.equal(action, 'error-daemon-down')
})

test('mac + choice colima: start it when installed, else ask to install', () => {
  assert.equal(
    decideRuntimeAction(state({ colimaInstalled: true }), 'colima').action,
    'start-colima',
  )
  assert.equal(
    decideRuntimeAction(state({ colimaInstalled: false }), 'colima').action,
    'error-install-colima',
  )
})

test('mac + choice docker-desktop: start it when installed, else ask to install', () => {
  assert.equal(
    decideRuntimeAction(state({ dockerDesktopInstalled: true }), 'docker-desktop').action,
    'start-docker-desktop',
  )
  assert.equal(
    decideRuntimeAction(state({ dockerDesktopInstalled: false }), 'docker-desktop').action,
    'error-install-docker-desktop',
  )
})

test('mac + auto: prefer Colima (our default) over Docker Desktop', () => {
  const { action } = decideRuntimeAction(
    state({ colimaInstalled: true, dockerDesktopInstalled: true }),
    'auto',
  )
  assert.equal(action, 'start-colima')
})

test('mac + auto: fall back to Docker Desktop when only it is installed', () => {
  const { action } = decideRuntimeAction(state({ dockerDesktopInstalled: true }), 'auto')
  assert.equal(action, 'start-docker-desktop')
})

test('mac + auto: nothing installed → clear install error', () => {
  const { action } = decideRuntimeAction(state(), 'auto')
  assert.equal(action, 'error-nothing-installed')
})

test('unknown / missing choice is treated as auto', () => {
  assert.equal(DEFAULT_RUNTIME, 'auto')
  assert.equal(
    decideRuntimeAction(state({ colimaInstalled: true }), 'banana').action,
    'start-colima',
  )
  assert.equal(
    decideRuntimeAction(state({ colimaInstalled: true }), undefined).action,
    'start-colima',
  )
})
