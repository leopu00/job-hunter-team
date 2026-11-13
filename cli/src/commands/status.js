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
import { providerSignedIn } from '../lib/provider-signin.js';
import { say } from '../lib/texts.js';
import { offeredInRelease } from '../../../shared/runtime/release-providers.js';

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
  const facts = [[say('status.version'), pkg.version]];
  let config = null;
  if (await fileExists(CONFIG_FILE)) {
    try { config = JSON.parse(await readFile(CONFIG_FILE, 'utf-8')); } catch { config = false; }
  }
  const provConfig = config ? config.providers?.[config.active_provider] : null;
  const tgBots = config ? config.channels?.telegram?.bots : null;
  // a subscription without a sign-in (a setup stopped at the login screen) must not read as ready
  const subscription = provConfig?.auth_method === 'subscription' || provConfig?.auth_method === 'cli';
  const signedIn = subscription ? await providerSignedIn(config, JHT_HOME) : null;

  // Team sessions. The container's sessions are CAPITANO / SCOUT-1 / ASSISTENTE and the old host path puts JHT-
  // in front: both are recognised, or a working team would read as "0".
  const sessions = getTmuxSessions().filter((s) => s.startsWith('lab-') || AGENTS.some((agent) => isAgentSession(s, agent)));
  const notice = options.json ? null : updateNotice(pkg.version, await fetchLatestRelease());

  if (options.json) {
    console.log(JSON.stringify({
      version: pkg.version,
      configured: Boolean(config),
      provider: config ? { id: config.active_provider ?? null, model: provConfig?.model ?? null, auth: provConfig?.auth_method ?? null, signed_in: signedIn } : null,
      sessions,
    }, null, 2));
    return;
  }

  console.log(title(say('status.title')));
  if (config) {
    facts.push([say('status.provider'), config.active_provider ? `${config.active_provider}${provConfig?.model ? ` (${provConfig.model})` : ''}` : say('status.not_set')]);
    // a team on a service this release does not offer (shared/runtime/release-providers.js): said here too, with the way out
    if (config.active_provider && !offeredInRelease(config.active_provider)) facts.push([say('status.provider'), say('status.not_in_release')]);
    if (provConfig?.auth_method) {
      facts.push([say('status.signin'), signedIn === false ? say('status.signin_missing', { method: provConfig.auth_method }) : provConfig.auth_method]);
    }
    if (config.workspace) facts.push([say('status.workspace'), config.workspace]);
    if (tgBots) {
      const n = ['assistente', 'capitano', 'mentor'].filter((r) => tgBots?.[r]?.bot_token).length;
      facts.push([say('status.telegram'), n === 3 ? say('status.telegram_ok') : say('status.telegram_partial', { n })]);
    }
  } else {
    facts.push([say('status.configuration'), config === false ? say('status.unreadable') : say('status.not_found')]);
  }
  facts.push([say('status.team'), sessions.length ? say('status.team_running', { n: sessions.length }) : say('status.team_off')]);
  console.log(keyValues(facts));
  if (sessions.length) {
    console.log('');
    for (const name of sessions) console.log(`    ${c.green(marks().ok)} ${name}`);
  }
  console.log('');
  if (!config) console.log(hint(say('status.next_setup')));
  else if (!sessions.length) console.log(hint(say('status.next_start')));
  if (notice) {
    console.log('');
    console.log(statusLine('warn', say('status.update', { latest: notice.latest, current: notice.current }), { hint: say('status.update_hint', { command: notice.command, where: notice.where }) }));
  }
  console.log('');
}

export function registerStatusCommand(program) {
  program
    .command('status')
    .description(say('status.description'))
    .option('--json', say('option.json'))
    .action(handleStatus);
}
