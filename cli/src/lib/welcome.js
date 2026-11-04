/**
 * The screen of a bare `jht`: what the program is, how things stand today in two lines, and the next step. Before
 * the first setup it says one thing only: `jht setup`. It is written for a person, so the exit code is 0.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { AGENTS, isAgentSession } from '../commands/team/agents.js';
import { hint, keyValues, terminalWidth, title, wrapText } from './ui.js';
import { say } from './texts.js';

function teamSessions() {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n').filter((name) => name && AGENTS.some((agent) => isAgentSession(name, agent)));
  } catch {
    return [];
  }
}

function readConfig() {
  const path = join(JHT_HOME, 'jht.config.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return false; }
}

/** The text of the welcome (a string), for the state of this computer. */
export function renderWelcome({ config = readConfig(), sessions = teamSessions() } = {}) {
  const lines = [title(say('welcome.title')), ...wrapText(say('welcome.about'), terminalWidth() - 4).map((part) => `  ${part}`), ''];
  if (!config) {
    lines.push(hint(config === false ? say('welcome.config_unreadable') : say('welcome.first_run')), '');
    return lines.join('\n');
  }
  const provider = config.active_provider ?? say('status.not_set');
  lines.push(keyValues([
    [say('status.provider'), provider],
    [say('status.team'), sessions.length ? say('status.team_running', { n: sessions.length }) : say('status.team_off')],
  ]), '');
  lines.push(hint(sessions.length ? say('welcome.next_running') : say('welcome.next_start')));
  lines.push(hint(say('welcome.more')), '');
  return lines.join('\n');
}
