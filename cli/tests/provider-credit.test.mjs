// An account with no credit left (Z.ai 429 code 1113, collaudo Linux of 12/11) is said by jht doctor, jht team start and
// jht team send, not only inside the pi session: the reading is shared/skills/provider_credit.py on the pi sessions.
// Synthetic homes and sessions only: no provider is called.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

process.env.JHT_LANG = 'en';
const { creditGone, creditNotice } = await import('../src/lib/provider-credit.js');
const JHT = fileURLToPath(new URL('../bin/jht.js', import.meta.url));
const ZAI_1113 = '429 {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}';
const KEY = ['synthetic', 'key', '0123456789', 'abcdef'].join('-');

function home(rows = []) {
  const root = mkdtempSync(join(tmpdir(), 'jht-credit-'));
  const folder = join(root, '.pi', 'agent', 'sessions', '--jht_home-agents-assistente--');
  mkdirSync(folder, { recursive: true });
  const lines = [{ type: 'session', id: 's-1', cwd: '/jht_home/agents/assistente' },
    ...rows.map(([offsetS, stopReason, errorMessage]) => ({ type: 'message', timestamp: new Date(Date.now() + offsetS * 1000).toISOString(),
      message: { role: 'assistant', provider: 'zai', model: 'glm-5.3', stopReason, ...(errorMessage ? { errorMessage } : {}),
        usage: stopReason === 'stop' ? { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } }
          : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } }))];
  writeFileSync(join(folder, '2026-11-12T00-00-00-000Z_synthetic.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return root;
}

test('a refused call that says «no credit», with no call passed since, is found with the name the person knows', () => {
  const found = creditGone({ home: home([[-600, 'stop'], [-120, 'error', ZAI_1113]]) });
  assert.deepEqual([found.provider, found.label, found.agent], ['zai', 'GLM (Z.ai)', 'assistente']);
  // older than the half hour of the brake, still within the day of the commands: an empty balance stays empty
  assert.equal(creditGone({ home: home([[-2 * 3600, 'error', ZAI_1113]]) }).label, 'GLM (Z.ai)');
  assert.match(creditNotice({ home: home([[-60, 'error', ZAI_1113]]) }), /^The credit on GLM \(Z\.ai\) is used up: the agents cannot answer\. Top it up/);
});

test('a call that went through after it, a plain rate limit, an empty home and a reading that fails are no verdict', () => {
  assert.equal(creditGone({ home: home([[-120, 'error', ZAI_1113], [-30, 'stop']]) }), null);
  assert.equal(creditGone({ home: home([[-60, 'error', '429 Rate limit reached for requests']]) }), null);
  assert.equal(creditGone({ home: home() }), null);
  assert.equal(creditGone({ home: home([[-60, 'error', ZAI_1113]]), run: () => ({ status: 1, stdout: '' }) }), null);
  assert.equal(creditGone({ run: () => ({ status: 0, stdout: 'not json' }) }), null);
  assert.equal(creditGone({ run: () => { throw new Error('no python3'); } }), null);
  assert.equal(creditNotice({ run: () => ({ status: 0, stdout: 'null' }) }), null);
});

test('jht doctor says the credit is gone, with the provider and the top-up, where it used to say nothing', () => {
  const root = home([[-60, 'error', ZAI_1113]]);
  const keyFile = join(root, 'glm.key');
  writeFileSync(keyFile, `${KEY}\n`, { mode: 0o600 });
  writeFileSync(join(root, 'jht.config.json'), JSON.stringify({ version: 4, active_provider: 'glm', harness: 'pi',
    providers: { glm: { auth_method: 'api_key', model: 'glm-5.3', api_key_ref: { source: 'file', path: keyFile } } } }));
  const doctor = () => {
    const r = spawnSync(process.execPath, [JHT, 'doctor'], { encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, JHT_HOME: root, JHT_LANG: 'en', NO_COLOR: '1' } });
    return `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
  };
  const out = doctor();
  assert.match(out, /Provider: glm \(glm-5\.3\) — the credit on GLM \(Z\.ai\) is used up: the agents get no answer/);
  assert.match(out, /Top it up on the provider's site/);
  assert.equal(out.includes(KEY), false);
  // the same home after a call that passed: the ordinary line again
  writeFileSync(join(root, '.pi/agent/sessions/--jht_home-agents-assistente--/2026-11-12T00-00-00-000Z_synthetic.jsonl'),
    [{ type: 'session', id: 's-1', cwd: '/jht_home/agents/assistente' }, { type: 'message', timestamp: new Date().toISOString(),
      message: { role: 'assistant', provider: 'zai', model: 'glm-5.3', stopReason: 'stop',
        usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } } } }].map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.doesNotMatch(doctor(), /credit/);
});
