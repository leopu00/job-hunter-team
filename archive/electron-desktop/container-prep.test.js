const test = require('node:test')
const assert = require('node:assert/strict')
const { ensureContainerImage } = require('./container-prep')

function fakeRun(plan) {
  const calls = []
  const iter = plan[Symbol.iterator]()
  return {
    run: async (cmd, args, { cwd, onLog }) => {
      calls.push({ cmd, args, cwd })
      const step = iter.next()
      if (step.done) return { ok: false, code: 1 }
      if (step.value.log) step.value.log.forEach((l) => onLog(l))
      return step.value.result
    },
    calls,
  }
}

const noLocalImage = () => ({ present: false, image: 'ghcr.io/leopu00/jht:latest' })
// A registry-pulled image carries a RepoDigest; a locally-built one does not.
const registryImage = () => ({
  present: true,
  image: 'ghcr.io/leopu00/jht:latest',
  digests: ['ghcr.io/leopu00/jht@sha256:abc123'],
})
const localBuildImage = () => ({
  present: true,
  image: 'ghcr.io/leopu00/jht:latest',
  digests: [],
})

test('ensureContainerImage resolves when pull succeeds', async () => {
  const { run, calls } = fakeRun([{ result: { ok: true, code: 0 } }])
  const logs = []
  const result = await ensureContainerImage({
    payloadDir: '/tmp/payload',
    onLog: (l) => logs.push(l),
    run,
    inspect: noLocalImage,
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'pulled')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['compose', 'pull', 'jht'])
})

test('ensureContainerImage falls back to build when pull fails', async () => {
  const { run, calls } = fakeRun([
    { result: { ok: false, code: 1 } },
    { result: { ok: true, code: 0 } },
  ])
  const logs = []
  const result = await ensureContainerImage({
    payloadDir: '/tmp/payload',
    onLog: (l) => logs.push(l),
    run,
    inspect: noLocalImage,
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'built')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].args, ['compose', 'build', 'jht'])
})

test('ensureContainerImage reports error when both pull and build fail', async () => {
  const { run } = fakeRun([
    { result: { ok: false, code: 1 } },
    { result: { ok: false, code: 2, error: 'build blew up' } },
  ])
  const result = await ensureContainerImage({
    payloadDir: '/tmp/payload',
    onLog: () => {},
    run,
    inspect: noLocalImage,
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'build')
  assert.match(result.error, /build/i)
})

test('ensureContainerImage refreshes a registry image via pull (end-user auto-update)', async () => {
  const { run, calls } = fakeRun([{ result: { ok: true, code: 0 } }])
  const logs = []
  const result = await ensureContainerImage({
    payloadDir: '/tmp/payload',
    onLog: (l) => logs.push(l),
    run,
    inspect: registryImage,
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'pulled')
  assert.equal(result.source, 'registry')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['compose', 'pull', 'jht'])
})

test('ensureContainerImage skips pull ONLY for a locally-built image (dev flow)', async () => {
  const { run, calls } = fakeRun([{ result: { ok: true, code: 0 } }])
  const logs = []
  const result = await ensureContainerImage({
    payloadDir: '/tmp/payload',
    onLog: (l) => logs.push(l),
    run,
    inspect: localBuildImage,
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'local-build')
  assert.equal(result.source, 'local')
  assert.equal(calls.length, 0)
  assert.match(logs.join('\n'), /locally-built image/)
})

test('ensureContainerImage uses the existing registry image when pull fails (offline)', async () => {
  const { run, calls } = fakeRun([{ result: { ok: false, code: 1 } }])
  const logs = []
  const result = await ensureContainerImage({
    payloadDir: '/tmp/payload',
    onLog: (l) => logs.push(l),
    run,
    inspect: registryImage,
  })
  assert.equal(result.ok, true)
  assert.equal(result.stage, 'local-existing')
  assert.equal(result.source, 'local')
  // Tried the pull, then fell back to the on-disk image — no build.
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ['compose', 'pull', 'jht'])
  assert.match(logs.join('\n'), /using existing local image/)
})

test('ensureContainerImage requires payloadDir', async () => {
  const result = await ensureContainerImage({ onLog: () => {} })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'init')
})
