import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';

/** JHT_USER_TZ as the host setup wrote it in host.env (a shell without the variable, e.g. inside the container, still knows it). */
function hostEnvZone(home) {
  try {
    return /^\s*(?:export\s+)?JHT_USER_TZ=["']?([A-Za-z0-9_+./-]+)/m.exec(readFileSync(join(home, 'host.env'), 'utf8'))?.[1] ?? '';
  } catch { return ''; }
}

// The person's time zone for the working hours. Inside the container the system zone is UTC: the zone the host setup
// asked or read from the computer arrives as JHT_USER_TZ (host.env → compose), and it wins when it is a real zone.
// On the host (no JHT_USER_TZ) the system zone is the person's.
// A UTC in the environment does not hold against a zone in host.env: it is the default the container gets when it is
// made before host.env says otherwise (the Windows installer starts the team before it writes host.env, giro Windows
// 16/11: host.env Europe/Berlin, budget and pause written in UTC), and the variable stays as it was until the container
// is made again. Whoever chooses UTC has it in host.env too.
export function localTimeZone(env = process.env, home = JHT_HOME) {
  const fromEnv = String(env.JHT_USER_TZ || '').trim();
  const fromFile = /^(Etc\/)?UTC$/i.test(fromEnv) ? hostEnvZone(home) : '';
  const asked = fromFile || fromEnv || hostEnvZone(home);
  if (asked) {
    try { return new Intl.DateTimeFormat('en', { timeZone: asked }).resolvedOptions().timeZone; } catch { /* not a zone */ }
  }
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
