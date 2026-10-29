import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// jht team-settings: working hours and the model and effort of each role, for the desktop app.
// Synthetic config only; JHT_HOME points at a scratch folder.
const home = mkdtempSync(join(tmpdir(), 'jht-team-settings-'));
process.env.JHT_HOME = home;
const { applyResult, burstStartResult, burstStopResult, getResult, withBurst, LISTS } = await import('../src/commands/team-settings.js');
const { runSettings } = await import('../src/commands/agent-control.js');
const CONFIG = join(home, 'jht.config.json');

const base = () => ({
  active_provider: 'claude',
  team: { role_models: { scout: { model: 'luna' }, critico: { model: 'sol', effort: 'high' } } },
});
const put = (value) => writeFileSync(CONFIG, typeof value === 'string' ? value : JSON.stringify(value));
const cfg = () => JSON.parse(readFileSync(CONFIG, 'utf-8'));
const request = (settings) => JSON.stringify({ settings });
const hours = (days, start, end, timezone = 'Europe/Rome') => ({ timezone, windows: [{ days, start, end }] });

test('get: reads what the config holds, with the lists of allowed values', () => {
  put({ ...base(), team: { ...base().team, working_hours: hours(['mon', 'tue'], '09:00', '18:00') } });
  const { exit, out } = getResult();
  assert.equal(exit, 0);
  assert.equal(out.ok, true);
  assert.deepEqual(out.working_hours, hours(['mon', 'tue'], '09:00', '18:00'));
  assert.deepEqual(out.role_models, base().team.role_models);
  assert.deepEqual(out.lists.models, ['sol', 'terra', 'luna']);
  assert.deepEqual(out.lists.efforts, ['low', 'medium', 'high']);
  assert.equal(out.lists.roles.length, 10);
  assert.equal(out.lists.min_window_hours, 4);
  assert.deepEqual(out.lists, JSON.parse(JSON.stringify(LISTS)));
});

test('get: no hours is 24/7 (null) and no roles is an empty map; no team section is not an error', () => {
  put({ active_provider: 'claude' });
  const { effective, classApplies, provider, ...rest } = getResult().out;
  assert.deepEqual(rest, { ok: true, working_hours: null, role_models: {}, lists: JSON.parse(JSON.stringify(LISTS)) });
  assert.equal(provider, 'claude');
  assert.equal(classApplies, false);
  assert.equal(Object.values(effective).every((r) => r.from === 'default'), true);
});

test('get: a config that is missing, unreadable or out of the lists is an error, never a made-up default', () => {
  rmSync(CONFIG, { force: true });
  assert.deepEqual(getResult(), { exit: 1, out: { ok: false, code: 'config_missing' } });
  put('{ not json');
  assert.deepEqual(getResult(), { exit: 1, out: { ok: false, code: 'config_unreadable' } });
  put('[]');
  assert.equal(getResult().out.code, 'config_unreadable');
  put({ team: { role_models: { scout: { model: 'gpt' } } } });
  assert.equal(getResult().out.code, 'config_invalid');
  put({ team: { working_hours: hours(['mon'], '09:00', '10:00') } });
  assert.equal(getResult().out.code, 'config_invalid');
});

test('apply: writes hours and merges the roles one by one, keeps every other key, and answers with what it reads back', () => {
  put(base());
  const { exit, out } = applyResult(request({
    working_hours: hours(['mon', 'tue', 'wed', 'thu', 'fri'], '09:00', '18:00'),
    role_models: { scout: { model: 'terra', effort: 'low' }, mentor: { effort: 'medium' } },
  }));
  assert.equal(exit, 0);
  const written = cfg();
  assert.equal(written.active_provider, 'claude');
  assert.deepEqual(written.team.working_hours, hours(['mon', 'tue', 'wed', 'thu', 'fri'], '09:00', '18:00'));
  assert.deepEqual(written.team.role_models, {
    scout: { model: 'terra', effort: 'low' }, critico: { model: 'sol', effort: 'high' }, mentor: { effort: 'medium' },
  });
  assert.deepEqual(out.role_models, written.team.role_models);
  assert.deepEqual(out.working_hours, written.team.working_hours);
  if (process.platform !== 'win32') assert.equal(statSync(CONFIG).mode & 0o777, 0o600);
});

test('apply: {} puts a role back on its default and null puts the team back on 24/7', () => {
  put({ ...base(), team: { ...base().team, working_hours: hours(['sat'], '08:00', '14:00') } });
  const { out } = applyResult(request({ working_hours: null, role_models: { scout: {} } }));
  assert.equal(out.ok, true);
  assert.equal(cfg().team.working_hours, undefined);
  assert.deepEqual(cfg().team.role_models, { critico: { model: 'sol', effort: 'high' } });
  applyResult(request({ role_models: { critico: {} } }));
  assert.equal(cfg().team.role_models, undefined);
});

test('apply: one value out of the lists refuses the whole request and the config stays as it was', () => {
  const before = JSON.stringify(base());
  put(before);
  for (const settings of [
    { working_hours: hours(['mon'], '09:00', '18:00'), role_models: { scout: { model: 'gpt-5' } } },
    { role_models: { scout: { model: 'luna', effort: 'max' } } },
    { role_models: { cuoco: { model: 'luna' } } },
    { role_models: { scout: { model: 'luna', temperature: 1 } } },
    { working_hours: hours(['mon'], '09:00', '10:00') },
    { working_hours: hours(['mon'], '09:00', '09:00') },
    { working_hours: hours(['mon', 'mon'], '09:00', '18:00') },
    { working_hours: hours(['mon'], '9:00', '18:00') },
    { working_hours: hours(['mon'], '09:00', '18:00', 'Mars/Olympus') },
    { working_hours: { timezone: 'UTC', windows: [{ days: ['mon'], start: '09:00', end: '18:00' }, { days: ['mon'], start: '19:00', end: '23:30' }] } },
    { working_hours: { timezone: 'UTC', windows: [], extra: 1 } },
    { other: 1 },
    {},
    null,
    [],
  ]) {
    const result = applyResult(request(settings));
    assert.deepEqual(result, { exit: 1, out: { ok: false, code: 'value_invalid' } }, JSON.stringify(settings));
    assert.equal(readFileSync(CONFIG, 'utf-8'), before);
  }
});

test('apply: a request that is not one is refused before the config is read', () => {
  rmSync(CONFIG, { force: true });
  for (const raw of ['', 'nope', '[]', '{}', '{"settings":{},"x":1}', JSON.stringify({ settings: { role_models: {} }, host: 'x' }), `{"settings":"${'a'.repeat(70000)}"}`]) {
    assert.deepEqual(applyResult(raw), { exit: 2, out: { ok: false, code: 'request_invalid' } });
  }
  assert.equal(existsSync(CONFIG), false);
});

test('apply: a config that is missing or unreadable is refused, and nothing is created', () => {
  rmSync(CONFIG, { force: true });
  assert.equal(applyResult(request({ role_models: { scout: { model: 'luna' } } })).out.code, 'config_missing');
  assert.equal(existsSync(CONFIG), false);
  put('{ broken');
  assert.equal(applyResult(request({ role_models: { scout: { model: 'luna' } } })).out.code, 'config_unreadable');
  assert.equal(readFileSync(CONFIG, 'utf-8'), '{ broken');
});

test('the command is on the real program: get prints one JSON line, apply reads stdin', () => {
  put(base());
  const bin = fileURLToPath(new URL('../bin/jht.js', import.meta.url));
  const env = { ...process.env, JHT_HOME: home };
  const got = spawnSync(process.execPath, [bin, 'team-settings', 'get'], { env, encoding: 'utf-8' });
  assert.equal(got.status, 0, got.stderr);
  assert.equal(JSON.parse(got.stdout.trim()).ok, true);
  const applied = spawnSync(process.execPath, [bin, 'team-settings', 'apply'], {
    env, encoding: 'utf-8', input: `${request({ role_models: { analista: { model: 'terra' } } })}\n`,
  });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout.trim()).role_models.analista.model, 'terra');
  const refused = spawnSync(process.execPath, [bin, 'team-settings', 'apply'], { env, encoding: 'utf-8', input: 'nope\n' });
  assert.equal(refused.status, 2);
  assert.deepEqual(JSON.parse(refused.stdout.trim()), { ok: false, code: 'request_invalid' });
});

test.after(() => rmSync(home, { recursive: true, force: true }));

test('the panel door: `agent-control settings get|apply` gives the same answers, as {ok,error}, and takes nothing else', async () => {
  const { runSettings } = await import('../src/commands/agent-control.js');
  const run = (args, stdin = '') => {
    let printed = '';
    const exit = runSettings(args, { write: (s) => { printed += s; }, readStdin: () => stdin });
    return { exit, out: JSON.parse(printed.trim()) };
  };
  put(base());
  assert.equal(run(['get']).out.ok, true);
  const applied = run(['apply'], `${request({ role_models: { scout: { model: 'terra' } } })}\n`);
  assert.equal(applied.exit, 0);
  assert.equal(applied.out.role_models.scout.model, 'terra');
  assert.deepEqual(run(['apply'], request({ role_models: { scout: { model: 'gpt' } } })), { exit: 1, out: { ok: false, error: 'value_invalid' } });
  assert.deepEqual(run(['apply'], 'nope'), { exit: 2, out: { ok: false, error: 'request_invalid' } });
  for (const args of [[], ['wipe'], ['get', 'x'], ['apply', '--force']]) {
    assert.deepEqual(run(args), { exit: 100, out: { ok: false, error: 'agent_control_invalid' } }, JSON.stringify(args));
  }
  rmSync(CONFIG, { force: true });
  assert.equal(run(['get']).out.error, 'config_missing');
});

// ---- the model each role is really started with (provider, classApplies, effective) ----

const out = (provider, role_models = {}) => {
  put({ ...(provider ? { active_provider: provider } : {}), team: { role_models } });
  return getResult().out;
};

test('effective: with Codex the class in the config decides, and the model name follows it', () => {
  const { provider, classApplies, effective } = out('openai', { scout: { model: 'luna', effort: 'low' }, capitano: { effort: 'medium' } });
  assert.equal(provider, 'codex');
  assert.equal(classApplies, true);
  assert.deepEqual(Object.keys(effective), LISTS.roles);
  assert.deepEqual(effective.scout, { model: 'luna', modelName: 'gpt-5.6-luna', effort: 'low', from: 'config' });
  assert.deepEqual(effective.capitano, { model: 'sol', modelName: 'gpt-5.6-sol', effort: 'medium', from: 'config' });
  assert.deepEqual(effective.analista, { model: 'terra', modelName: 'gpt-5.6-terra', effort: 'high', from: 'default' });
});

test('effective: "codex" and "openai" are the same provider, "claude" and "anthropic" too', () => {
  for (const [name, provider] of [['codex', 'codex'], ['openai', 'codex'], ['claude', 'claude'], ['anthropic', 'claude'], ['kimi', 'kimi'], ['moonshot', 'kimi']]) {
    assert.equal(out(name).provider, provider, name);
  }
});

test('effective: with Claude the class is declared and not applied: the role map and the effort count', () => {
  const r = out('claude', { scout: { model: 'luna', effort: 'low' } });
  assert.equal(r.classApplies, false);
  // the launcher keeps the role map (sonnet for the scout) and still takes the effort
  assert.deepEqual(r.effective.scout, { model: 'terra', modelName: 'sonnet', effort: 'low', from: 'config' });
  assert.equal(r.effective.capitano.modelName, 'opus');
});

test('effective: Kimi and a provider the launcher does not know have no effective settings, never made-up ones', () => {
  const kimi = out('kimi', { scout: { model: 'luna' } });
  assert.equal(kimi.provider, 'kimi');
  assert.equal(kimi.classApplies, false);
  assert.equal('effective' in kimi, false);
  for (const unknown of [out('gemini'), out(null)]) {
    assert.equal('provider' in unknown, false);
    assert.equal('effective' in unknown, false);
  }
});

test('effective: an apply answers with the effective settings read back, not the ones sent', () => {
  put({ active_provider: 'codex' });
  const res = applyResult(request({ role_models: { scorer: { model: 'luna' } } })).out;
  assert.equal(res.effective.scorer.modelName, 'gpt-5.6-luna');
  assert.equal(res.effective.scorer.from, 'config');
});

// The table of defaults is a copy of the launcher's role map: run the launcher's own functions and
// compare, role by role, so a role added or moved there fails here.
test('effective: the defaults are the ones the launcher uses (get_agent_info and resolve_codex_model, run for real)', (t) => {
  const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf-8' });
  if (bash.status !== 0) return t.skip('no bash');
  const source = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '.launcher', 'start-agent.sh'), 'utf-8');
  const fn = (name) => {
    const m = source.match(new RegExp(`^${name}\\(\\) \\{.*?^\\}`, 'ms'));
    assert.ok(m, `${name} is no longer in start-agent.sh`);
    return m[0];
  };
  const { effective } = out('codex');
  for (const role of LISTS.roles) {
    const script = `${fn('get_agent_info')}\n${fn('resolve_codex_model')}\n` +
      `IFS='|' read -r _p effort alias <<< "$(get_agent_info ${role})"\n` +
      'printf "%s|%s\\n" "$(resolve_codex_model "$alias")" "$effort"';
    const run = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
    assert.equal(run.status, 0, run.stderr);
    const [modelName, effort] = run.stdout.trim().split('|');
    assert.equal(effective[role].modelName, modelName, role);
    assert.equal(effective[role].effort, effort, role);
  }
});

// «Work flat out until HH:MM»: the skill runs in the container (shared/skills/burst.py, tested by
// tests/test_burst.py); here only the shape of the call and of the answer. A fake exec stands in for it.
const UNTIL = '2026-10-30T02:00:00+00:00';
const skill = (answer, code = 0) => {
  const calls = [];
  const exec = (script, argv, opts) => {
    calls.push({ script, argv, opts });
    return { ok: true, stdout: `${typeof answer === 'string' ? answer : JSON.stringify(answer)}\n`, stderr: '', code };
  };
  return { exec, calls };
};
const running = { ok: true, burst: { active: true, until: UNTIL, untilLocal: '03:00' } };
const idle = { ok: true, burst: { active: false } };

test('burst-start: asks the skill for exactly that time, then answers with the hours the box holds and the burst', () => {
  put(base());
  const { exec, calls } = skill(running);
  const { exit, out } = burstStartResult(JSON.stringify({ until: '03:00' }), exec);
  assert.equal(exit, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, '/app/shared/skills/burst.py');
  assert.deepEqual(calls[0].argv, ['start', '--until', '03:00']);
  assert.equal(calls[0].opts.interpreter, 'python3');
  assert.deepEqual(out.burst, { active: true, until: UNTIL, untilLocal: '03:00' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.role_models, base().team.role_models);
});

test('burst-start: a request that is not exactly {"until":"HH:MM"} never reaches the skill', () => {
  put(base());
  for (const raw of ['', 'x', '[]', '{}', '{"until":"3:00"}', '{"until":"24:00"}', '{"until":"03:00","x":1}',
                     '{"until":3}', '{"until":"03:00; id"}', `{"until":"03:00","pad":"${'x'.repeat(80)}"}`]) {
    const { exec, calls } = skill(running);
    assert.deepEqual(burstStartResult(raw, exec), { exit: 2, out: { ok: false, code: 'request_invalid' } }, raw);
    assert.equal(calls.length, 0, raw);
  }
});

test('burst-start: the skill’s refusals come through as their closed code; anything else is burst_unavailable', () => {
  put(base());
  for (const code of ['until_invalid', 'until_too_soon', 'until_too_far', 'config_unreadable', 'write_failed']) {
    assert.deepEqual(burstStartResult('{"until":"03:00"}', skill({ ok: false, code }).exec),
      { exit: 1, out: { ok: false, code } });
  }
  for (const answer of [{ ok: false, code: 'rm -rf /' }, { ok: false }, 'not json', '', { ok: true },
                        { ok: true, burst: { active: true } }, { ok: true, burst: { active: true, until: 'x', untilLocal: '03:00' } },
                        { ok: true, burst: { active: false, extra: 1 } }]) {
    assert.deepEqual(burstStartResult('{"until":"03:00"}', skill(answer).exec),
      { exit: 1, out: { ok: false, code: 'burst_unavailable' } }, JSON.stringify(answer));
  }
  const down = () => ({ ok: false, stdout: '', stderr: 'no container', code: -1 });
  assert.equal(burstStartResult('{"until":"03:00"}', down).out.code, 'burst_unavailable');
});

test('burst-stop: stops, then answers with what the box holds', () => {
  put(base());
  const { exec, calls } = skill(idle);
  const { exit, out } = burstStopResult(exec);
  assert.equal(exit, 0);
  assert.deepEqual(calls.map((c) => c.argv), [['stop']]);
  assert.deepEqual(out.burst, { active: false });
  assert.deepEqual(out.role_models, base().team.role_models);
});

test('get and apply carry the burst when it can be read, and are what they were when it cannot', () => {
  put(base());
  assert.deepEqual(withBurst(getResult(), skill(running).exec).out.burst, { active: true, until: UNTIL, untilLocal: '03:00' });
  assert.deepEqual(withBurst(getResult(), skill(idle).exec).out.burst, { active: false });
  assert.deepEqual(withBurst(getResult(), skill('garbage').exec), getResult());
  assert.equal('burst' in withBurst(getResult(), skill({ ok: false, code: 'config_missing' }).exec).out, false);
  rmSync(CONFIG, { force: true });
  const { exec, calls } = skill(running);
  assert.equal(withBurst(getResult(), exec).out.code, 'config_missing');
  assert.equal(calls.length, 0);
});

test('agent-control settings: the two new verbs are the only additions, and unknown ones are still refused', () => {
  put(base());
  const run = (args, stdin, exec) => {
    let written = '';
    const exit = runSettings(args, { write: (s) => { written += s; }, readStdin: () => stdin, exec });
    return { exit, out: JSON.parse(written) };
  };
  const { exec, calls } = skill(running);
  const started = run(['burst-start'], '{"until":"03:00"}\n', exec);
  assert.equal(started.exit, 0);
  assert.equal(started.out.burst.untilLocal, '03:00');
  assert.deepEqual(calls[0].argv, ['start', '--until', '03:00']);
  const stopped = run(['burst-stop'], '', skill(idle).exec);
  assert.deepEqual(stopped.out.burst, { active: false });
  assert.deepEqual(run(['burst-start'], '{"until":"99:99"}', exec), { exit: 2, out: { ok: false, error: 'request_invalid' } });
  assert.deepEqual(run(['burst-start', 'x'], '', exec).out, { ok: false, error: 'agent_control_invalid' });
  assert.deepEqual(run(['burst'], '', exec).out, { ok: false, error: 'agent_control_invalid' });
  assert.equal(run(['get'], '', skill(running).exec).out.burst.active, true);
});
