const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')
const os = require('node:os')

const { installWindowsStack, buildScript } = require('./install')

function makeFakeChild() {
  const child = new EventEmitter()
  child.kill = () => {}
  return child
}

function makeFakeFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    writeFileSync(p, content) { files.set(p, String(content)) },
    readFileSync(p) {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`)
      return files.get(p)
    },
    unlinkSync(p) { files.delete(p) },
  }
}

const FAKE_PATHS = {
  script: '/tmp/jht-install-windows-stack.ps1',
  log: '/tmp/jht-install.log',
  result: '/tmp/jht-install.result',
  dockerInstaller: '/tmp/DockerDesktopInstaller.exe',
}

test('returns unsupported-platform on darwin', async () => {
  const result = await installWindowsStack({
    platform: 'darwin',
    paths: FAKE_PATHS,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'unsupported-platform')
})

test('returns unsupported-platform on linux', async () => {
  const result = await installWindowsStack({
    platform: 'linux',
    paths: FAKE_PATHS,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'unsupported-platform')
})

test('ok=true + rebootRequired when result file says OK and exit 0', async () => {
  const fakeFs = makeFakeFs()
  const child = makeFakeChild()
  const spawnFn = () => {
    // Simulate the elevated script writing OK to the result file.
    setImmediate(() => {
      fakeFs.writeFileSync(FAKE_PATHS.result, 'OK\n')
      child.emit('close', 0)
    })
    return child
  }

  const result = await installWindowsStack({
    platform: 'win32',
    paths: FAKE_PATHS,
    spawnFn,
    fsApi: fakeFs,
  })
  assert.equal(result.ok, true)
  assert.equal(result.rebootRequired, true)
})

test('ok=false + stage=wsl-install when result is WSL_INSTALL', async () => {
  const fakeFs = makeFakeFs()
  const child = makeFakeChild()
  const spawnFn = () => {
    setImmediate(() => {
      fakeFs.writeFileSync(FAKE_PATHS.result, 'WSL_INSTALL')
      child.emit('close', 1)
    })
    return child
  }

  const result = await installWindowsStack({
    platform: 'win32',
    paths: FAKE_PATHS,
    spawnFn,
    fsApi: fakeFs,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'wsl-install')
})

test('ok=false + stage=aborted when no result file (UAC declined / blocked)', async () => {
  const fakeFs = makeFakeFs()
  const child = makeFakeChild()
  const spawnFn = () => {
    // No result file written → simulates UAC decline or script never started.
    setImmediate(() => child.emit('close', -1))
    return child
  }

  const result = await installWindowsStack({
    platform: 'win32',
    paths: FAKE_PATHS,
    spawnFn,
    fsApi: fakeFs,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'aborted')
  assert.match(result.error, /UAC|before reporting/)
})

test('buildScript runs only the two automatic steps (WSL + Git); Docker stays manual', () => {
  const script = buildScript({ paths: FAKE_PATHS })
  assert.match(script, /Step 1\/2 Checking\/installing WSL/)
  assert.match(script, /Step 2\/2 Installing Git/)
  assert.match(script, /--no-launch/)
  assert.match(script, /winget install --id Git\.Git/)
  // WSL install is idempotent — already-installed case skips safely.
  assert.match(script, /skipping wsl --install/)
  // Git has a winget-missing fallback to the direct Git-for-Windows installer.
  assert.match(script, /git-for-windows\/git\/releases\/download/)
  assert.match(script, /VERYSILENT/)
  // Docker install was removed — Docker Desktop is installed manually
  // by the user clicking "Download" in the wizard's Docker row.
  assert.doesNotMatch(script, /Installing Docker Desktop/)
})

test('stage=git-install when result is GIT_INSTALL', async () => {
  const fakeFs = makeFakeFs()
  const child = makeFakeChild()
  const spawnFn = () => {
    setImmediate(() => {
      fakeFs.writeFileSync(FAKE_PATHS.result, 'GIT_INSTALL')
      child.emit('close', 1)
    })
    return child
  }

  const result = await installWindowsStack({
    platform: 'win32',
    paths: FAKE_PATHS,
    spawnFn,
    fsApi: fakeFs,
  })
  assert.equal(result.stage, 'git-install')
})

test('buildScript escapes single quotes in temp paths to avoid PowerShell injection', () => {
  const tricky = {
    script: "C:\\Users\\bob's\\install.ps1",
    log: "C:\\Users\\bob's\\install.log",
    result: "C:\\Users\\bob's\\install.result",
    dockerInstaller: "C:\\Users\\bob's\\Docker.exe",
  }
  const script = buildScript({ paths: tricky })
  // Each quoted path should have its inner single-quote doubled.
  assert.match(script, /'C:\\Users\\bob''s\\install\.log'/)
  assert.match(script, /'C:\\Users\\bob''s\\install\.result'/)
})
