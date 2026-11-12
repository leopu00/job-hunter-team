import { table, title, wrapText, terminalWidth, hint, visibleLength } from './ui.js';
import { say } from './texts.js';
import { CODEX_MODEL } from '../../../shared/runtime/role-models.js';

const MODEL_NAMES = Object.fromEntries(Object.entries(CODEX_MODEL).map(([name, model]) => [model, name]));
const safe = (v) => String(v ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 120);
const nd = () => say('observation.nd');
const value = (v) => v === null || v === undefined ? nd() : safe(v);

export function errorText(code) { return say(`error.${safe(code)}`); }

export function bar(percent) {
  if (!Number.isFinite(percent)) return nd();
  const count = Math.round(Math.max(0, Math.min(100, percent)) / 10);
  return `[${'#'.repeat(count)}${'.'.repeat(10 - count)}]`;
}

function identity(row) {
  const model = row.identity?.model;
  return [model ? safe(MODEL_NAMES[model] || model) : nd(), value(row.identity?.effort)].join(' / ');
}

function state(row) {
  if (row.running === false) return say('agents.stopped');
  const labels = {
    spento: say('agents.stopped'), idle: say('observation.idle'), lavora: say('observation.working'),
    bloccato: say('observation.blocked'), aspetta_umano: say('observation.waiting'),
    sconosciuto: say('observation.unknown'), avviato_mai_partito: say('observation.starting'),
  };
  return labels[row.state] || labels.sconosciuto;
}

const LIMIT_REASONS = new Set(['limite_5h', 'limite_settimanale', 'limite_spesa_org', 'limite_fornitore']);

/**
 * Why each blocked agent is blocked, in a line a person can act on, and for a key the provider refused the command
 * that puts it right. `provider` is what readActiveProvider says (null when unknown).
 */
export function blockedLines(snapshot, provider = null, width = terminalWidth()) {
  const out = [];
  const sentence = (text) => `  ${text}`;
  for (const row of snapshot.agents) {
    if (row.state !== 'bloccato' || row.running === false) continue;
    const id = safe(row.id);
    const why = typeof row.reason === 'string' ? row.reason : null;
    if (why === 'accesso_scaduto' && provider?.apiKey) {
      out.push(sentence(say('observation.blocked_key', { id, provider: safe(provider.label) })),
        hint(say('observation.blocked_key_fix', { name: safe(provider.name) }), 2, width));
    } else if (why === 'accesso_scaduto') {
      out.push(sentence(say('observation.blocked_login', { id, provider: provider ? safe(provider.label) : say('observation.the_provider') })),
        hint(say('observation.blocked_login_fix'), 2, width));
    } else if (why === 'credito_esaurito') {
      // a 429 too, but no limit that frees itself: the person has to top the account up
      out.push(sentence(say('observation.blocked_credit', { id, provider: provider ? safe(provider.label) : say('observation.the_provider') })),
        hint(say('observation.blocked_credit_fix'), 2, width));
    } else if (LIMIT_REASONS.has(why)) {
      out.push(sentence(say('observation.blocked_limit', { id })));
    } else if (why === 'rete') {
      out.push(sentence(say('observation.blocked_network', { id })));
    } else {
      out.push(sentence(say('observation.blocked_error', { id })));
    }
  }
  return out;
}

function usageLines(snapshot) {
  const meter = snapshot.usage;
  const lines = [say('observation.tokens'), say('observation.updated', {
    at: value(meter.generated_at), age: value(meter.age_seconds),
  }), say('observation.identity_limits')];
  for (const code of snapshot.errors) lines.push(`${safe(code)}: ${errorText(code)}`);
  return lines;
}

export function renderObservation(snapshot, { usage = true, live = false, width = terminalWidth(), provider = null } = {}) {
  const out = [title(live ? say('observation.monitor') : say('agents.title'),
    say('agents.running_of', { running: snapshot.running, total: snapshot.total }))];
  const columns = [{ label: say('agents.col_agent') }, { label: say('agents.col_session'), drop: true },
    { label: say('agents.col_state') }, { label: say('observation.identity'), shrink: true, min: 8 }];
  const rows = snapshot.agents.map((row) => [safe(row.id), safe(row.session), state(row), identity(row)]);
  if (usage) {
    columns.push({ label: say('observation.token_column') });
    rows.forEach((cells, i) => cells.push(value(snapshot.agents[i].usage.tokens)));
  }
  out.push(table(columns, rows));
  out.push(...blockedLines(snapshot, provider, width));
  if (!snapshot.agents.length && snapshot.ok) out.push(say('observation.empty'), hint(say('team.next_start')));
  if (live) {
    for (const row of snapshot.agents) {
      const p = row.process;
      out.push(say('observation.process', { id: safe(row.id), pids: value(p?.pids?.join(',') || null),
        alive: p?.alive === true ? say('agents.running') : p?.alive === false ? say('agents.stopped') : nd(),
        cpu: value(p?.cpu_pct), cpuBar: bar(p?.cpu_pct),
        ram: p?.rss_bytes == null ? nd() : (p.rss_bytes / 1048576).toFixed(1), ramBar: bar(p?.rss_pct) }));
    }
    out.push(say('observation.process_limits'), say('observation.stop'));
  }
  if (usage) out.push(...usageLines(snapshot));
  if (usage) for (const row of snapshot.agents) {
    if (row.usage.reason) out.push(`${safe(row.id)}: ${nd()} — ${errorText(row.usage.reason)}`);
  }
  else for (const code of snapshot.errors.filter((c) => !c.startsWith('observer_usage_'))) out.push(errorText(code));
  return out.flatMap((line) => line.split('\n').flatMap((part) =>
    visibleLength(part) <= width ? [part] : wrapText(part, width))).join('\n') + '\n';
}
