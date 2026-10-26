// jht providers plan — the subscription plan, declared as the setup wizard does.
//
// The table of plans and the plan's meaning live in shared/skills/plan_registry.py and
// nowhere else (the Capitano's first run reads the same file, and begin-burst refuses to
// guess a roster without a declared plan). This module asks it for the table and writes
// the same place the wizard's `plan_registry.py set` writes, providers.<provider>.plan,
// through the private writer of the configuration.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = join(dirname(fileURLToPath(import.meta.url)), '../../../shared/skills/plan_registry.py');

function registry(args) {
  const r = spawnSync('python3', ['-I', REGISTRY, ...args], { encoding: 'utf8', timeout: 20000 });
  return { ok: !r.error && r.status === 0, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The plans of one provider, from the registry: `{ provider, plans: [{id, label, …}] }` or null. */
export function plansOf(provider) {
  const r = registry(['list', provider, '--json']);
  if (!r.ok) return null;
  try {
    const [[id, plans]] = Object.entries(JSON.parse(r.stdout));
    return Array.isArray(plans) ? { provider: id, plans } : null;
  } catch {
    return null;
  }
}

/** The table, as the registry prints it for the person. */
export function planTable(provider) {
  const r = registry(['list', provider]);
  return r.ok ? r.stdout.trimEnd() : '';
}

/** The declared plan (`{id, label, …}`), `null` when none, `undefined` when it cannot be told. */
export function declaredPlan() {
  const r = registry(['get']);
  if (r.status === 1 && r.stdout.trim() === 'PLAN_MISSING') return null;
  if (!r.ok) return undefined;
  try { return JSON.parse(r.stdout); } catch { return undefined; }
}

/**
 * Declares `id` as the active provider's plan in `config`.
 * @returns {{ok:true, provider:string, plan:object, config:object} | {ok:false, code:string, provider?:string}}
 */
export function withDeclaredPlan(config, id) {
  const active = typeof config?.active_provider === 'string' ? config.active_provider.trim() : '';
  if (!active) return { ok: false, code: 'no_active_provider' };
  const table = plansOf(active);
  if (!table) return { ok: false, code: 'registry_unavailable' };
  const wanted = String(id ?? '').trim().toLowerCase();
  const plan = table.plans.find((p) => p.id === wanted);
  if (!plan) return { ok: false, code: 'unknown_plan', provider: table.provider };
  const providers = config.providers && typeof config.providers === 'object' && !Array.isArray(config.providers)
    ? config.providers : {};
  const entry = providers[table.provider] && typeof providers[table.provider] === 'object' && !Array.isArray(providers[table.provider])
    ? providers[table.provider] : {};
  return {
    ok: true,
    provider: table.provider,
    plan,
    config: { ...config, providers: { ...providers, [table.provider]: { ...entry, plan: plan.id } } },
  };
}
