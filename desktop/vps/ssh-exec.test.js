// desktop/vps/ssh-exec.test.js — node --test
//
// Test offline: validazione args, factory, edge cases di writeFile.
// I test integration (run/openPty/writeFile su VPS reale) sono dietro
// JHT_TEST_VPS_IP=… : `node --test desktop/vps/ssh-exec.test.js` in
// CI gira solo gli offline; il dev che ha la VPS pronta esegue
// `JHT_TEST_VPS_IP=1.2.3.4 node --test desktop/vps/ssh-exec.test.js`
// per la batteria full.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

// La factory chiama require('./index').getPrivateKeyPath() che importa
// electron. Per i test offline mockiamo `./index` PRIMA di richiedere
// ssh-exec: salviamo una privkey finta nel tmpdir e ritorniamo il path.
const FAKE_PRIV = path.join(os.tmpdir(), `jht-test-key-${process.pid}`)
fs.writeFileSync(FAKE_PRIV, 'FAKE_PRIVATE_KEY\n', { mode: 0o600 })
require.cache[require.resolve('./index')] = {
  exports: { getPrivateKeyPath: () => FAKE_PRIV },
  loaded: true,
  id: require.resolve('./index'),
  filename: require.resolve('./index'),
}

const SshExec = require('./ssh-exec')
const { sshArgs } = SshExec._internal

test('sshArgs() costruisce flag corretti per non-PTY (BatchMode=yes)', () => {
  const args = sshArgs('1.2.3.4')
  assert.deepEqual(args.slice(0, 2), ['-i', FAKE_PRIV])
  assert.ok(args.includes('StrictHostKeyChecking=no'))
  assert.ok(args.includes('UserKnownHostsFile=/dev/null'))
  assert.ok(args.includes('GlobalKnownHostsFile=/dev/null'))
  assert.ok(args.includes('BatchMode=yes'))
  assert.ok(args.includes('ConnectTimeout=15'))
  assert.equal(args.at(-1), 'root@1.2.3.4')
})

test('sshArgs() in pty mode usa -tt invece di BatchMode', () => {
  const args = sshArgs('1.2.3.4', { pty: true })
  assert.ok(args.includes('-tt'))
  assert.ok(!args.includes('BatchMode=yes'))
})

test('sshArgs() rifiuta IPv4 invalido', () => {
  assert.throws(() => sshArgs(''), /invalid ipv4/)
  assert.throws(() => sshArgs('not-an-ip'), /invalid ipv4/)
  assert.throws(() => sshArgs('999.0.0.1'), /invalid ipv4/)
  assert.throws(() => sshArgs('1.2.3.4; rm -rf /'), /invalid ipv4/)
})

test('sshArgs() trimma e accetta IPv4 valido', () => {
  const args = sshArgs(' 192.168.1.1  ')
  assert.equal(args.at(-1), 'root@192.168.1.1')
})

test('forIp() ritorna oggetto pre-bound con i 4 metodi', () => {
  const cli = SshExec.forIp('1.2.3.4')
  assert.equal(typeof cli.run, 'function')
  assert.equal(typeof cli.runStream, 'function')
  assert.equal(typeof cli.openPty, 'function')
  assert.equal(typeof cli.writeFile, 'function')
})

test('writeFile() rifiuta remotePath vuoto', () => {
  const r = SshExec.writeFile('1.2.3.4', '', 'x')
  assert.equal(r.ok, false)
  assert.match(r.err, /remotePath required/)
})

test("writeFile() rifiuta remotePath con apice singolo (quote breaking)", () => {
  const r = SshExec.writeFile('1.2.3.4', "/tmp/foo'bar", 'x')
  assert.equal(r.ok, false)
  assert.match(r.err, /single quotes/)
})

test('writeFile() rifiuta mode non-octale', () => {
  const r = SshExec.writeFile('1.2.3.4', '/tmp/x', 'x', { mode: 'rwx' })
  assert.equal(r.ok, false)
  assert.match(r.err, /invalid mode/)
})

test('run()/runStream() rifiutano IPv4 invalido senza spawn', () => {
  const r = SshExec.run('not-an-ip', 'true')
  assert.equal(r.ok, false)
  assert.equal(r.code, -1)
  assert.match(r.stderr, /invalid ipv4/)
})

// ── Integration tests (gated da JHT_TEST_VPS_IP) ────────────────────
const VPS_IP = process.env.JHT_TEST_VPS_IP
const skipIntegration = !VPS_IP

test('integration: run("echo hello") ritorna stdout=hello', { skip: skipIntegration }, () => {
  const r = SshExec.run(VPS_IP, 'echo hello')
  assert.equal(r.ok, true, `expected ok=true, got: ${JSON.stringify(r)}`)
  assert.match(r.stdout, /^hello\n?$/)
})

test('integration: writeFile() + run("cat ...") round-trip', { skip: skipIntegration }, () => {
  const target = `/tmp/jht-test-${process.pid}.txt`
  const content = `hello-from-test-${Date.now()}\n`
  const w = SshExec.writeFile(VPS_IP, target, content)
  assert.equal(w.ok, true, `write failed: ${JSON.stringify(w)}`)
  const r = SshExec.run(VPS_IP, `cat '${target}' && rm -f '${target}'`)
  assert.equal(r.ok, true)
  assert.equal(r.stdout, content)
})

test('integration: writeFile({atomic: true}) round-trip', { skip: skipIntegration }, () => {
  const target = `/tmp/jht-test-atomic-${process.pid}.txt`
  const content = `atomic-${Date.now()}\n`
  const w = SshExec.writeFile(VPS_IP, target, content, { atomic: true })
  assert.equal(w.ok, true, `atomic write failed: ${JSON.stringify(w)}`)
  const r = SshExec.run(VPS_IP, `cat '${target}' && rm -f '${target}'`)
  assert.equal(r.ok, true)
  assert.equal(r.stdout, content)
})

test('integration: runStream() emette linee in ordine', { skip: skipIntegration }, async () => {
  const lines = []
  const r = await SshExec.runStream(
    VPS_IP,
    'printf "a\\nb\\nc\\n"',
    (line) => lines.push(line)
  )
  assert.equal(r.ok, true)
  assert.deepEqual(lines, ['a', 'b', 'c'])
})

// Cleanup: rimuovi la fake key se il test owner l'ha creata
test('cleanup', () => {
  try { fs.unlinkSync(FAKE_PRIV) } catch { /* ignore */ }
})
