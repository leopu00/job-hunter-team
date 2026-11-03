import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { JHT_HOME } from '../jht-paths.js';
import { AGENTS, isAgentSession } from './team/agents.js';
import { fetchLatestRelease, updateNotice } from '../lib/release-check.js';
import pkg from '../../package.json' with { type: 'json' };
import { c } from './_colors.js';
import { hint, keyValues, marks, statusLine, title } from '../lib/ui.js';

const CONFIG_DIR = JHT_HOME;
const CONFIG_FILE = join(CONFIG_DIR, 'jht.config.json');

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getTmuxSessions() {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function handleStatus(options) {
  const facts = [['Version', pkg.version]];
  let config = null;
  if (await fileExists(CONFIG_FILE)) {
    try { config = JSON.parse(await readFile(CONFIG_FILE, 'utf-8')); } catch { config = false; }
  }
  const provConfig = config ? config.providers?.[config.active_provider] : null;
  const tgBots = config ? config.channels?.telegram?.bots : null;

  // Team sessions. The container's sessions are CAPITANO / SCOUT-1 / ASSISTENTE and the old host path puts JHT-
  // in front: both are recognised, or a working team would read as "0".
  const sessions = getTmuxSessions().filter((s) => s.startsWith('lab-') || AGENTS.some((agent) => isAgentSession(s, agent)));
  const notice = options.json ? null : updateNotice(pkg.version, await fetchLatestRelease());

  if (options.json) {
    console.log(JSON.stringify({
      version: pkg.version,
      configured: Boolean(config),
      provider: config ? { id: config.active_provider ?? null, model: provConfig?.model ?? null, auth: provConfig?.auth_method ?? null } : null,
      sessions,
    }, null, 2));
    return;
  }

  console.log(title('Status'));
  if (config) {
    facts.push(['Provider', config.active_provider ? `${config.active_provider}${provConfig?.model ? ` (${provConfig.model})` : ''}` : 'not set']);
    if (provConfig?.auth_method) facts.push(['Sign-in', provConfig.auth_method]);
    if (config.workspace) facts.push(['Workspace', config.workspace]);
    if (tgBots) {
      const n = ['assistente', 'capitano', 'mentor'].filter((r) => tgBots?.[r]?.bot_token).length;
      facts.push(['Telegram', n === 3 ? '3 bots configured' : `incomplete (${n} of 3 bots)`]);
    }
  } else {
    facts.push(['Configuration', config === false ? 'unreadable' : 'not found']);
  }
  facts.push(['Team', sessions.length ? `${sessions.length} running` : 'not running']);
  console.log(keyValues(facts));
  if (sessions.length) {
    console.log('');
    for (const name of sessions) console.log(`    ${c.green(marks().ok)} ${name}`);
  }
  console.log('');
  if (!config) console.log(hint('Set it up with: jht setup'));
  else if (!sessions.length) console.log(hint('Start the team with: jht team start'));
  if (notice) {
    console.log('');
    console.log(statusLine('warn', `Version ${notice.latest} is available (you run ${notice.current})`, { hint: `Run "${notice.command}" ${notice.where}` }));
  }
  console.log('');
}

export function registerStatusCommand(program) {
  program
    .command('status')
    .description('Show the state of the system: version, configuration, team sessions')
    .option('--json', 'machine-readable output')
    .action(handleStatus);
}
