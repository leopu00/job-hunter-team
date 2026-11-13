import { say } from './texts.js';

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
  ['Every day', ['status', 'agents', 'monitor', 'team', 'positions', 'doctor', 'logs', 'setup']],
  ['Your team', [
    'working-hours', 'cron', 'apply', 'ticket', 'feedback', 'directives', 'coordinator', 'profile',
    'artifact', 'notifications', 'standby', 'burn', 'existing-team', 'providers',
  ]],
  ['Your data', ['export', 'import', 'backup', 'report']],
  ['Maintenance', [
    'upgrade', 'migrate', 'reset', 'cache', 'tools', 'health', 'config', 'secrets', 'keyring', 'cloud',
    'container', 'sentinella', 'download',
  ]],
];

export const OTHER_GROUP = 'Other';

/** The text key of each group's title: the title above is the group's stable name, what is shown comes from the catalog. */
const GROUP_KEYS = {
  'Every day': 'help.group_every_day',
  'Your team': 'help.group_team',
  'Your data': 'help.group_data',
  'Maintenance': 'help.group_maintenance',
  [OTHER_GROUP]: 'help.group_other',
};

/** The commands of the program on the computer (the wrapper), which the program inside the container cannot list. */
export const HOST_COMMANDS = [
  ['up', 'help.host_up'],
  ['down', 'help.host_down'],
  ['restart', 'help.host_restart'],
  ['uninstall', 'help.host_uninstall'],
  ['integration', 'help.host_integration'],
];

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

/** The description of a command in the list: the catalog's, or the command's own where its language has none. */
function describeCommand(command, help) {
  const key = `cmd.${command.name()}`;
  const text = say(key);
  return text === key ? help.subcommandDescription(command) : text;
}

/** The text of `jht help`, for a terminal `width` columns wide (the same text on a pipe). */
export function renderFullHelp(program, width = 80) {
  const w = Math.max(40, Math.min(width, 100));
  const help = program.createHelp();
  const groups = groupCommands(program);
  const termOf = (c) => [c.name(), ...c.aliases()].join('|');
  const terms = groups.flatMap((g) => g.commands.map(termOf));
  const column = Math.min(Math.max(...terms.map((t) => t.length)), 26) + 2;
  const out = [say('help.usage'), '', program.description(), '', say('help.options'),
    `  -V, --version  ${say('help.version')}`, `  -h, --help     ${say('help.help')}`, ''];
  const row = (term, description) => {
    const room = w - 2 - column;
    const lines = wrap(description, room);
    if (term.length + 2 > column) {
      out.push(`  ${term}`);
      for (const line of lines) out.push(`  ${' '.repeat(column)}${line}`.trimEnd());
    } else {
      out.push(`  ${term.padEnd(column)}${lines[0]}`.trimEnd());
      for (const line of lines.slice(1)) out.push(`  ${' '.repeat(column)}${line}`);
    }
  };
  for (const { title, commands } of groups) {
    out.push(`${say(GROUP_KEYS[title] ?? 'help.group_other')}:`);
    for (const c of commands) row(termOf(c), describeCommand(c, help));
    out.push('');
  }
  out.push(say('help.host_title'));
  for (const [term, key] of HOST_COMMANDS) row(term, say(key));
  out.push('');
  out.push(say('help.one_command'), '');
  return out.join('\n');
}
