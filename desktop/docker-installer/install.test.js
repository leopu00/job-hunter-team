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

test('linux: installs Docker Engine via get.docker.com and reports ok', async () => {
  const stages = []
  const run = fakeRunSequence([{ ok: true, code: 0, stderr: '' }]) // pkexec sh -c <root script>
  const result = await installDocker({
    platform: 'linux',
    run,
    onStage: (name, status) => stages.push(`${name}:${status}`),
    download: async () => '/tmp/jht-get-docker.sh',
    pkexecCheck: async () => true,
    daemonCheck: async () => true,
    dockerCheck: async () => false, // current session not in docker group yet
    username: 'tester',
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'ok')
  assert.equal(result.needsRelogin, true, 'group membership needs a re-login to take effect')
  // Everything privileged runs under a SINGLE pkexec elevation.
  assert.equal(run.calls.length, 1)
  assert.equal(run.calls[0].cmd, 'pkexec')
  const rootScript = run.calls[0].args.join(' ')
  assert.ok(/usermod -aG docker "tester"/.test(rootScript), 'adds the user to the docker group')
  assert.ok(/systemctl enable --now docker/.test(rootScript), 'enables + starts the daemon')
  assert.ok(stages.includes('downloading-script:ok'))
  assert.ok(stages.includes('starting-daemon:ok'))
})

test('linux: needsRelogin=false when docker is already reachable in-session', async () => {
  const run = fakeRunSequence([{ ok: true, code: 0, stderr: '' }])
  const result = await installDocker({
    platform: 'linux',
    run,
    download: async () => '/tmp/x.sh',
    pkexecCheck: async () => true,
    daemonCheck: async () => true,
    dockerCheck: async () => true,
    username: 'tester',
  })
  assert.equal(result.ok, true)
  assert.equal(result.needsRelogin, false)
})

test('linux: pkexec dialog dismissed → stage auth-canceled', async () => {
  const run = fakeRunSequence([{ ok: false, code: 126, stderr: '' }])
  const result = await installDocker({
    platform: 'linux',
    run,
    download: async () => '/tmp/x.sh',
    pkexecCheck: async () => true,
    daemonCheck: async () => true,
    dockerCheck: async () => false,
    username: 'tester',
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'auth-canceled')
})

test('linux: no pkexec available → stage no-pkexec, nothing runs', async () => {
  const run = fakeRunSequence([])
  const result = await installDocker({
    platform: 'linux',
    run,
    download: async () => '/tmp/x.sh',
    pkexecCheck: async () => false,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'no-pkexec')
  assert.equal(run.calls.length, 0)
})

test('linux: script download failure → stage downloading-script', async () => {
  const run = fakeRunSequence([])
  const result = await installDocker({
    platform: 'linux',
    run,
    download: async () => {
      throw new Error('Download script Docker fallito: HTTP 500')
    },
    pkexecCheck: async () => true,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'downloading-script')
  assert.match(result.error, /HTTP 500/)
  assert.equal(run.calls.length, 0)
})

test('linux: daemon not active after install → stage daemon-inactive', async () => {
  const run = fakeRunSequence([{ ok: true, code: 0, stderr: '' }])
  const result = await installDocker({
    platform: 'linux',
    run,
    download: async () => '/tmp/x.sh',
    pkexecCheck: async () => true,
    daemonCheck: async () => false,
    dockerCheck: async () => false,
    username: 'tester',
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'daemon-inactive')
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
    { ok: true, code: 0, stderr: '' }, // brew install colima docker docker-compose
    { ok: true, code: 0, stderr: '' }, // brew link --overwrite docker
    { ok: true, code: 0, stderr: '' }, // bash -c mkdir + ln (compose plugin symlink)
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
    brewWritable: async () => ({ ok: true }),
    brewInstaller: async () => ({ ok: true, code: 0, stderr: '' }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'ok')
  // Homebrew should flip busy → ok once the installer runs and brew is found.
  assert.ok(stages.includes('homebrew:busy'))
  assert.ok(stages.includes('homebrew:ok'))
})

test('stage=brew-not-writable when brew exists but prefix belongs to another user', async () => {
  const stages = []
  const run = fakeRunSequence([])
  const result = await installDocker({
    platform: 'darwin',
    run,
    onStage: (name, status) => stages.push(`${name}:${status}`),
    brewCheck: async () => true,
    brewWritable: async () => ({ ok: false, prefix: '/opt/homebrew', dir: '/opt/homebrew/Cellar' }),
    dockerCheck: async () => true,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'brew-not-writable')
  assert.match(result.error, /altro utente/)
  assert.ok(stages.includes('homebrew:fail'))
  assert.equal(run.calls.length, 0, 'brew install must not run when prefix is not writable')
})

test('stage=brew-install when brew install fails', async () => {
  const run = fakeRunSequence([
    { ok: false, code: 1, stderr: 'No formula colima' },
  ])
  const result = await installDocker({
    platform: 'darwin',
    run,
    brewCheck: async () => true,
    brewWritable: async () => ({ ok: true }),
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
    { ok: true, code: 0, stderr: '' },               // brew install colima docker docker-compose
    { ok: true, code: 0, stderr: '' },               // brew link --overwrite docker
    { ok: true, code: 0, stderr: '' },               // bash -c mkdir + ln (compose plugin symlink)
    { ok: false, code: 2, stderr: 'cannot start vm vz' }, // colima start (vz)
    { ok: true, code: 0, stderr: '' },               // brew install qemu
    { ok: false, code: 3, stderr: 'cannot start vm qemu' }, // colima start --vm-type qemu
  ])
  const result = await installDocker({
    platform: 'darwin',
    run,
    brewCheck: async () => true,
    brewWritable: async () => ({ ok: true }),
    dockerCheck: async () => true,
    // qemu-img absent → the QEMU fallback must `brew install qemu` first.
    // Injected so the test doesn't depend on the host actually having qemu-img.
    qemuImgCheck: async () => false,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'colima-start')
  assert.match(result.error, /cannot start vm qemu/)
})

test('stage=daemon-unreachable when docker ps still fails after start', async () => {
  const run = fakeRunSequence([
    { ok: true, code: 0, stderr: '' }, // brew install colima docker docker-compose
    { ok: true, code: 0, stderr: '' }, // brew link --overwrite docker
    { ok: true, code: 0, stderr: '' }, // bash -c mkdir + ln (compose plugin symlink)
    { ok: true, code: 0, stderr: '' }, // colima start (vz)
  ])
  const result = await installDocker({
    platform: 'darwin',
    run,
    brewCheck: async () => true,
    brewWritable: async () => ({ ok: true }),
    dockerCheck: async () => false,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'daemon-unreachable')
  assert.equal(result.hintKey, 'docker.install.daemonUnreachable')
})

test('ok=true when brew install + colima start + docker ps all succeed', async () => {
  const logs = []
  const run = fakeRunSequence([
    { ok: true, code: 0, stderr: '' }, // brew install colima docker docker-compose
    { ok: true, code: 0, stderr: '' }, // brew link --overwrite docker
    { ok: true, code: 0, stderr: '' }, // bash -c mkdir + ln (compose plugin symlink)
    { ok: true, code: 0, stderr: '' }, // colima start
  ])
  const result = await installDocker({
    platform: 'darwin',
    onLog: (line) => logs.push(line),
    run,
    brewCheck: async () => true,
    brewWritable: async () => ({ ok: true }),
    dockerCheck: async () => true,
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'ok')
  assert.equal(run.calls.length, 4)
  assert.deepEqual(run.calls[0].args, ['install', 'colima', 'docker', 'docker-compose'])
  assert.deepEqual(run.calls[1].args, ['link', '--overwrite', 'docker'])
  assert.equal(run.calls[2].args[0], '-c') // bash -c '...compose plugin symlink...'
  assert.deepEqual(run.calls[3].args, ['start', '--cpu', '4', '--memory', '4'])
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

test('runStreamed kills a silent child after the idle timeout', async () => {
  // A process that produces no output and never exits is exactly the hang
  // we must not wait forever on. With a tiny idle timeout it should be
  // killed and reported as timedOut instead of pending forever.
  const start = Date.now()
  const result = await _internal.runStreamed('sleep', ['30'], {
    idleTimeoutMs: 250,
  })
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  assert.match(result.stderr, /timed out/)
  assert.ok(Date.now() - start < 10000, 'resolved promptly after idle timeout, not after sleep 30')
})

test('runStreamed does NOT time out a child that keeps emitting output', async () => {
  // Emits a line every ~40ms for ~200ms then exits 0. The idle timer resets
  // on each line, so a 250ms idle window must NOT trip: healthy-but-slow
  // installs keep running.
  const script = 'for i in 1 2 3 4 5; do echo line$i; sleep 0.04; done'
  const result = await _internal.runStreamed('bash', ['-c', script], {
    idleTimeoutMs: 250,
  })
  assert.equal(result.ok, true)
  assert.equal(result.timedOut, undefined)
})
