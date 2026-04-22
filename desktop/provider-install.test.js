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
  const { run, calls } = recordingRun([
    { result: { ok: false, code: 1 } }, // probe: binary not found → proceed
    { result: { ok: true, code: 0 } },  // actual install succeeds
  ])
  const result = await installProvider({ providerId: 'claude', payloadDir: '/tmp', run })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args.slice(0, 3), ['exec', 'jht', 'sh'])
  const args = calls[1].args
  assert.deepEqual(args.slice(0, 6), ['compose', 'run', '--rm', '--no-deps', '--entrypoint', 'npm'])
  assert.ok(args.includes('@anthropic-ai/claude-code@latest'))
  assert.ok(args.some((a) => /NPM_CONFIG_PREFIX=/.test(a)))
  assert.ok(args.includes('jht'))
})

test('installProvider skips install when the binary is already present', async () => {
  const { run, calls } = recordingRun([
    { result: { ok: true, code: 0 } }, // probe: binary found → skip
  ])
  const result = await installProvider({ providerId: 'codex', payloadDir: '/tmp', run })
  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args.slice(0, 3), ['exec', 'jht', 'sh'])
})

test('installProvider returns failure when the underlying command fails', async () => {
  const { run } = recordingRun([
    { result: { ok: false, code: 1 } },                       // probe fails → proceed
    { result: { ok: false, code: 1, error: 'network' } },     // install fails
  ])
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
  // claude: 1 probe (miss) + 1 install = 2 calls.
  // kimi: 1 probe (miss) + 2 installs (uninstall old wrapper, combined
  // uv+kimi-cli install) = 3 calls. Five docker calls total.
  const { run, calls } = recordingRun([
    { result: { ok: false, code: 1 } }, // claude probe miss
    { result: { ok: true, code: 0 } },  // claude install
    { result: { ok: false, code: 1 } }, // kimi probe miss
    { result: { ok: true, code: 0 } },  // kimi uninstall-old
    { result: { ok: true, code: 0 } },  // kimi combined uv + kimi-cli install
  ])
  const result = await installProviders({
    providerIds: ['claude', 'kimi'],
    payloadDir: '/tmp',
    run,
  })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 5)
  assert.ok(calls[1].args.includes('@anthropic-ai/claude-code@latest'))
  // The kimi install steps (after the probe at index 2) must collectively
  // mention kimi-cli somewhere.
  const kimiCalls = calls.slice(3)
  assert.ok(kimiCalls.some((c) => c.args.some((a) => /kimi/i.test(a))))
  for (const call of calls) {
    assert.ok(call.args.includes('--entrypoint') || call.args[0] === 'exec')
  }
})

test('installProviders stops at first failure and reports failedAt', async () => {
  const { run } = recordingRun([
    { result: { ok: false, code: 1 } },                    // claude probe miss
    { result: { ok: true, code: 0 } },                     // claude install
    { result: { ok: false, code: 1 } },                    // codex probe miss
    { result: { ok: false, code: 1, error: 'boom' } },     // codex install fails
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
