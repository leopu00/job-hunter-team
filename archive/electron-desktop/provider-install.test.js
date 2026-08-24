const test = require('node:test')
const assert = require('node:assert/strict')
const { installProvider, installProviders, PROVIDERS, resolveHome, inspectInstalledProviders } = require('./provider-install')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

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

// ── VPS path (T2) ──────────────────────────────────────────────────
//
// Mock SshExec con un wrapper "forIp" che ritorna i metodi previsti
// dal contract (run/runStream). Ogni test inietta i comportamenti
// attesi via lookup map (cmd → result), cosi' verifichiamo che il
// codice chiami i comandi giusti nell'ordine giusto senza toccare ssh.

const { _internal: vpsInternal, installProvidersViaSsh } = require('./provider-install')
const { _ensureContainerUpRemote, _ensureNpmDirsWritable } = vpsInternal

function mockSsh(plan) {
  // plan: array di { match: regex|string, ok, code?, stdout?, stderr?, stream?: lines[] }
  // consumato in ordine. Se nessun match, fallback a { ok: true, code: 0 }.
  const calls = []
  const queue = [...plan]
  const matchOne = (cmd) => {
    const idx = queue.findIndex((q) => {
      if (typeof q.match === 'string') return cmd.includes(q.match)
      if (q.match instanceof RegExp) return q.match.test(cmd)
      return true
    })
    if (idx === -1) return null
    return queue.splice(idx, 1)[0]
  }
  return {
    calls,
    ssh: {
      run: (cmd) => {
        calls.push({ kind: 'run', cmd })
        const m = matchOne(cmd) || { ok: true, code: 0 }
        return { ok: m.ok, code: m.code ?? (m.ok ? 0 : 1), stdout: m.stdout || '', stderr: m.stderr || '' }
      },
      runStream: async (cmd, onLine) => {
        calls.push({ kind: 'stream', cmd })
        const m = matchOne(cmd) || { ok: true, code: 0 }
        if (Array.isArray(m.stream)) {
          for (const line of m.stream) onLine(line)
        }
        return { ok: m.ok, code: m.code ?? (m.ok ? 0 : 1) }
      },
    },
  }
}

test('_ensureContainerUpRemote: container already running → alreadyUp=true, no compose up', async () => {
  const { ssh, calls } = mockSsh([
    { match: 'docker ps -q -f name=^jht$', ok: true, stdout: 'a1b2c3d4e5f6\n' },
  ])
  const r = await _ensureContainerUpRemote(ssh)
  assert.equal(r.ok, true)
  assert.equal(r.alreadyUp, true)
  // Nessuna runStream (compose up) deve essere stata invocata.
  assert.equal(calls.filter((c) => c.kind === 'stream').length, 0)
})

test('_ensureContainerUpRemote: container down → compose up + exec true → ok alreadyUp=false', async () => {
  const { ssh, calls } = mockSsh([
    { match: 'docker ps -q', ok: true, stdout: '' }, // no container
    { match: 'docker compose up -d', ok: true },     // compose up
    { match: 'docker exec -i \'jht\' true', ok: true }, // exec confirm
  ])
  const r = await _ensureContainerUpRemote(ssh)
  assert.equal(r.ok, true)
  assert.equal(r.alreadyUp, false)
  // Verifica path hardcoded dell'install.sh runtime dir.
  const upCmd = calls.find((c) => c.kind === 'stream')
  assert.match(upCmd.cmd, /\/root\/\.jht\/runtime/)
  assert.match(upCmd.cmd, /docker compose up -d/)
})

test('_ensureContainerUpRemote: compose up exits non-zero → ok=false con error', async () => {
  const { ssh } = mockSsh([
    { match: 'docker ps -q', ok: true, stdout: '' },
    { match: 'docker compose up -d', ok: false, code: 1 },
  ])
  const r = await _ensureContainerUpRemote(ssh)
  assert.equal(r.ok, false)
  assert.match(r.error, /docker compose up exited 1/)
})

test('_ensureNpmDirsWritable: chown invocato come --user root con i 3 path attesi', async () => {
  const { ssh, calls } = mockSsh([{ match: 'chown -R', ok: true }])
  const r = await _ensureNpmDirsWritable(ssh)
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
  const cmd = calls[0].cmd
  assert.match(cmd, /docker exec -i --user root 'jht'/)
  assert.match(cmd, /mkdir -p \/jht_home\/\.npm-global \/jht_home\/\.npm \/jht_home\/\.local/)
  assert.match(cmd, /chown -R jht:jht/)
})

test('_ensureNpmDirsWritable: chown fallisce → ok=false, error', async () => {
  const { ssh } = mockSsh([{ match: 'chown -R', ok: false, code: 2, stderr: 'Operation not permitted' }])
  const r = await _ensureNpmDirsWritable(ssh)
  assert.equal(r.ok, false)
  assert.match(r.error, /chown npm dirs/)
})

test('installProvidersViaSsh: vpsIp mancante → error', async () => {
  const r = await installProvidersViaSsh({ providerIds: ['claude'] })
  assert.equal(r.ok, false)
  assert.match(r.error, /vpsIp/)
})

test('installProvidersViaSsh: providerIds vuoto → error', async () => {
  const r = await installProvidersViaSsh({ vpsIp: '192.0.2.10', providerIds: [] })
  assert.equal(r.ok, false)
  assert.match(r.error, /no providers/)
})

// installProvidersViaSsh stessa NON e' iniettabile col mock (require
// hardcoded di ./vps/ssh-exec dentro la funzione), ma le 3 funzioni
// helper sopra coprono il path critico. Il smoke E2E reale via VPS
// (test-e2e-vps-integration.js, TEMP-TEST-VPS-REFACTOR) fa il giro
// completo lato production.

// ── Bash quoting (security-critical) ────────────────────────────────
//
// _bashQuote serializza un valore in single-quote bash escape-sicuro.
// Se sbaglia, gli step provider injecterebbero comandi via env value /
// arg passato al docker exec. Test esplicito per i casi adversariali.

const { _bashQuote, _stepToRemoteCmd } = vpsInternal

test('_bashQuote: stringhe innocue restano intatte tra single quote', () => {
  assert.equal(_bashQuote('hello'), "'hello'")
  assert.equal(_bashQuote('@anthropic-ai/claude-code@latest'), "'@anthropic-ai/claude-code@latest'")
  assert.equal(_bashQuote(''), "''")
})

test('_bashQuote: chars speciali bash dentro single quote sono letterali', () => {
  // $, `, \, ", *, &, |, ;, >, <, (, ), # — tutti letterali in single quote.
  for (const s of ['$HOME', '`whoami`', 'a"b', 'a\\b', 'a*b', 'a&b', 'a;b', 'a|b', 'a>b', 'a<b', 'a#b']) {
    assert.equal(_bashQuote(s), `'${s}'`, `expected literal for ${JSON.stringify(s)}`)
  }
})

test('_bashQuote: single quote interno usa escape \\\'\\\\\\\'\\\' standard bash', () => {
  // Pattern: chiudi single, escape ', riapri single.
  assert.equal(_bashQuote("a'b"), "'a'\\''b'")
  assert.equal(_bashQuote("'"), "''\\'''")
  // Adversariale: prova a chiudere il quote per inettare un comando esterno.
  assert.equal(_bashQuote("'; rm -rf / #"), "''\\''; rm -rf / #'")
})

test('_bashQuote: numeri e non-string vengono convertiti via String()', () => {
  assert.equal(_bashQuote(42), "'42'")
  assert.equal(_bashQuote(null), "'null'")
})

test('_stepToRemoteCmd: build "docker exec -i [-e K=V]* container entrypoint args"', () => {
  const cmd = _stepToRemoteCmd({
    entrypoint: 'npm',
    args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
    env: { NPM_CONFIG_PREFIX: '/jht_home/.npm-global' },
  })
  // Tutti i token quoted, env serializzato come K=V quotato.
  assert.match(cmd, /^docker exec -i /)
  assert.match(cmd, /-e 'NPM_CONFIG_PREFIX=\/jht_home\/\.npm-global'/)
  assert.match(cmd, /'jht' 'npm' 'install' '-g' '@anthropic-ai\/claude-code@latest'/)
})

test('_stepToRemoteCmd: container override viene applicato', () => {
  const cmd = _stepToRemoteCmd(
    { entrypoint: 'sh', args: ['-c', 'echo ok'] },
    { container: 'jht-test' },
  )
  assert.match(cmd, /'jht-test' 'sh' '-c' 'echo ok'/)
})

test('_stepToRemoteCmd: env value adversariale non rompe il quoting', () => {
  // Se passassimo {FOO: "'; rm -rf /"} senza quoting safe, il bash remoto
  // eseguirebbe rm -rf /. _bashQuote deve neutralizzare il payload.
  const cmd = _stepToRemoteCmd({
    entrypoint: 'sh',
    args: ['-c', 'echo $FOO'],
    env: { FOO: "'; rm -rf / #" },
  })
  // L'env value con ' interno viene serializzato come 'FOO='\''; rm -rf / #'
  // (chiudi single, escape ', riapri single — pattern standard bash).
  // Verifica letterale dello string finale: nessun shell metachar nudo
  // sopravvive fuori dai single quote.
  assert.equal(
    cmd,
    "docker exec -i -e 'FOO='\\''; rm -rf / #' 'jht' 'sh' '-c' 'echo $FOO'",
  )
  // Sanity: l'unica '#' nel comando vive dentro un single-quote pair, non
  // come trailing comment (ssh remoto non eseguirebbe rm -rf, perche'
  // in single-quote il ; rm -rf / # e' tutto letterale).
  const trailing = cmd.endsWith("'echo $FOO'")
  assert.ok(trailing, "il comando deve terminare con il sh -c arg, non col payload adversariale")
})

test('inspectInstalledProviders detects a provider by bin-dir entry NAME (readdir path)', () => {
  // Regression: on Windows + Docker Desktop (WSL2) the in-container npm
  // symlinks surface as LX reparse points the host can readdir but NOT
  // lstat (EACCES). Detection must key off the directory entry name so
  // the provider-login step is not left empty and wrongly skippable.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jht-inspect-'))
  const binDir = path.join(home, '.npm-global', 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  // A plain entry named after a provider binary, as readdir would report
  // it (even when a per-file lstat would throw on the real host).
  const claudeBinary = PROVIDERS.claude.binary
  fs.writeFileSync(path.join(binDir, claudeBinary), '')

  const { installed } = inspectInstalledProviders({ bindHomeDir: home })
  assert.ok(installed.includes('claude'), 'claude must be detected from the bin entry')
  assert.ok(!installed.includes('codex'), 'codex must NOT be detected when absent')
  fs.rmSync(home, { recursive: true, force: true })
})

test('inspectInstalledProviders reports nothing when the bin dir is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jht-inspect-empty-'))
  const { installed } = inspectInstalledProviders({ bindHomeDir: home })
  assert.deepEqual(installed, [])
  fs.rmSync(home, { recursive: true, force: true })
})

