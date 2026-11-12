/**
 * Whether the provider said the credit of the account is gone (Z.ai 429 code 1113, Kimi «insufficient balance»,
 * OpenAI insufficient_quota) and no call has passed since: what shared/skills/provider_credit.py reads in the pi
 * sessions, the same reading the spending brake of the bridge pauses the team on. Such a team looks merely silent
 * (a message sent gets its green tick, the chat stays empty): `jht doctor`, `jht team start` and `jht team send` say it.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JHT_HOME } from '../jht-paths.js';
import { say } from './texts.js';

const SCRIPT = fileURLToPath(new URL('../../../shared/skills/provider_credit.py', import.meta.url));
/** A day: an empty balance stays empty until someone tops it up, however long ago the last call was refused. */
export const CREDIT_WINDOW_S = 24 * 3600;

/**
 * @returns {{ provider: string, label: string, agent: string, ts: number } | null}  null also when it cannot be read:
 *   a reading that fails is no verdict, and nothing here stops a command.
 */
export function creditGone({ run = spawnSync, home = JHT_HOME, windowS = CREDIT_WINDOW_S } = {}) {
  try {
    const res = run('python3', [SCRIPT, '--window', String(windowS)], {
      encoding: 'utf8', timeout: 15_000, env: { ...process.env, JHT_HOME: home },
    });
    if (res.error || res.status !== 0) return null;
    const found = JSON.parse(String(res.stdout || 'null').trim() || 'null');
    if (!found || typeof found !== 'object' || typeof found.label !== 'string') return null;
    return { provider: String(found.provider ?? ''), label: found.label.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 60),
      agent: String(found.agent ?? ''), ts: Number(found.ts) || 0 };
  } catch {
    return null;
  }
}

/**
 * The line `jht team start` and `jht team send` print when the credit is gone, or null. It does not stop them: the
 * person may have topped the account up a minute ago, and a start or a message is how the team finds out.
 */
export function creditNotice(options = {}) {
  const found = creditGone(options);
  return found ? say('credit.gone', { provider: found.label }) : null;
}
