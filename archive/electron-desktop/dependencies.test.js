const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseVersion,
  versionAtLeast,
  inspectDocker,
  inspectNode,
  inspectGit,
  inspectPython,
  inspectDependencies,
} = require('./dependencies')

function fakeRunner(results) {
  return (command) => (command in results ? results[command] : null)
}

test('parseVersion extracts major/minor/patch from mixed strings', () => {
  assert.deepEqual(parseVersion('Docker version 24.0.5, build xxx'), {
    major: 24,
    minor: 0,
    patch: 5,
    raw: '24.0.5',
  })
  assert.deepEqual(parseVersion('v20.11.0'), {
    major: 20,
    minor: 11,
    patch: 0,
    raw: '20.11.0',
  })
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion(null), null)
})

test('versionAtLeast compares versions correctly', () => {
  const min = { major: 20, minor: 0, patch: 0 }
  assert.equal(versionAtLeast({ major: 20, minor: 0, patch: 0 }, min), true)
  assert.equal(versionAtLeast({ major: 22, minor: 0, patch: 0 }, min), true)
  assert.equal(versionAtLeast({ major: 18, minor: 19, patch: 0 }, min), false)
  assert.equal(versionAtLeast(null, min), false)
})

test('inspectDocker reports ok when docker --version succeeds', () => {
  const result = inspectDocker({
    runCli: fakeRunner({ docker: 'Docker version 24.0.5, build abcdef' }),
    platform: 'linux',
  })
  assert.equal(result.name, 'Docker')
  assert.equal(result.installed, true)
  assert.equal(result.ok, true)
  assert.equal(result.version, '24.0.5')
  assert.equal(result.hint, null)
})

test('inspectDocker reports missing with OS-aware hint on Windows', () => {
  const result = inspectDocker({
    runCli: fakeRunner({}),
    platform: 'win32',
  })
  assert.equal(result.installed, false)
  assert.equal(result.ok, false)
  assert.match(result.hint, /winget install Docker/)
})

test('inspectNode rejects versions below 20', () => {
  const result = inspectNode({
    runCli: fakeRunner({ node: 'v18.17.0' }),
    platform: 'darwin',
  })
  assert.equal(result.installed, true)
  assert.equal(result.ok, false)
  assert.equal(result.version, '18.17.0')
  assert.match(result.hint, /Node\.js 20/)
})

test('inspectNode accepts version >= 20', () => {
  const result = inspectNode({
    runCli: fakeRunner({ node: 'v20.10.0' }),
    platform: 'linux',
  })
  assert.equal(result.ok, true)
  assert.equal(result.hint, null)
})

test('inspectNode reports missing with macOS hint', () => {
  const result = inspectNode({
    runCli: fakeRunner({}),
    platform: 'darwin',
  })
  assert.equal(result.installed, false)
  assert.equal(result.ok, false)
  assert.match(result.hint, /brew install node/)
})

test('inspectGit reports ok when git --version succeeds', () => {
  const result = inspectGit({
    runCli: fakeRunner({ git: 'git version 2.42.0' }),
    platform: 'linux',
  })
  assert.equal(result.ok, true)
  assert.equal(result.version, '2.42.0')
})

test('inspectPython treats missing as ok (optional)', () => {
  const result = inspectPython({
    runCli: fakeRunner({}),
    platform: 'linux',
  })
  assert.equal(result.required, false)
  assert.equal(result.installed, false)
  assert.equal(result.ok, true)
  assert.match(result.hint, /Opzionale/)
})

test('inspectPython flags too-old version', () => {
  const result = inspectPython({
    runCli: fakeRunner({ python3: 'Python 3.8.10' }),
    platform: 'linux',
  })
  assert.equal(result.installed, true)
  assert.equal(result.ok, false)
  assert.match(result.hint, /Python 3\.10/)
})

test('inspectPython falls back to python when python3 missing', () => {
  const result = inspectPython({
    runCli: fakeRunner({ python: 'Python 3.11.4' }),
    platform: 'linux',
  })
  assert.equal(result.installed, true)
  assert.equal(result.ok, true)
  assert.equal(result.version, '3.11.4')
})

test('inspectDependencies aggregates allRequiredOk', () => {
  const allOk = inspectDependencies({
    runCli: fakeRunner({
      docker: 'Docker version 24.0.5',
      node: 'v20.10.0',
      git: 'git version 2.42.0',
    }),
    platform: 'linux',
  })
  assert.equal(allOk.allRequiredOk, true)
  assert.equal(allOk.dependencies.length, 4)

  const nodeMissing = inspectDependencies({
    runCli: fakeRunner({
      docker: 'Docker version 24.0.5',
      git: 'git version 2.42.0',
    }),
    platform: 'linux',
  })
  assert.equal(nodeMissing.allRequiredOk, false)
})
