const test = require('node:test')
const assert = require('node:assert/strict')
const { inspectWsl, inspectGit, inspectExtraDeps } = require('./deps')

function fakeRun(script) {
  return async (cmd, args) => {
    const result = script(cmd, args)
    return { ok: false, stdout: '', stderr: '', code: 1, ...result }
  }
}

test('inspectWsl returns null on non-Windows', async () => {
  const result = await inspectWsl('darwin', { run: fakeRun(() => ({})) })
  assert.equal(result, null)
})

test('inspectWsl flags missing when wsl --status fails', async () => {
  const run = fakeRun(() => ({ ok: false }))
  const result = await inspectWsl('win32', { run })
  assert.equal(result.id, 'wsl')
  assert.equal(result.ok, false)
  assert.equal(result.state, 'missing')
  assert.equal(result.hintKey, 'deps.wsl.hint.missing')
})

test('inspectWsl flags no-distro when wsl -l -q is empty', async () => {
  const run = fakeRun((cmd, args) => {
    if (args.includes('--status')) return { ok: true, stdout: 'installed' }
    if (args.includes('-l')) return { ok: true, stdout: '   \0\0\0' }
    return {}
  })
  const result = await inspectWsl('win32', { run })
  assert.equal(result.state, 'no-distro')
  assert.equal(result.hintKey, 'deps.wsl.hint.noDistro')
})

test('inspectWsl reports ok when status + at least one distro', async () => {
  const run = fakeRun((cmd, args) => {
    if (args.includes('--status')) return { ok: true, stdout: 'ok' }
    if (args.includes('-l')) return { ok: true, stdout: 'U\0b\0u\0n\0t\0u\0' }
    return {}
  })
  const result = await inspectWsl('win32', { run })
  assert.equal(result.ok, true)
  assert.equal(result.state, 'ok')
})

test('inspectGit returns null on non-Windows', async () => {
  const result = await inspectGit('darwin', { run: fakeRun(() => ({ ok: true })) })
  assert.equal(result, null)
})

test('inspectGit flags missing when git --version fails on Windows', async () => {
  const run = fakeRun(() => ({ ok: false }))
  const result = await inspectGit('win32', { run })
  assert.equal(result.id, 'git')
  assert.equal(result.ok, false)
  assert.equal(result.hintKey, 'deps.git.hint.missing')
})

test('inspectGit reports ok when git --version succeeds', async () => {
  const run = fakeRun(() => ({ ok: true, stdout: 'git version 2.47.0' }))
  const result = await inspectGit('win32', { run })
  assert.equal(result.ok, true)
  assert.equal(result.state, 'ok')
})

test('inspectExtraDeps skips WSL/git on non-Windows', async () => {
  const run = fakeRun(() => ({ ok: false }))
  const result = await inspectExtraDeps({ platform: 'linux', run })
  assert.deepEqual(result.deps, [])
  assert.equal(result.allRequiredOk, true)
})

test('inspectExtraDeps reports both WSL and git on Windows', async () => {
  const run = fakeRun(() => ({ ok: false }))
  const result = await inspectExtraDeps({ platform: 'win32', run })
  const ids = result.deps.map((d) => d.id).sort()
  assert.deepEqual(ids, ['git', 'wsl'])
  assert.equal(result.allRequiredOk, false)
})
