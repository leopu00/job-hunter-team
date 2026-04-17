const test = require('node:test')
const assert = require('node:assert/strict')
const { installProvider, installProviders, PROVIDERS, resolveHome } = require('./provider-install')

function recordingRun(plan) {
  const calls = []
  const iter = plan[Symbol.iterator]()
  return {
    run: async (cmd, args, { cwd, onLog }) => {
      calls.push({ cmd, args, cwd })
      const step = iter.next()
      if (step.done) return { ok: false, code: 1 }
      if (step.value.logs) step.value.logs.forEach((l) => onLog(l))
      return step.value.result
    },
    calls,
  }
}

test('installProvider rejects unknown id', async () => {
  const { run } = recordingRun([])
  const result = await installProvider({ providerId: 'foo', payloadDir: '/tmp', run })
  assert.equal(result.ok, false)
  assert.match(result.error, /unknown/)
})

test('installProvider requires payloadDir', async () => {
  const { run } = recordingRun([])
  const result = await installProvider({ providerId: 'claude', run })
  assert.equal(result.ok, false)
  assert.match(result.error, /payloadDir/)
})

test('installProvider runs the configured command for claude', async () => {
  const { run, calls } = recordingRun([{ result: { ok: true, code: 0 } }])
  const result = await installProvider({ providerId: 'claude', payloadDir: '/tmp', run })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  const args = calls[0].args
  assert.deepEqual(args.slice(0, 6), ['compose', 'run', '--rm', '--no-deps', '--entrypoint', 'npm'])
  assert.ok(args.includes('@anthropic-ai/claude-code@latest'))
  assert.ok(args.some((a) => /NPM_CONFIG_PREFIX=/.test(a)))
  assert.ok(args.includes('jht'))
})

test('installProvider returns failure when the underlying command fails', async () => {
  const { run } = recordingRun([{ result: { ok: false, code: 1, error: 'network' } }])
  const result = await installProvider({ providerId: 'codex', payloadDir: '/tmp', run })
  assert.equal(result.ok, false)
  assert.match(result.error, /network|code 1/)
})

test('installProviders requires at least one id', async () => {
  const { run } = recordingRun([])
  const result = await installProviders({ providerIds: [], payloadDir: '/tmp', run })
  assert.equal(result.ok, false)
})

test('installProviders installs each selected provider in order', async () => {
  const { run, calls } = recordingRun([
    { result: { ok: true, code: 0 } },
    { result: { ok: true, code: 0 } },
  ])
  const result = await installProviders({
    providerIds: ['claude', 'kimi'],
    payloadDir: '/tmp',
    run,
  })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 2)
  assert.ok(calls[0].args.includes('@anthropic-ai/claude-code@latest'))
  assert.ok(calls[1].args.some((a) => /kimi/i.test(a)))
  for (const call of calls) {
    assert.ok(call.args.includes('--entrypoint'))
  }
})

test('installProviders stops at first failure and reports failedAt', async () => {
  const { run } = recordingRun([
    { result: { ok: true, code: 0 } },
    { result: { ok: false, code: 1, error: 'boom' } },
  ])
  const result = await installProviders({
    providerIds: ['claude', 'codex', 'kimi'],
    payloadDir: '/tmp',
    run,
  })
  assert.equal(result.ok, false)
  assert.equal(result.failedAt, 'codex')
})

test('PROVIDERS registry exposes expected shape', () => {
  for (const id of ['claude', 'codex', 'kimi']) {
    assert.ok(PROVIDERS[id])
    assert.equal(typeof PROVIDERS[id].displayName, 'string')
    assert.ok(Array.isArray(PROVIDERS[id].install))
    assert.ok(PROVIDERS[id].install.length >= 1)
    for (const step of PROVIDERS[id].install) {
      assert.equal(typeof step.entrypoint, 'string')
      assert.ok(Array.isArray(step.args))
    }
  }
})

test('resolveHome never returns undefined', () => {
  const home = resolveHome()
  assert.equal(typeof home, 'string')
  assert.ok(home.length > 0)
})
