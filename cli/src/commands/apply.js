// Comando apply — l'utente chiede (o ritira) UNA candidatura dal box.
// [JHT-CLOSER]
//
//   jht apply request <id> [--json]   mostra la posizione e chiede conferma su Telegram
//   jht apply cancel <id> [--json]    ritira prima dell'invio
//
// ⚠️ Nel container questo comando ha gli stessi permessi degli agenti: non
// autorizza più. L'autorizzazione che il CLOSER verifica sta nel broker, e la
// registrano solo i canali della persona (app, sito, Telegram, `jht apply
// request` nel terminale dell'host). Ritirare invece si può da qui: restringe.
//
// Nessuna regola vive qui. Chi può accendere il flag lo decide
// `apply_gate.toggle_verdict` (Python, lo stesso gate che poi autorizza
// l'invio), e la scrittura la fa `shared/skills/apply_request.py` con
// `apply_requested_by = user_local`. Questo file passa argomenti, mostra e
// chiede conferma.

import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { runSkillCaptured } from './positions.js';
import { c } from './_colors.js';

const SKILL = 'apply_request.py';

function parseLine(stdout) {
  const line = String(stdout || '').trim().split('\n').filter(Boolean).pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Esegue la skill e ritorna { code, result, raw }. */
export function callApplyRequest(action, id, run = runSkillCaptured) {
  const r = run(SKILL, [action, String(id)]);
  return { code: r.code, result: parseLine(r.stdout), raw: r };
}

function failWith(out, json, code, raw) {
  if (json) {
    if (raw?.stdout) process.stdout.write(raw.stdout);
  } else if (out) {
    console.error(c.red(`Refused: ${out.reason}`) + (out.detail ? ` — ${out.detail}` : ''));
  } else {
    if (raw?.stderr) process.stderr.write(raw.stderr);
    console.error(c.red('apply_request.py returned no result'));
  }
  process.exitCode = code || 1;
}

/**
 * Asks the person on Telegram, with the service's fixed question («title @ company · host») and
 * a button bound to that question: the service records a «yes» in the broker from its own
 * channel. Without Telegram configured the answer says so.
 */
export function askOnTelegram(p, spawn = spawnSync) {
  const r = spawn(
    'jht-telegram-client',
    ['apply-request', '--position-id', String(p.id), '--title', String(p.title || ''),
      '--company', String(p.company || ''), '--url', String(p.url || '')],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (r.error || r.status !== 0) return { ok: false };
  const out = parseLine(r.stdout);
  return out && out.ok === true ? { ok: true, status: out.status } : { ok: false };
}

// Inside the team's container this command runs with the same permissions as the agents: what
// it wrote would prove nothing, so it no longer authorises. It shows the position and asks the
// person on Telegram; the other ways are the app, the website and `jht apply request` in the
// terminal of the computer that hosts the team (the wrapper there records in the broker).
export async function requestAction(id, options = {}, deps = {}) {
  const run = deps.run || runSkillCaptured;
  const ask = deps.askTelegram || askOnTelegram;

  const preview = callApplyRequest('show', id, run);
  const p = preview.result;
  if (!p || !p.ok) return failWith(p, options.json, preview.code || 1, preview.raw);

  const asked = ask(p);
  const out = {
    ok: asked.ok,
    action: 'request',
    reason: asked.ok ? 'asked_on_telegram' : 'authorise_from_your_channel',
    authorised: false,
    id: p.id,
    summary: p.summary,
  };
  if (options.json) {
    console.log(JSON.stringify(out));
  } else {
    console.log('');
    console.log(`  #${p.id}  ${c.bold(p.summary || p.title || '(untitled)')}`);
    console.log('');
    if (asked.ok) {
      console.log(c.green('  I asked you on Telegram: the application is authorised when you press «Yes» there.'));
    } else {
      console.log(c.yellow('  Not authorised from here: this terminal runs with the same permissions as the agents.'));
    }
    console.log('  You can also authorise it from the app, from the website, or with');
    console.log(`  \`jht apply request ${p.id}\` in the terminal of the computer that hosts the team.`);
  }
  if (!asked.ok) process.exitCode = 1;
}

export function cancelAction(id, options = {}, deps = {}) {
  const run = deps.run || runSkillCaptured;
  const done = callApplyRequest('cancel', id, run);
  const out = done.result;
  if (!out || !out.ok) return failWith(out, options.json, done.code || 1, done.raw);
  if (options.json) {
    process.stdout.write(done.raw.stdout);
    return;
  }
  console.log(
    out.previous
      ? c.green(`Withdrawn #${out.id}: it will not be sent.`)
      : c.dim(`#${out.id} was not authorised: nothing to withdraw.`),
  );
}

export function registerApplyCommand(program) {
  const cmd = new Command('apply').description(
    'Authorise or withdraw an application the CLOSER sends for you',
  );
  cmd
    .command('request <id>')
    .description("Ask to authorise the application for a 'ready' position (on Telegram; or from the app, the website, the host's terminal)")
    .option('-y, --yes', 'no effect: kept so that older scripts still run')
    .option('--json', 'output JSON (for scripts and agents)')
    .action((id, options) => requestAction(id, options));
  cmd
    .command('cancel <id>')
    .description('Withdraw the authorisation before the application is sent')
    .option('--json', 'output JSON (for scripts and agents)')
    .action((id, options) => cancelAction(id, options));
  program.addCommand(cmd);
}
