/**
 * The long list of `jht help`: commands in groups a person can read, without the ones that do nothing.
 *
 * Commander lists the commands in the order they were registered, 53 of them, among which six that only say
 * "not implemented" or "deprecated" and three that exist for the desktop app ("not for typing"). Here they are
 * grouped by what the person is doing, the dead and the machine-only ones are left out of the list (they still
 * run, for the scripts that call them, and `jht <command> --help` still answers), and the descriptions are
 * wrapped to the width of the terminal.
 *
 * A command that is in no group lands in "Other": a test fails on it, so a new command has to be placed.
 */

/** Commands that stay registered but are not listed: retired, not implemented, or the app's own channels. */
export const HIDDEN_COMMANDS = new Set([
  // do nothing any more
  'plugins', 'templates', 'context', 'hooks', 'webhooks', 'dashboard', 'stats', 'sessions',
  // channels of the desktop app / the container, "not for typing"
  'agent-control', 'state-stream', 'team-settings', 'pid1', 'help',
]);

/** [title, names] in the order they are shown. */
export const HELP_GROUPS = [
  ['Every day', ['status', 'agents', 'team', 'positions', 'doctor', 'logs', 'setup']],
  ['Your team', [
    'working-hours', 'cron', 'apply', 'ticket', 'feedback', 'directives', 'coordinator', 'profile',
    'artifact', 'notifications', 'standby', 'burn', 'existing-team', 'providers',
  ]],
  ['Your data', ['export', 'import', 'backup', 'report']],
  ['Maintenance', [
    'upgrade', 'migrate', 'reset', 'cache', 'tools', 'health', 'config', 'secrets', 'keyring', 'cloud',
    'container', 'sentinella', 'download', 'game', 'gui',
  ]],
];

export const OTHER_GROUP = 'Other';

/** The visible commands of a program with the group each belongs to. */
export function groupCommands(program) {
  const byName = new Map(program.commands.filter((c) => !HIDDEN_COMMANDS.has(c.name())).map((c) => [c.name(), c]));
  const groups = [];
  for (const [title, names] of HELP_GROUPS) {
    const commands = names.flatMap((name) => (byName.has(name) ? [byName.get(name)] : []));
    for (const c of commands) byName.delete(c.name());
    if (commands.length) groups.push({ title, commands });
  }
  if (byName.size) groups.push({ title: OTHER_GROUP, commands: [...byName.values()] });
  return groups;
}

function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** The text of `jht help`, for a terminal `width` columns wide (the same text on a pipe). */
export function renderFullHelp(program, width = 80) {
  const w = Math.max(40, Math.min(width, 100));
  const help = program.createHelp();
  const groups = groupCommands(program);
  const termOf = (c) => [c.name(), ...c.aliases()].join('|');
  const terms = groups.flatMap((g) => g.commands.map(termOf));
  const column = Math.min(Math.max(...terms.map((t) => t.length)), 26) + 2;
  const out = ['Usage: jht [options] [command]', '', program.description(), '', 'Options:',
    '  -V, --version  output the version number', '  -h, --help     display help for command', ''];
  for (const { title, commands } of groups) {
    out.push(`${title}:`);
    for (const c of commands) {
      const term = termOf(c);
      const room = w - 2 - column;
      const lines = wrap(help.subcommandDescription(c), room);
      if (term.length + 2 > column) {
        out.push(`  ${term}`);
        for (const line of lines) out.push(`  ${' '.repeat(column)}${line}`.trimEnd());
      } else {
        out.push(`  ${term.padEnd(column)}${lines[0]}`.trimEnd());
        for (const line of lines.slice(1)) out.push(`  ${' '.repeat(column)}${line}`);
      }
    }
    out.push('');
  }
  out.push('Help for one command: jht <command> --help', '');
  return out.join('\n');
}
