const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  isPayloadPresent,
  isGitRepo,
  clonePayload,
  updatePayload,
  ensurePayload,
  SPARSE_PATHS,
} = require('./payload')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jht-payload-test-'))
}

function writeFile(targetPath, contents = '') {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, contents)
}

test('isPayloadPresent requires web/package.json or web/server.js', () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'app-payload')
  assert.equal(isPayloadPresent(payloadDir), false)

  writeFile(path.join(payloadDir, 'web', 'package.json'), '{}')
  assert.equal(isPayloadPresent(payloadDir), true)

  const standaloneDir = path.join(dir, 'standalone')
  writeFile(path.join(standaloneDir, 'web', 'server.js'), '// stub')
  assert.equal(isPayloadPresent(standaloneDir), true)
})

test('isGitRepo detects .git directory', () => {
  const dir = makeTempDir()
  assert.equal(isGitRepo(dir), false)
  fs.mkdirSync(path.join(dir, '.git'))
  assert.equal(isGitRepo(dir), true)
})

test('clonePayload runs git clone then sparse-checkout with expected paths', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'clone-target')
  const calls = []
  const fakeRunGit = async (args, options) => {
    calls.push({ args, options })
  }

  const result = await clonePayload({
    payloadDir,
    repoUrl: 'https://example.test/repo.git',
    branch: 'main',
    sparsePaths: ['web', 'cli'],
    runGit: fakeRunGit,
    logger: () => {},
  })

  assert.equal(result.action, 'cloned')
  assert.equal(calls.length, 3)
  assert.equal(calls[0].args[0], 'clone')
  assert.ok(calls[0].args.includes('--depth=1'))
  assert.ok(calls[0].args.includes('--sparse'))
  assert.ok(calls[0].args.includes('https://example.test/repo.git'))
  assert.ok(calls[0].args.includes(payloadDir))
  assert.deepEqual(calls[1].args, ['sparse-checkout', 'init', '--no-cone'])
  assert.equal(calls[1].options.cwd, payloadDir)
  assert.deepEqual(calls[2].args, ['sparse-checkout', 'set', 'web', 'cli'])
  assert.equal(calls[2].options.cwd, payloadDir)
})

test('clonePayload removes an existing payloadDir before cloning', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'existing')
  writeFile(path.join(payloadDir, 'junk.txt'), 'old')
  const fakeRunGit = async () => {}

  await clonePayload({
    payloadDir,
    runGit: fakeRunGit,
  })

  assert.equal(fs.existsSync(path.join(payloadDir, 'junk.txt')), false)
})

test('updatePayload fetches and resets the payload directory', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'payload')
  fs.mkdirSync(path.join(payloadDir, '.git'), { recursive: true })
  const calls = []
  const fakeRunGit = async (args, options) => {
    calls.push({ args, options })
  }

  const result = await updatePayload({
    payloadDir,
    branch: 'main',
    runGit: fakeRunGit,
  })

  assert.equal(result.action, 'updated')
  assert.deepEqual(calls[0].args, ['fetch', '--depth=1', 'origin', 'main'])
  assert.deepEqual(calls[1].args, ['reset', '--hard', 'origin/main'])
  assert.equal(calls[0].options.cwd, payloadDir)
})

test('updatePayload refuses non-git payload directories', async () => {
  const dir = makeTempDir()
  await assert.rejects(
    () => updatePayload({ payloadDir: dir, runGit: async () => {} }),
    /repo git/,
  )
})

test('ensurePayload clones when payload is missing', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'app-payload')
  let cloneCalled = false
  const fakeRunGit = async (args) => {
    if (args[0] === 'clone') {
      cloneCalled = true
      // Simulate a successful clone by laying down the expected file.
      writeFile(path.join(payloadDir, 'web', 'package.json'), '{}')
    }
  }

  const result = await ensurePayload({
    payloadDir,
    runGit: fakeRunGit,
  })

  assert.equal(cloneCalled, true)
  assert.equal(result.action, 'cloned')
})

test('ensurePayload returns present when payload already exists and no update requested', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'app-payload')
  writeFile(path.join(payloadDir, 'web', 'package.json'), '{}')
  const fakeRunGit = async () => {
    throw new Error('git should not be invoked')
  }

  const result = await ensurePayload({
    payloadDir,
    runGit: fakeRunGit,
  })

  assert.equal(result.action, 'present')
})

test('ensurePayload swallows update errors and keeps existing payload', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'app-payload')
  writeFile(path.join(payloadDir, 'web', 'package.json'), '{}')
  fs.mkdirSync(path.join(payloadDir, '.git'))

  const fakeRunGit = async () => {
    throw new Error('offline')
  }

  const result = await ensurePayload({
    payloadDir,
    updateIfPresent: true,
    runGit: fakeRunGit,
    logger: () => {},
  })

  assert.equal(result.action, 'kept')
  assert.match(result.warning, /offline/)
})

test('SPARSE_PATHS covers the folders the webapp needs at runtime', () => {
  for (const needed of ['web', 'shared', 'scripts']) {
    assert.ok(SPARSE_PATHS.includes(needed), `expected ${needed} in sparse paths`)
  }
})
