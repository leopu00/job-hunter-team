import { Command } from 'commander';
import { runExistingTeamAdapter } from '../lib/existing-team-adapter.js';
import { digestProfileResult } from '../lib/existing-team-profile-digest.js';

function emit(result) {
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
  if (result.code !== 0) process.exitCode = result.code;
}

function profile(value) {
  return String(value || '');
}

export function registerExistingTeamCommand(program) {
  const cmd = new Command('existing-team').description('Read-only connection to an approved existing VPS team');
  cmd.command('connect')
    .requiredOption('--profile <id>', 'local profile id')
    .requiredOption('--team <id>', 'expected team id')
    .action((options) => emit(runExistingTeamAdapter({ op: 'connect', profileId: profile(options.profile), teamId: String(options.team) })));
  cmd.command('list')
    .requiredOption('--profile <id>', 'local profile id')
    .option('--status <status>', 'position status filter')
    .option('--query <text>', 'position text filter')
    .option('--limit <count>', 'maximum rows')
    .action((options) => {
      const filters = {};
      if (options.status) filters.statuses = [String(options.status)];
      if (options.query) filters.q = String(options.query);
      if (options.limit !== undefined) filters.limit = Number(options.limit);
      emit(runExistingTeamAdapter({ op: 'list', profileId: profile(options.profile), ...(Object.keys(filters).length ? { filters } : {}) }));
    });
  cmd.command('detail <id>')
    .requiredOption('--profile <id>', 'local profile id')
    .action((id, options) => emit(runExistingTeamAdapter({ op: 'detail', profileId: profile(options.profile), id: String(id) })));
  cmd.command('stats')
    .requiredOption('--profile <id>', 'local profile id')
    .description('counts by status, score distribution, sources and the dashboard\'s bounded dataset')
    .action((options) => emit(runExistingTeamAdapter({ op: 'stats', profileId: profile(options.profile) })));
  cmd.command('profile')
    .requiredOption('--profile <id>', 'local profile id')
    .option('--digest', 'print only the envelope and, for the profile file, each field present and each summary, their state, bytes, sha256 and lengths: no value and no summary name')
    .description('the candidate profile: the whitelisted fields of candidate_profile.yml and the summaries, with what was missing, dropped or cut. WITHOUT --digest stdout IS the candidate\'s personal data')
    .action((options) => {
      const result = runExistingTeamAdapter({ op: 'profile', profileId: profile(options.profile) });
      emit(options.digest ? digestProfileResult(result) : result);
    });
  cmd.command('facets')
    .requiredOption('--profile <id>', 'local profile id')
    .action((options) => emit(runExistingTeamAdapter({ op: 'facets', profileId: profile(options.profile) })));
  program.addCommand(cmd);
}
