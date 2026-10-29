import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAgentControl } from '../src/commands/agent-control.js';
import { AGENT_CONTROL_SCRIPT } from '../src/lib/agent-control-args.js';
import { PROVIDER_SIGNIN_SCRIPT, runProvider } from '../src/lib/provider-logout.js';

// jht agent-control provider status|logout: the door only checks the shape and runs the team's script
// (shared/skills/provider_signin.py, tested in tests/test_provider_signin.py) with that one word.
const door = (args, exec) => {
  const seen = [];
  const exit = runProvider(args, { write: (text) => seen.push(text), exec });
  return { exit, text: seen.join('') };
};
const answering = (stdout, code = 0) => {
  const calls = [];
  const exec = (script, argv, options) => {
    calls.push({ script, argv, options });
    return { ok: true, stdout, stderr: '', code };
  };
  exec.calls = calls;
  return exec;
};

test('`status` runs the script with that one word and gives its line and its exit code back unchanged, and stops nothing', () => {
  const exec = answering('{"ok":true,"provider":"codex","authenticated":true}\n');
  const { exit, text } = door(['status'], exec);
  assert.equal(exit, 0);
  assert.equal(text, '{"ok":true,"provider":"codex","authenticated":true}\n');
  assert.deepEqual(exec.calls.map((call) => [call.script, call.argv, call.options.interpreter]), [[PROVIDER_SIGNIN_SCRIPT, ['status'], 'python3']]);
  assert.equal(PROVIDER_SIGNIN_SCRIPT, '/app/shared/skills/provider_signin.py');
});

test('`logout` stops the team FIRST and only then takes the sign-in off', () => {
  const calls = [];
  const exec = (script, argv, options) => {
    calls.push([script, argv, options.interpreter]);
    return { ok: true, stdout: script === AGENT_CONTROL_SCRIPT ? '{"ok":true,"op":"stop-team","session":null,"result":"team_stopped"}\n' : '{"ok":true,"provider":"codex","authenticated":false,"removed":1}\n', stderr: '', code: 0 };
  };
  const { exit, text } = door(['logout'], exec);
  assert.equal(exit, 0);
  assert.equal(text, '{"ok":true,"provider":"codex","authenticated":false,"removed":1}\n');
  assert.deepEqual(calls, [[AGENT_CONTROL_SCRIPT, ['stop-team'], 'python3'], [PROVIDER_SIGNIN_SCRIPT, ['logout'], 'python3']]);
});

test('a stop that did not work removes nothing: the panel\'s closed answer comes back and the sign-in script is never run', () => {
  for (const [answer, code] of [['{"ok":false,"op":"stop-team","session":null,"error":"team_stop_failed"}\n', 121], ['{"ok":false,"op":"stop-team","session":null,"error":"agent_control_busy"}\n', 102]]) {
    const calls = [];
    const exec = (script) => {
      calls.push(script);
      return { ok: true, stdout: answer, stderr: '', code };
    };
    const { exit, text } = door(['logout'], exec);
    assert.equal(exit, code);
    assert.equal(text, answer);
    assert.deepEqual(calls, [AGENT_CONTROL_SCRIPT]);
  }
  // a stop that could not run at all is told as the panel tells it
  const calls = [];
  const { exit, text } = door(['logout'], (script) => {
    calls.push(script);
    return { ok: false, stdout: '', stderr: 'container is not running', code: -1 };
  });
  assert.equal(exit, 113);
  assert.deepEqual(JSON.parse(text), { ok: false, error: 'agent_control_no_team' });
  assert.deepEqual(calls, [AGENT_CONTROL_SCRIPT]);
});

test('a closed failure of the script keeps its exit code and its line', () => {
  const { exit, text } = door(['logout'], answering('{"ok":false,"error":"provider_logout_incomplete"}\n', 1));
  assert.equal(exit, 1);
  assert.equal(text, '{"ok":false,"error":"provider_logout_incomplete"}\n');
});

test('the door takes `status` or `logout` and no more: any other word, or a second one, is refused before the script', () => {
  for (const args of [[], ['reset'], ['logout', 'claude'], ['status', '--all'], ['logout', '../x'], [''], ['LOGOUT'], null, 'logout']) {
    const exec = answering('{}');
    const { exit, text } = door(args, exec);
    assert.equal(exit, 100);
    assert.deepEqual(JSON.parse(text), { ok: false, error: 'agent_control_invalid' });
    assert.equal(exec.calls.length, 0);
  }
});

test('a script that could not run is told as the panel tells it, never as a sign-out', () => {
  const gone = door(['logout'], () => ({ ok: false, stdout: '', stderr: 'container is not running', code: -1 }));
  assert.equal(gone.exit, 113);
  assert.deepEqual(JSON.parse(gone.text), { ok: false, error: 'agent_control_no_team' });
  const mute = door(['logout'], () => ({ ok: false, stdout: '', stderr: 'timed out', code: -1 }));
  assert.equal(mute.exit, 114);
  assert.deepEqual(JSON.parse(mute.text), { ok: false, error: 'agent_control_unanswered' });
});

test('agent-control routes `provider` to this door and to nothing else', () => {
  const seen = [];
  const exit = runAgentControl(['provider', 'bogus'], { write: (text) => seen.push(text), exec: () => assert.fail('no script') });
  assert.equal(exit, 100);
  assert.deepEqual(JSON.parse(seen.join('')), { ok: false, error: 'agent_control_invalid' });
  const exec = answering('{"ok":true,"provider":"claude","authenticated":false}\n');
  const out = [];
  assert.equal(runAgentControl(['provider', 'status'], { write: (text) => out.push(text), exec }), 0);
  assert.equal(exec.calls[0].script, PROVIDER_SIGNIN_SCRIPT);
});

test('the boot check and the onboarding snapshot only READ the credential files: nothing copies a sign-in back', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pid1 = readFileSync(join(root, 'cli/src/commands/pid1.js'), 'utf-8');
  const check = pid1.split('async function hasProviderCredentials()')[1].split('\n}\n')[0];
  assert.match(check, /access\(/);
  for (const write of ['writeFile', 'copyFile', 'rename', 'symlink', 'link(', 'cp(', 'appendFile', 'open(']) {
    assert.ok(!check.includes(write), write);
  }
  const wrapper = readFileSync(join(root, 'scripts/jht-wrapper.sh'), 'utf-8');
  const snapshot = wrapper.split('const markers={claude:')[1].slice(0, 600);
  assert.match(snapshot, /existsSync/);
  for (const write of ['writeFile', 'copyFile', 'renameSync', 'symlinkSync', 'appendFile']) {
    assert.ok(!snapshot.includes(write), write);
  }
});
