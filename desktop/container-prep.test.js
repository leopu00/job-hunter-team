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

test('ensureContainerImage resolves when pull succeeds', async () => {
  const { run, calls } = fakeRun([{ result: { ok: true, code: 0 } }])
  const logs = []
  const result = await ensureContainerImage({
    payloadDir: '/tmp/payload',
    onLog: (l) => logs.push(l),
    run,
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
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'build')
  assert.match(result.error, /build/i)
})

test('ensureContainerImage requires payloadDir', async () => {
  const result = await ensureContainerImage({ onLog: () => {} })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'init')
})
