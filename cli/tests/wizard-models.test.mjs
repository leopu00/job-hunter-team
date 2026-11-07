import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'jht-wizard-models-'));
process.env.JHT_HOME = home;
const { summarizeExistingConfig, readConfigFileSnapshot, AI_PROVIDERS } = await import('../wizard/setup-helpers.js');
const { showSummary } = await import('../wizard/setup-steps.js');
const { ROLES } = await import('../../shared/runtime/role-models.js');
const launcher = readFileSync(join(root, '.launcher/start-agent.sh'), 'utf8');
// System32/bash.exe is a WSL shim; the launcher's Windows tests use Git Bash.
const gitBash = join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe');
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';
after(() => rmSync(home, { recursive: true }));

function functionSource(name) {
  const found = launcher.match(new RegExp(`^${name}\\(\\) \\{.*?^\\}`, 'ms'));
  assert.ok(found, `launcher function ${name} missing`);
  return found[0];
}

// Execute the actual launcher selection and provider branch, then capture the argv with a fake CLI.
function launcherArgv(role) {
  const begin = launcher.indexOf('# Override per ruolo dal config');
  const end = launcher.indexOf('# Nessun default implicito', begin);
  const provider = launcher.match(/^  openai\|codex\)\n(.*?)^    ;;$/ms);
  assert.ok(begin > -1 && end > begin && provider, 'launcher selection must not be empty');
  const capture = join(home, 'capture.mjs');
  writeFileSync(capture, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  const script = [
    'set -euo pipefail',
    'source "$1/.launcher/role-models.sh"',
    'source "$1/.launcher/spawn-lib.sh"',
    functionSource('extract_provider_info'), functionSource('jht_role_model_override'),
    'JHT_CONFIG_FILE="$2"; ROLE="$3"; MODE=default',
    'IFS="|" read -r PROVIDER AUTH_METHOD API_KEY <<< "$(extract_provider_info "$JHT_CONFIG_FILE")"',
    'IFS="|" read -r session_prefix effort model_override <<< "$(get_agent_info "$ROLE")"',
    launcher.slice(begin, end), provider[1],
    'read -r -a args <<< "$CLI_ARGS"',
    '"$4" "$5" "$CLI_BIN" "${args[@]}"',
  ].join('\n');
  const run = spawnSync(bash, ['-c', script, 'wizard-models', root.replaceAll('\\', '/'),
    join(home, 'jht.config.json').replaceAll('\\', '/'), role, process.execPath, capture], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  return JSON.parse(run.stdout.trim());
}

for (const active of ['openai', 'codex']) {
  for (const role_models of [{}, { scout: { model: 'luna', effort: 'low' }, mentor: { effort: 'medium' }, capitano: { model: 'terra' } }]) {
    test(`${active}: existing and saved summaries match actual argv for every role (${Object.keys(role_models).length} overrides)`, async () => {
      const config = { version: 1, active_provider: active,
        providers: { [active]: { name: active, model: 'gpt-4o', auth_method: 'subscription' } },
        team: { role_models } };
      writeFileSync(join(home, 'jht.config.json'), JSON.stringify(config));
      const existing = summarizeExistingConfig(readConfigFileSnapshot().config);
      const notes = [];
      await showSummary({ note: async (text) => notes.push(text) }, { selectedProvider: AI_PROVIDERS[0] });
      for (const summary of [existing, ...notes]) {
        assert.equal(summary.includes('gpt-4o'), false);
        for (const role of ROLES) {
          const argv = launcherArgv(role);
          assert.equal(argv[0], 'codex');
          const model = argv[argv.indexOf('--model') + 1];
          const effort = argv.find((arg) => arg.startsWith('model_reasoning_effort=')).split('=')[1];
          assert.ok(summary.split('\n').includes(`  ${role}: ${model} (${effort})`), `${role}: ${argv.join(' ')}`);
        }
      }
    });
  }
}

test('unknown or invalid settings do not invent effective model names', () => {
  assert.equal(summarizeExistingConfig({ active_provider: 'kimi', providers: { kimi: { model: 'unused' } } }).includes('unused'), false);
  const invalid = summarizeExistingConfig({ active_provider: 'openai', team: { role_models: { scout: { model: 'wrong' } } } });
  assert.match(invalid, /invalid team.role_models/);
  assert.equal(invalid.includes('gpt-'), false);
});
