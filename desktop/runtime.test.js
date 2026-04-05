const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRuntimeManager, detectStartMode, inspectWebSetup, resolvePort } = require('./runtime')

function makeTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jht-desktop-test-'))
}

function writeFile(targetPath, contents) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, contents)
}

test('resolvePort falls back to default for invalid values', () => {
  assert.equal(resolvePort('abc'), 3000)
  assert.equal(resolvePort(80), 3000)
  assert.equal(resolvePort(70000), 3000)
  assert.equal(resolvePort(3100), 3100)
})

test('detectStartMode prefers production build when BUILD_ID exists', () => {
  const repoRoot = makeTempRepo()
  const webDir = path.join(repoRoot, 'web')
  writeFile(path.join(webDir, 'package.json'), '{}')
  fs.mkdirSync(path.join(webDir, 'node_modules'), { recursive: true })
  writeFile(path.join(webDir, '.next', 'BUILD_ID'), 'build-123')

  assert.equal(detectStartMode(webDir), 'production')
})

test('inspectWebSetup reports missing dependencies and suggested mode', () => {
  const repoRoot = makeTempRepo()
  const webDir = path.join(repoRoot, 'web')
  writeFile(path.join(webDir, 'package.json'), '{}')

  const missing = inspectWebSetup(repoRoot)
  assert.equal(missing.hasPackageJson, true)
  assert.equal(missing.hasNodeModules, false)
  assert.equal(missing.suggestedMode, null)
  assert.match(missing.issues[0], /Dipendenze web mancanti/)

  fs.mkdirSync(path.join(webDir, 'node_modules'), { recursive: true })
  const devOnly = inspectWebSetup(repoRoot)
  assert.equal(devOnly.suggestedMode, 'development')

  writeFile(path.join(webDir, '.next', 'BUILD_ID'), 'build-123')
  const production = inspectWebSetup(repoRoot)
  assert.equal(production.suggestedMode, 'production')
})

test('runtime manager starts and stops a local server via custom spawn factory', async () => {
  const repoRoot = makeTempRepo()
  const webDir = path.join(repoRoot, 'web')
  writeFile(path.join(webDir, 'package.json'), '{}')
  fs.mkdirSync(path.join(webDir, 'node_modules'), { recursive: true })
  writeFile(path.join(webDir, '.next', 'BUILD_ID'), 'build-123')
  let portOpen = false

  const manager = createRuntimeManager({
    repoRoot,
    logFile: path.join(repoRoot, 'launcher.log'),
    startTimeoutMs: 5000,
    isPortOpenFn: () => portOpen,
    spawnFn: (command, args, options) => {
      portOpen = true
      return require('node:child_process').spawn(command, args, options)
    },
    spawnSpecFactory: ({ port }) => ({
      command: process.execPath,
      args: [
        '-e',
        'setInterval(() => {}, 1000)',
      ],
      options: {
        cwd: webDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    }),
  })

  const started = await manager.startRuntime({ port: 3123, preferredMode: 'production' })
  assert.equal(started.mode, 'running')
  assert.equal(started.runtimeKind, 'production')
  assert.equal(started.running, true)

  const duringRun = await manager.getStatus()
  assert.equal(duringRun.mode, 'running')

  const stopped = await manager.stopRuntime()
  portOpen = false
  assert.equal(stopped.mode, 'stopped')
  assert.equal(stopped.managed, false)
})

test('runtime manager treats a reachable port as external runtime', async () => {
  const repoRoot = makeTempRepo()
  const webDir = path.join(repoRoot, 'web')
  writeFile(path.join(webDir, 'package.json'), '{}')
  fs.mkdirSync(path.join(webDir, 'node_modules'), { recursive: true })

  const manager = createRuntimeManager({
    repoRoot,
    isPortOpenFn: () => true,
    probeHttpFn: () => true,
  })

  const status = await manager.getStatus()
  assert.equal(status.mode, 'external')
  assert.equal(status.running, true)
})

test('runtime manager falls back to next free port when preferred one is blocked', async () => {
  const repoRoot = makeTempRepo()
  const webDir = path.join(repoRoot, 'web')
  writeFile(path.join(webDir, 'package.json'), '{}')
  fs.mkdirSync(path.join(webDir, 'node_modules'), { recursive: true })
  writeFile(path.join(webDir, '.next', 'BUILD_ID'), 'build-123')

  let openPorts = new Set([3000])
  const manager = createRuntimeManager({
    repoRoot,
    logFile: path.join(repoRoot, 'launcher.log'),
    startTimeoutMs: 5000,
    isPortOpenFn: (port) => openPorts.has(port),
    probeHttpFn: (port) => port === 3000 ? false : openPorts.has(port),
    spawnFn: (command, args, options) => {
      openPorts.add(3001)
      return require('node:child_process').spawn(command, args, options)
    },
    spawnSpecFactory: () => ({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      options: {
        cwd: webDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    }),
  })

  const started = await manager.startRuntime({ port: 3000, preferredMode: 'production' })
  assert.equal(started.mode, 'running')
  assert.equal(started.port, 3001)
  assert.equal(started.note, 'port-fallback')

  const stopped = await manager.stopRuntime()
  openPorts = new Set()
  assert.equal(stopped.mode, 'stopped')
})
