import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { JHT_PROFILE_DIR } from '../jht-paths.js';

// shared/skills/validate_profile.py risolto relativo a questo file:
// cli/src/commands → cli/src → cli → <repo root> → shared/skills/…
const __dirname = dirname(fileURLToPath(import.meta.url));
const VALIDATOR = join(__dirname, '../../../shared/skills/validate_profile.py');
const DEFAULT_PROFILE = join(JHT_PROFILE_DIR, 'candidate_profile.yml');

function validateAction(file, opts) {
  const target = file || DEFAULT_PROFILE;
  if (!existsSync(VALIDATOR)) {
    console.error(`✗ validatore non trovato: ${VALIDATOR}`);
    process.exitCode = 2;
    return;
  }
  const args = [VALIDATOR, target];
  if (opts.strict) args.push('--strict');
  if (opts.json) args.push('--json');
  const r = spawnSync('python3', args, { stdio: 'inherit' });
  if (r.error) {
    console.error(`✗ impossibile eseguire python3: ${r.error.message}`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = r.status ?? 0;
}

export function registerProfileCommand(program) {
  const cmd = new Command('profile').description('Profilo candidato (candidate_profile.yml)');

  cmd
    .command('validate [file]')
    .description('Valida il profilo contro lo schema canonico (default: $JHT_HOME/profile/candidate_profile.yml)')
    .option('--strict', 'tratta anche i warning (chiavi legacy) come errori')
    .option('--json', 'output JSON {ok, errors, warnings}')
    .action(validateAction);

  // default: `jht profile` → valida il profilo del workspace
  cmd.action(() => validateAction(undefined, {}));

  program.addCommand(cmd);
}
