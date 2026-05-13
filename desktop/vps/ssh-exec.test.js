// desktop/vps/ssh-exec.test.js — node --test
//
// Test offline: validazione args, cascata keyPath, factory, edge cases
// di writeFile. Niente mock di require.cache: la nuova API accetta
// `opts.keyPath` esplicito (priorita' 1) o legge `JHT_SSH_KEY_PATH`
// (priorita' 2), quindi i test funzionano fuori da Electron senza
// trucchi.
//
// I test integration (run/openPty/writeFile su VPS reale) sono dietro
// JHT_TEST_VPS_IP=… + JHT_SSH_KEY_PATH=… :
//
//   JHT_TEST_VPS_IP=203.0.113.30 \
//   JHT_SSH_KEY_PATH=$HOME/Library/Application\ Support/Job\ Hunter\ Team/ssh/jht_ed25519 \
//     node --test desktop/vps/ssh-exec.test.js
//
// In CI/dev senza VPS questi 4 saltano automaticamente con motivo
// scritto a video.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const SshExec = require('./ssh-exec')
const { sshArgs, readPrivKeyPath } = SshExec._internal

// Path "fake" per i test offline: solo path syntax, non una vera key.
// I test che spawn-ano davvero ssh sono integration e usano
// process.env.JHT_SSH_KEY_PATH (key reale dell'utente).
const FAKE_KEYPATH = path.join(os.tmpdir(), `jht-test-key-path-${process.pid}`)

test('sshArgs() costruisce flag corretti per non-PTY (BatchMode=yes)', () => {
  const args = sshArgs('1.2.3.4', { keyPath: FAKE_KEYPATH })
  assert.deepEqual(args.slice(0, 2), ['-i', FAKE_KEYPATH])
  assert.ok(args.includes('StrictHostKeyChecking=no'))
  assert.ok(args.includes('UserKnownHostsFile=/dev/null'))
  assert.ok(args.includes('GlobalKnownHostsFile=/dev/null'))
  assert.ok(args.includes('BatchMode=yes'))
  assert.ok(args.includes('ConnectTimeout=15'))
  assert.equal(args.at(-1), 'root@1.2.3.4')
})

test('sshArgs() in pty mode usa -tt invece di BatchMode', () => {
  const args = sshArgs('1.2.3.4', { pty: true, keyPath: FAKE_KEYPATH })
  assert.ok(args.includes('-tt'))
  assert.ok(!args.includes('BatchMode=yes'))
})

test('sshArgs() rifiuta IPv4 invalido', () => {
  assert.throws(() => sshArgs('', { keyPath: FAKE_KEYPATH }), /invalid ipv4/)
  assert.throws(() => sshArgs('not-an-ip', { keyPath: FAKE_KEYPATH }), /invalid ipv4/)
  assert.throws(() => sshArgs('999.0.0.1', { keyPath: FAKE_KEYPATH }), /invalid ipv4/)
  assert.throws(() => sshArgs('1.2.3.4; rm -rf /', { keyPath: FAKE_KEYPATH }), /invalid ipv4/)
})

test('sshArgs() trimma e accetta IPv4 valido', () => {
  const args = sshArgs(' 192.168.1.1  ', { keyPath: FAKE_KEYPATH })
  assert.equal(args.at(-1), 'root@192.168.1.1')
})

test('readPrivKeyPath() priorita: opts.keyPath vince', () => {
  const previous = process.env.JHT_SSH_KEY_PATH
  process.env.JHT_SSH_KEY_PATH = '/from/env'
  try {
    assert.equal(readPrivKeyPath('/from/opts'), '/from/opts')
  } finally {
    if (previous === undefined) delete process.env.JHT_SSH_KEY_PATH
    else process.env.JHT_SSH_KEY_PATH = previous
  }
})

test('readPrivKeyPath() priorita: env JHT_SSH_KEY_PATH se opts mancante', () => {
  const previous = process.env.JHT_SSH_KEY_PATH
  process.env.JHT_SSH_KEY_PATH = '/from/env'
  try {
    assert.equal(readPrivKeyPath(), '/from/env')
    assert.equal(readPrivKeyPath(undefined), '/from/env')
    assert.equal(readPrivKeyPath(''), '/from/env') // empty string treated as missing
  } finally {
    if (previous === undefined) delete process.env.JHT_SSH_KEY_PATH
    else process.env.JHT_SSH_KEY_PATH = previous
  }
})

test('readPrivKeyPath() throw esplicito quando ne env ne electron disponibili', () => {
  const previous = process.env.JHT_SSH_KEY_PATH
  delete process.env.JHT_SSH_KEY_PATH
  try {
    assert.throws(
      () => readPrivKeyPath(),
      /cannot resolve SSH private key path|opts\.keyPath|JHT_SSH_KEY_PATH/
    )
  } finally {
    if (previous !== undefined) process.env.JHT_SSH_KEY_PATH = previous
  }
})

test('forIp() ritorna oggetto pre-bound con i 4 metodi', () => {
  const cli = SshExec.forIp('1.2.3.4')
  assert.equal(typeof cli.run, 'function')
  assert.equal(typeof cli.runStream, 'function')
  assert.equal(typeof cli.openPty, 'function')
  assert.equal(typeof cli.writeFile, 'function')
})

test('forIp(ip, {keyPath}) eredita keyPath nelle call', () => {
  // Usiamo run() reale ma con un IP non raggiungibile + keyPath
  // inesistente: ssh fallira', ma l'errore deve essere "Permission
  // denied" / "No such file or directory" sul keyPath dato (= la
  // cascata ha funzionato), NON "cannot resolve SSH private key path".
  const cli = SshExec.forIp('127.0.0.1', { keyPath: '/nonexistent/path/key' })
  const r = cli.run('echo x', { timeout: 3000 })
  // ssh stamperà qualcosa tipo: "Warning: Identity file /nonexistent/...
  // not accessible: No such file or directory" e poi fallisce auth.
  // L'importante per questo test: NON dobbiamo ricevere il throw
  // della cascata, quindi r.ok=false ma r.stderr non contiene il
  // marker "cannot resolve".
  assert.equal(r.ok, false)
  assert.doesNotMatch(r.stderr, /cannot resolve SSH private key path/)
})

test('writeFile() rifiuta remotePath vuoto', () => {
  const r = SshExec.writeFile('1.2.3.4', '', 'x', { keyPath: FAKE_KEYPATH })
  assert.equal(r.ok, false)
  assert.match(r.err, /remotePath required/)
})

test("writeFile() rifiuta remotePath con apice singolo (quote breaking)", () => {
  const r = SshExec.writeFile('1.2.3.4', "/tmp/foo'bar", 'x', { keyPath: FAKE_KEYPATH })
  assert.equal(r.ok, false)
  assert.match(r.err, /single quotes/)
})

test('writeFile() rifiuta mode non-octale', () => {
  const r = SshExec.writeFile('1.2.3.4', '/tmp/x', 'x', { keyPath: FAKE_KEYPATH, mode: 'rwx' })
  assert.equal(r.ok, false)
  assert.match(r.err, /invalid mode/)
})

test('run() rifiuta IPv4 invalido senza spawn', () => {
  const r = SshExec.run('not-an-ip', 'true', { keyPath: FAKE_KEYPATH })
  assert.equal(r.ok, false)
  assert.equal(r.code, -1)
  assert.match(r.stderr, /invalid ipv4/)
})

// ── Integration tests (gated da JHT_TEST_VPS_IP + JHT_SSH_KEY_PATH) ─
const VPS_IP = process.env.JHT_TEST_VPS_IP
const VPS_KEY = process.env.JHT_SSH_KEY_PATH
const skipIntegration = !VPS_IP || !VPS_KEY
const skipReason = !VPS_IP
  ? 'JHT_TEST_VPS_IP not set'
  : !VPS_KEY
  ? 'JHT_SSH_KEY_PATH not set (need a real key path for integration)'
  : null
if (skipIntegration && (VPS_IP || VPS_KEY)) {
  // partial setup: avvisa l'utente cosa manca
  // eslint-disable-next-line no-console
  console.log(`[ssh-exec.test] integration SKIP: ${skipReason}`)
}

test('integration: run("echo hello") ritorna stdout=hello', { skip: skipIntegration }, () => {
  const r = SshExec.run(VPS_IP, 'echo hello', { keyPath: VPS_KEY })
  assert.equal(r.ok, true, `expected ok=true, got: ${JSON.stringify(r)}`)
  assert.match(r.stdout, /^hello\n?$/)
})

test('integration: writeFile() + run("cat ...") round-trip', { skip: skipIntegration }, () => {
  const target = `/tmp/jht-test-${process.pid}.txt`
  const content = `hello-from-test-${Date.now()}\n`
  const w = SshExec.writeFile(VPS_IP, target, content, { keyPath: VPS_KEY })
  assert.equal(w.ok, true, `write failed: ${JSON.stringify(w)}`)
  const r = SshExec.run(VPS_IP, `cat '${target}' && rm -f '${target}'`, { keyPath: VPS_KEY })
  assert.equal(r.ok, true)
  assert.equal(r.stdout, content)
})

test('integration: writeFile({atomic: true}) round-trip', { skip: skipIntegration }, () => {
  const target = `/tmp/jht-test-atomic-${process.pid}.txt`
  const content = `atomic-${Date.now()}\n`
  const w = SshExec.writeFile(VPS_IP, target, content, { keyPath: VPS_KEY, atomic: true })
  assert.equal(w.ok, true, `atomic write failed: ${JSON.stringify(w)}`)
  const r = SshExec.run(VPS_IP, `cat '${target}' && rm -f '${target}'`, { keyPath: VPS_KEY })
  assert.equal(r.ok, true)
  assert.equal(r.stdout, content)
})

test('integration: runStream() emette linee in ordine', { skip: skipIntegration }, async () => {
  const lines = []
  const r = await SshExec.runStream(
    VPS_IP,
    'printf "a\\nb\\nc\\n"',
    (line) => lines.push(line),
    { keyPath: VPS_KEY }
  )
  assert.equal(r.ok, true)
  assert.deepEqual(lines, ['a', 'b', 'c'])
})

test('integration: forIp(ip, {keyPath}) eredita key in tutte le call', { skip: skipIntegration }, () => {
  const cli = SshExec.forIp(VPS_IP, { keyPath: VPS_KEY })
  const r = cli.run('uname -a')
  assert.equal(r.ok, true, `expected ok=true via forIp default, got: ${JSON.stringify(r)}`)
  assert.match(r.stdout, /Linux/)
})
