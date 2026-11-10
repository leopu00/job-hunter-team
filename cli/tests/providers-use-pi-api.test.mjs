// `jht providers use glm|kimi` and `jht providers harness` agree with `jht setup` about the providers that run on pi with an
// API key (D5 and D7 of the 10/11 CLI test): use switches to one that is set up (and puts the harness on pi) or names the
// command that sets it up; harness codex is refused for GLM; the Pi install hint is said only when Pi is not ready.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { piReady } from '../src/commands/providers-harness.js';

const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

function home(config) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-use-pi-'));
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'glm.key'), 'finta\n');
  return dir;
}
const jht = (dir, ...args) => {
  const r = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env: { ...process.env, JHT_HOME: dir, NO_COLOR: '1', JHT_LANG: 'en' } });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, config: () => JSON.parse(readFileSync(join(dir, 'jht.config.json'), 'utf8')) };
};
const keyed = (dir, name) => ({ auth_method: 'api_key', model: 'm', api_key_ref: { type: 'ref', source: 'file', path: join(dir, 'glm.key') }, name });

test('use glm / kimi / moonshot with the key set up: the provider is active and the harness goes to pi', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jht-use-pi-'));
  writeFileSync(join(dir, 'glm.key'), 'finta\n');
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify({
    active_provider: 'openai', harness: 'codex',
    providers: { openai: { auth_method: 'subscription' }, glm: keyed(dir, 'glm'), kimi: keyed(dir, 'kimi') },
  }));
  for (const [name, expected] of [['glm', 'glm'], ['kimi', 'kimi'], ['moonshot', 'kimi']]) {
    const r = jht(dir, 'providers', 'use', name);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.config().active_provider, expected);
    assert.equal(r.config().harness, 'pi');
    assert.doesNotMatch(r.out, /archived|unrecognized/);
  }
  const again = jht(dir, 'providers', 'use', 'glm');
  assert.match(again.out, /harness: pi → pi|already active|active provider: kimi → glm/);
  // the way back to the default provider keeps working
  assert.equal(jht(dir, 'providers', 'use', 'openai').code, 0);
});

test('use glm / kimi without the key: the command that sets it up, not «archived» or «unrecognized»; nothing is written', () => {
  const dir = home({ active_provider: 'openai', harness: 'codex', providers: { openai: { auth_method: 'subscription' } } });
  for (const name of ['glm', 'kimi']) {
    const r = jht(dir, 'providers', 'use', name);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /runs only on the pi harness, with an API key/);
    assert.match(r.out, new RegExp(`jht setup --provider ${name} --harness pi`));
    assert.doesNotMatch(r.out, /archived|unrecognized|Supported/);
    assert.equal(r.config().active_provider, 'openai');
    assert.equal(r.config().harness, 'codex');
  }
});

test('harness codex is refused for GLM, with the way to pi; harness pi for it says nothing about installing Pi', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jht-use-pi-'));
  writeFileSync(join(dir, 'glm.key'), 'finta\n');
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify({ active_provider: 'glm', harness: 'pi', providers: { glm: keyed(dir, 'glm') } }));
  const refused = jht(dir, 'providers', 'harness', 'codex');
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /GLM \(Z\.ai\) runs only on the pi harness/);
  assert.equal(refused.config().harness, 'pi');
  // already on pi with its key: no «Install Pi and sign in» (it would be wrong)
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify({ active_provider: 'glm', harness: 'codex', providers: { glm: keyed(dir, 'glm') } }));
  const back = jht(dir, 'providers', 'harness', 'pi');
  assert.equal(back.code, 0, back.out);
  assert.doesNotMatch(back.out, /Install Pi and sign in to it/);
  assert.match(back.out, /harness: codex → pi/);
});

test('the Pi install hint is said only when Pi has nothing yet: no key, no login', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jht-use-pi-'));
  writeFileSync(join(dir, 'glm.key'), 'finta\n');
  assert.equal(piReady({ active_provider: 'glm', providers: { glm: keyed(dir, 'glm') } }, dir), true, 'the key of glm is all it needs');
  assert.equal(piReady({ active_provider: 'openai', providers: { openai: { auth_method: 'subscription' } } }, dir), false);
  mkdirSync(join(dir, '.pi/agent'), { recursive: true });
  writeFileSync(join(dir, '.pi/agent/auth.json'), '{}');
  assert.equal(piReady({ active_provider: 'openai', providers: { openai: { auth_method: 'subscription' } } }, dir), true, 'a login of Pi is there');
});

test('harness pi: the hint appears for openai without a login and not once Pi is logged in', () => {
  const dir = home({ active_provider: 'openai', harness: 'codex', providers: { openai: { auth_method: 'subscription' } } });
  const first = jht(dir, 'providers', 'harness', 'pi');
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /Install Pi and sign in to it/);
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify({ active_provider: 'openai', harness: 'codex', providers: { openai: { auth_method: 'subscription' } } }));
  mkdirSync(join(dir, '.pi/agent'), { recursive: true });
  writeFileSync(join(dir, '.pi/agent/auth.json'), '{}');
  const second = jht(dir, 'providers', 'harness', 'pi');
  assert.equal(second.code, 0, second.out);
  assert.doesNotMatch(second.out, /Install Pi and sign in to it/);
  assert.match(second.out, /harness: codex → pi/);
});
