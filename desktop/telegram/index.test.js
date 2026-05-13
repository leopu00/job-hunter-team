// desktop/telegram/index.test.js — node --test
//
// Offline tests for the Telegram bot helper module:
//   - verifyBot input validation + SKIP_VERIFY shortcut
//   - waitForFirstChat SKIP_VERIFY shortcut + cancellation
//   - saveBotsToVps argument validation
//
// The end-to-end save against a real VPS is exercised manually via:
//
//   JHT_TELEGRAM_SKIP_VERIFY=1 \
//   JHT_SSH_KEY_PATH=$HOME/Library/Application\ Support/jht-desktop/ssh/jht_ed25519 \
//   node -e "require('./desktop/telegram').saveBotsToVps('203.0.113.30', { … })"
//
// (already verified during T4 development against the test VPS used by
// dev1's T1 integration suite; gating it here behind env vars would
// duplicate ssh-exec.test.js without adding signal.)

const test = require('node:test')
const assert = require('node:assert/strict')

// SKIP_VERIFY is read once at module load; flip it BEFORE require so all
// downstream tests see the bypass path.
process.env.JHT_TELEGRAM_SKIP_VERIFY = '1'

const tg = require('./index')

test('verifyBot rejects empty / whitespace tokens', async () => {
  for (const t of ['', '   ', null, undefined]) {
    const r = await tg.verifyBot(t)
    assert.equal(r.ok, false, `expected reject for ${JSON.stringify(t)}`)
    assert.equal(r.error, 'token-empty')
  }
})

test('verifyBot SKIP_VERIFY: rejects malformed token shape', async () => {
  for (const t of ['abc', '111:short', '111-AAAAAAAAAAAAAAAAAAAA', '111:bad chars in here']) {
    const r = await tg.verifyBot(t)
    assert.equal(r.ok, false, `expected reject for ${JSON.stringify(t)}`)
    assert.equal(r.error, 'token-syntax-invalid')
  }
})

test('verifyBot SKIP_VERIFY: accepts well-formed token + synthesises username', async () => {
  const token = '12345:AAAA_aaaaaaaaaaaaaaaaaaaa'
  const r = await tg.verifyBot(token)
  assert.equal(r.ok, true)
  assert.equal(r.skipped, true)
  assert.equal(r.botId, 12345)
  assert.match(r.username, /^jht_test_.{6}_bot$/)
  assert.equal(r.name, r.username)
})

test('waitForFirstChat SKIP_VERIFY: stable synthetic chat_id derived from token', async () => {
  const token = '987654:BBBB_bbbbbbbbbbbbbbbbbbbb'
  const r = await tg.waitForFirstChat(token, 1000)
  assert.equal(r.ok, true)
  assert.equal(r.skipped, true)
  assert.match(r.chatId, /^900\d{6}$/)
  // Determinism: the synthesis is pure on the numeric prefix.
  const r2 = await tg.waitForFirstChat(token, 1000)
  assert.equal(r2.chatId, r.chatId)
})

test('waitForFirstChat: rejects empty token', async () => {
  const r = await tg.waitForFirstChat('', 1000)
  assert.equal(r.ok, false)
  assert.equal(r.error, 'token-empty')
})

test('cancelWaitForFirstChat: returns ok:true even when no poll is in flight', () => {
  const r = tg.cancelWaitForFirstChat('11:BBBBBBBBBBBBBBBBBBBBBBBB')
  assert.equal(r.ok, true)
  assert.equal(r.cancelled, false)
})

test('saveBotsToVps: rejects missing vpsIp', async () => {
  const r = await tg.saveBotsToVps(null, { assistente: { token: 'x', chatId: 'y' } })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'vps-ip-missing')
})

test('saveBotsToVps: rejects missing bots arg', async () => {
  const r = await tg.saveBotsToVps('1.2.3.4', null)
  assert.equal(r.ok, false)
  assert.equal(r.error, 'bots-missing')
})

// Integration with a real VPS is deliberately not duplicated here — see
// ssh-exec.test.js's gated-integration suite, plus the manual one-liner
// in the file header. Those exercises the full read/merge/atomic-write
// path on a Hetzner host; an offline mock would only test the JSON
// merge logic, which is trivially obvious from the function body.
