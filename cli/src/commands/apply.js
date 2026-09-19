// Comando apply — l'utente autorizza (o ritira) UNA candidatura dal box.
// [JHT-CLOSER]
//
//   jht apply request <id> [--yes] [--json]   autorizza l'invio
//   jht apply cancel <id> [--json]            ritira prima dell'invio
//
// ⚠️ Il flag È l'autorizzazione a inviare: con il consenso acceso il CLOSER
// compila e spedisce senza un secondo click. Per questo `request` mostra
// titolo, azienda e URL e chiede una conferma esplicita; fuori da un terminale
// senza `--yes` rifiuta, perché uno script che non ha visto la posizione non
// ha confermato niente.
//
// Nessuna regola vive qui. Chi può accendere il flag lo decide
// `apply_gate.toggle_verdict` (Python, lo stesso gate che poi autorizza
// l'invio), e la scrittura la fa `shared/skills/apply_request.py` con
// `apply_requested_by = user_local`. Questo file passa argomenti, mostra e
// chiede conferma.

import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
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

function printPosition(p) {
  console.log(`  #${p.id}  ${c.bold(p.title || '(untitled)')}`);
  console.log(`  ${p.company || '(unknown company)'}`);
  console.log(`  ${p.url || c.red('(no application URL)')}`);
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

async function askYesNo(question, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export async function requestAction(id, options = {}, deps = {}) {
  const run = deps.run || runSkillCaptured;
  const interactive = deps.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const confirm = deps.confirm || askYesNo;

  const preview = callApplyRequest('show', id, run);
  const p = preview.result;
  if (!p || !p.ok) return failWith(p, options.json, preview.code || 1, preview.raw);

  if (!options.yes) {
    if (!interactive) {
      if (!options.json) {
        console.error(c.red('Refused: confirmation required.'));
        console.error('  This authorises a real application, sent without a second click.');
        console.error('  Re-run in a terminal, or pass --yes if you have checked the position.');
      } else {
        console.log(JSON.stringify({ ok: false, action: 'request', reason: 'confirmation_required', id: p.id }));
      }
      process.exitCode = 1;
      return;
    }
    console.log('');
    console.log(c.bold('You are authorising this application:'));
    printPosition(p);
    console.log('');
    console.log(c.yellow('  If auto-apply is on, the team will fill in and SUBMIT it on your behalf,'));
    console.log(c.yellow('  with no further confirmation. It cannot be recalled once sent.'));
    const ok = await confirm('Send this application? [y/N] ');
    if (!ok) {
      console.log(c.dim('Cancelled: nothing was authorised.'));
      return;
    }
  }

  const done = callApplyRequest('request', id, run);
  const out = done.result;
  if (!out || !out.ok) return failWith(out, options.json, done.code || 1, done.raw);
  if (options.json) {
    process.stdout.write(done.raw.stdout);
    return;
  }
  console.log(c.green(`Authorised #${out.id}.`));
  const q = out.queue || {};
  if (q.ready && !(q.held || []).some((h) => h.position_id === out.id)) {
    console.log('  The CLOSER will pick it up when the Captain next starts it.');
  } else {
    const held = (q.held || []).find((h) => h.position_id === out.id);
    console.log(
      c.yellow(`  It will NOT go out yet: ${held ? held.reason : q.reason}`) +
        (q.detail && !held ? ` — ${q.detail}` : ''),
    );
  }
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
    .description("Authorise the application for a 'ready' position (it is sent without a second click)")
    .option('-y, --yes', 'skip the confirmation (you have checked the position)')
    .option('--json', 'output JSON (for scripts and agents)')
    .action((id, options) => requestAction(id, options));
  cmd
    .command('cancel <id>')
    .description('Withdraw the authorisation before the application is sent')
    .option('--json', 'output JSON (for scripts and agents)')
    .action((id, options) => cancelAction(id, options));
  program.addCommand(cmd);
}
