// `jht providers use claude|kimi` and `jht providers harness` agree with `jht setup` about the providers that run on pi with an
// API key (D5 and D7 of the 10/11 CLI test): use switches to one that is set up (and puts the harness on pi) or names the
// command that sets it up; harness codex is refused for Claude; the Pi install hint is said only when Pi is not ready.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { piReady } from '../src/commands/providers-harness.js';
import { RELEASE_PROVIDERS, offeredInRelease, offersSentence } from '../../shared/runtime/release-providers.js';

const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

function home(config) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-use-pi-'));
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'claude.key'), 'finta\n');
  return dir;
}
const jht = (dir, ...args) => {
  const r = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env: { ...process.env, JHT_HOME: dir, NO_COLOR: '1', JHT_LANG: 'en' } });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, config: () => JSON.parse(readFileSync(join(dir, 'jht.config.json'), 'utf8')) };
};
const keyed = (dir, name) => ({ auth_method: 'api_key', model: 'm', api_key_ref: { type: 'ref', source: 'file', path: join(dir, 'claude.key') }, name });

test('use claude / kimi / moonshot with the key set up: the provider is active and the harness goes to pi', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jht-use-pi-'));
  writeFileSync(join(dir, 'claude.key'), 'finta\n');
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify({
    active_provider: 'openai', harness: 'codex',
    providers: { openai: { auth_method: 'subscription' }, claude: keyed(dir, 'claude'), kimi: keyed(dir, 'kimi') },
  }));
  for (const [name, expected] of [['claude', 'claude'], ['kimi', 'kimi'], ['moonshot', 'kimi']].filter(([n]) => offeredInRelease(n))) {
    const r = jht(dir, 'providers', 'use', name);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.config().active_provider, expected);
    assert.equal(r.config().harness, 'pi');
    assert.doesNotMatch(r.out, /archived|unrecognized/);
  }
  const again = jht(dir, 'providers', 'use', 'claude');
  assert.match(again.out, /harness: pi → pi|already active|active provider: kimi → claude/);
  // a service this release does not offer cannot be chosen, and the config is not touched
  // OpenAI with a key on pi: without its key, the command that sets it up (and nothing is written)
  const openai = jht(dir, 'providers', 'use', 'openai');
  assert.equal(openai.code, 1, openai.out);
  assert.match(openai.out, /OpenAI runs on the pi harness, with an API key\. Set it up with: jht setup --provider openai --harness pi/);
  assert.equal(openai.config().active_provider, 'claude');
  for (const name of ['openai', 'codex', 'claude', 'kimi', 'moonshot'].filter((n) => !offeredInRelease(n))) {
    const refused = jht(dir, 'providers', 'use', name);
    assert.equal(refused.code, 1, name);
    assert.match(refused.out, new RegExp(`provider '${name}' is not offered in this release \\(offered: ${offersSentence()}\\)\\. Set it up with: jht setup`));
    assert.equal(refused.config().active_provider, 'claude');
  }
});

test('use claude / kimi without the key: the command that sets it up, never «Supported: codex»; nothing is written', () => {
  const dir = home({ active_provider: 'openai', harness: 'codex', providers: { openai: { auth_method: 'subscription' } } });
  for (const name of ['claude', 'kimi'].filter((n) => offeredInRelease(n))) {
    const r = jht(dir, 'providers', 'use', name);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /runs only on the pi harness, with an API key/);
    assert.match(r.out, new RegExp(`jht setup --provider ${name} --harness pi`));
    // Kimi's own CLI is archived and it says so, but it never says «Supported: codex»: the way that works comes with it
    assert.doesNotMatch(r.out, /unrecognized|Supported/);
    assert.equal(r.config().active_provider, 'openai');
    assert.equal(r.config().harness, 'codex');
  }
});

test('harness codex is refused for Claude, with the way to pi; harness pi for it says nothing about installing Pi', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jht-use-pi-'));
  writeFileSync(join(dir, 'claude.key'), 'finta\n');
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify({ active_provider: 'claude', harness: 'pi', providers: { claude: keyed(dir, 'claude') } }));
  const refused = jht(dir, 'providers', 'harness', 'codex');
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /harness 'codex' is not offered in this release for claude: the agents run on pi with an API key/);
  assert.equal(refused.config().harness, 'pi');
  // already on pi with its key: no «Install Pi and sign in» (it would be wrong)
  writeFileSync(join(dir, 'jht.config.json'), JSON.stringify({ active_provider: 'claude', harness: 'codex', providers: { claude: keyed(dir, 'claude') } }));
  const back = jht(dir, 'providers', 'harness', 'pi');
  assert.equal(back.code, 0, back.out);
  assert.doesNotMatch(back.out, /Install Pi and sign in to it/);
  assert.match(back.out, /harness: codex → pi/);
});

test('the Pi install hint is said only when Pi has nothing yet: no key, no login', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jht-use-pi-'));
  writeFileSync(join(dir, 'claude.key'), 'finta\n');
  assert.equal(piReady({ active_provider: 'claude', providers: { claude: keyed(dir, 'claude') } }, dir), true, 'the key of claude is all it needs');
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

test('harness pi on a team with the ChatGPT subscription: a way of this release (Pi\'s own sign-in), said as such; codex with it is refused with the way that is', () => {
  const dir = home({ active_provider: 'openai', providers: { openai: { name: 'openai', auth_method: 'subscription', model: 'm' } } });
  const pi = jht(dir, 'providers', 'harness', 'pi');
  assert.equal(pi.code, 0, pi.out);
  assert.equal(pi.config().harness, 'pi');
  // the same team is now a way of this release: start, doctor and status no longer call it «not offered»
  const status = jht(dir, 'status');
  assert.doesNotMatch(status.out, /not offered in this release/);
  const back = jht(dir, 'providers', 'harness', 'codex');
  assert.equal(back.code, 1, back.out);
  assert.match(back.out, /harness 'codex' is not offered in this release for openai: the agents run on pi with an API key or pi with the ChatGPT subscription/);
  assert.equal(back.config().harness, 'pi');
});

test('harness pi on a team with a key keeps the words of the refusal for a way that is not offered (claude with a subscription)', () => {
  const dir = home({ active_provider: 'claude', providers: { claude: { name: 'claude', auth_method: 'subscription', model: 'm' } } });
  const r = jht(dir, 'providers', 'harness', 'pi');
  assert.equal(r.code, 1, r.out);
  assert.equal(r.config().harness, undefined);
});
