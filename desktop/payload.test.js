const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  isPayloadPresent,
  isGitRepo,
  clonePayload,
  clonePayloadTarball,
  updatePayload,
  ensurePayload,
  deriveTarballUrl,
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

test('deriveTarballUrl maps github clone URLs to codeload tarball URL for the branch', () => {
  assert.equal(
    deriveTarballUrl('https://github.com/leopu00/job-hunter-team.git', 'master'),
    'https://codeload.github.com/leopu00/job-hunter-team/tar.gz/refs/heads/master',
  )
  // .git suffix is optional
  assert.equal(
    deriveTarballUrl('https://github.com/leopu00/job-hunter-team', 'main'),
    'https://codeload.github.com/leopu00/job-hunter-team/tar.gz/refs/heads/main',
  )
  // ssh-style URLs
  assert.equal(
    deriveTarballUrl('git@github.com:leopu00/job-hunter-team.git', 'dev-1'),
    'https://codeload.github.com/leopu00/job-hunter-team/tar.gz/refs/heads/dev-1',
  )
})

test('clonePayloadTarball downloads the tarball and extracts into the payload dir', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'tar-target')
  const calls = { download: [], extract: [] }
  const fakeDownload = async (url, destPath) => {
    calls.download.push({ url, destPath })
    fs.writeFileSync(destPath, 'fake tarball bytes')
  }
  const fakeExtract = async (tarballPath, destDir) => {
    calls.extract.push({ tarballPath, destDir })
    // Simulate tar dropping a package.json into the payload so subsequent
    // `isPayloadPresent` checks would pass end-to-end.
    fs.mkdirSync(path.join(destDir, 'web'), { recursive: true })
    fs.writeFileSync(path.join(destDir, 'web', 'package.json'), '{}')
  }

  const result = await clonePayloadTarball({
    payloadDir,
    httpsDownload: fakeDownload,
    extractTarball: fakeExtract,
  })

  assert.equal(result.action, 'cloned')
  assert.equal(result.source, 'tarball')
  assert.equal(calls.download.length, 1)
  assert.match(calls.download[0].url, /codeload\.github\.com\/leopu00\/job-hunter-team\/tar\.gz\/refs\/heads\/master$/)
  assert.equal(calls.extract.length, 1)
  assert.equal(calls.extract[0].destDir, payloadDir)
  // The temp tarball should not linger after extraction.
  assert.equal(fs.existsSync(calls.download[0].destPath), false)
  // And the payload was left behind by the extractor stub.
  assert.equal(isPayloadPresent(payloadDir), true)
})

test('clonePayloadTarball removes a stale payload dir before extracting', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'tar-target')
  writeFile(path.join(payloadDir, 'stale', 'file.txt'), 'old content')
  const fakeDownload = async (_u, p) => fs.writeFileSync(p, 'fake')
  const fakeExtract = async (_t, d) => {
    // Confirm the stale file was wiped before extract ran.
    assert.equal(fs.existsSync(path.join(d, 'stale', 'file.txt')), false)
    writeFile(path.join(d, 'web', 'package.json'), '{}')
  }

  await clonePayloadTarball({
    payloadDir,
    httpsDownload: fakeDownload,
    extractTarball: fakeExtract,
  })
})

test('ensurePayload falls back to tarball when git is not on PATH', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'app-payload')

  const fakeDownload = async (_u, p) => fs.writeFileSync(p, 'fake')
  const fakeExtract = async (_t, d) => {
    writeFile(path.join(d, 'web', 'package.json'), '{}')
  }

  const result = await ensurePayload({
    payloadDir,
    checkGitAvailable: async () => false,
    httpsDownload: fakeDownload,
    extractTarball: fakeExtract,
    logger: () => {},
  })
  assert.equal(result.action, 'cloned')
  assert.equal(result.source, 'tarball')
})

test('ensurePayload uses git when available', async () => {
  const dir = makeTempDir()
  const payloadDir = path.join(dir, 'app-payload')
  const fakeRunGit = async () => {
    writeFile(path.join(payloadDir, 'web', 'package.json'), '{}')
  }
  const result = await ensurePayload({
    payloadDir,
    checkGitAvailable: async () => true,
    runGit: fakeRunGit,
    logger: () => {},
  })
  assert.equal(result.action, 'cloned')
  assert.notEqual(result.source, 'tarball')
})

test('SPARSE_PATHS covers the folders the webapp needs at runtime', () => {
  for (const needed of ['web', 'shared', 'scripts']) {
    assert.ok(SPARSE_PATHS.includes(needed), `expected ${needed} in sparse paths`)
  }
})
