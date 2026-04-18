const test = require('node:test')
const assert = require('node:assert/strict')
const { installDocker, _internal } = require('./install')

function fakeRunSequence(plan) {
  // Each call shifts the next response. Lets us script "brew install
  // ok, colima start fail" without touching real binaries.
  const calls = []
  const queue = [...plan]
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    const next = queue.shift()
    if (!next) throw new Error(`unexpected extra call: ${cmd} ${args.join(' ')}`)
    if (typeof opts?.onLog === 'function') {
      opts.onLog(`[fake] ${cmd} ${args.join(' ')}`)
    }
    return Promise.resolve(next)
  }
  fn.calls = calls
  fn.remaining = () => queue.length
  return fn
}

test('returns unsupported-platform on win32', async () => {
  const result = await installDocker({ platform: 'win32' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'unsupported-platform')
})

test('returns unsupported-platform on linux', async () => {
  const result = await installDocker({ platform: 'linux' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'unsupported-platform')
})

test('stage=brew-install-homebrew when brew is missing and installer fails', async () => {
  const run = fakeRunSequence([])
  const result = await installDocker({
    platform: 'darwin',
    run,
    brewCheck: async () => false,
    dockerCheck: async () => true,
    brewInstaller: async () => ({ ok: false, code: 1, stderr: 'network error' }),
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'brew-install-homebrew')
  assert.equal(run.calls.length, 0, 'colima install not attempted when brew install fails')
})

test('brew install triggers brew installer when missing, then proceeds', async () => {
  const stages = []
  let brewWasMissing = true
  const run = fakeRunSequence([
    { ok: true, code: 0, stderr: '' }, // brew install colima docker
    { ok: true, code: 0, stderr: '' }, // colima start
  ])
  const result = await installDocker({
    platform: 'darwin',
    run,
    onStage: (name, status) => stages.push(`${name}:${status}`),
    // brewCheck returns false the first time (missing → trigger installer),
    // then true after the installer pretends it installed brew.
    brewCheck: async () => {
      if (brewWasMissing) {
        brewWasMissing = false
        return false
      }
      return true
    },
    dockerCheck: async () => true,
    brewInstaller: async () => ({ ok: true, code: 0, stderr: '' }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'ok')
  // Homebrew should flip busy → ok once the installer runs and brew is found.
  assert.ok(stages.includes('homebrew:busy'))
  assert.ok(stages.includes('homebrew:ok'))
})

test('stage=brew-install when brew install fails', async () => {
  const run = fakeRunSequence([
    { ok: false, code: 1, stderr: 'No formula colima' },
  ])
  const result = await installDocker({
    platform: 'darwin',
    run,
    brewCheck: async () => true,
    dockerCheck: async () => true,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'brew-install')
  assert.match(result.error, /No formula colima/)
  assert.equal(run.calls[0].args[0], 'install')
})

test('stage=colima-start when colima start fails on both VZ and QEMU', async () => {
  // New flow: if `colima start` fails, we install qemu (if missing) and
  // retry with `--vm-type qemu`. Only when the QEMU retry also fails do
  // we surface stage=colima-start.
  const run = fakeRunSequence([
    { ok: true, code: 0, stderr: '' },               // brew install colima docker
    { ok: false, code: 2, stderr: 'cannot start vm vz' }, // colima start (vz)
    { ok: true, code: 0, stderr: '' },               // brew install qemu
    { ok: false, code: 3, stderr: 'cannot start vm qemu' }, // colima start --vm-type qemu
  ])
  const result = await installDocker({
    platform: 'darwin',
    run,
    brewCheck: async () => true,
    dockerCheck: async () => true,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'colima-start')
  assert.match(result.error, /cannot start vm qemu/)
})

test('stage=daemon-unreachable when docker ps still fails after start', async () => {
  const run = fakeRunSequence([
    { ok: true, code: 0, stderr: '' },
    { ok: true, code: 0, stderr: '' },
  ])
  const result = await installDocker({
    platform: 'darwin',
    run,
    brewCheck: async () => true,
    dockerCheck: async () => false,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'daemon-unreachable')
  assert.equal(result.hintKey, 'docker.install.daemonUnreachable')
})

test('ok=true when brew install + colima start + docker ps all succeed', async () => {
  const logs = []
  const run = fakeRunSequence([
    { ok: true, code: 0, stderr: '' },
    { ok: true, code: 0, stderr: '' },
  ])
  const result = await installDocker({
    platform: 'darwin',
    onLog: (line) => logs.push(line),
    run,
    brewCheck: async () => true,
    dockerCheck: async () => true,
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'ok')
  assert.equal(run.calls.length, 2)
  assert.deepEqual(run.calls[0].args, ['install', 'colima', 'docker'])
  assert.deepEqual(run.calls[1].args, ['start'])
  // Logs should have surfaced through the onLog callback.
  assert.ok(logs.some((l) => /brew install colima docker/.test(l)))
})

test('brewPath puts /opt/homebrew/bin first so Apple Silicon brew is found', () => {
  const original = process.env.PATH
  try {
    process.env.PATH = '/usr/bin:/bin'
    const path = _internal.brewPath()
    assert.match(path, /^\/opt\/homebrew\/bin:/)
    assert.match(path, /\/usr\/local\/bin/)
    assert.match(path, /\/usr\/bin:\/bin$/)
  } finally {
    process.env.PATH = original
  }
})
