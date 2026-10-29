import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ExecutionHost } from "./onboarding";

/** One subscription plan as the registry names it (shared/skills/plan_registry.py): id, name and price in the app's language. */
export interface PlanOption {
  id: string;
  label: string;
  /** Empty for a plan the registry lists without a price (and for the declared plan, which carries none). */
  price: string;
}

/** What the setup shows before the team starts: the plans to choose from and the plan Codex reports, if any. */
export interface PlanChoiceData {
  provider: string;
  /** The plan already declared on the team's host, or null. */
  declared: PlanOption | null;
  plans: PlanOption[];
  /** The id of one of `plans` that the account's Codex reading names: a suggestion to confirm, never a choice made. */
  suggested: string | null;
}

const TEXT_MAX = 48;
const PLANS_MAX = 12;
const ID = /^[a-z0-9-]{1,24}$/;

const text = (value: unknown, allowEmpty: boolean): value is string =>
  typeof value === "string" && (allowEmpty || value.length > 0) && [...value].length <= TEXT_MAX &&
  ![...value].some((char) => char < " " || char === "\u007f");

export function parsePlanOption(value: unknown): PlanOption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID.test(r.id) || !text(r.label, false) || !text(r.price, true)) return null;
  return { id: r.id, label: r.label, price: r.price };
}

export function parsePlanChoice(value: unknown): PlanChoiceData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.provider !== "string" || !r.provider || !Array.isArray(r.plans)) return null;
  if (r.plans.length === 0 || r.plans.length > PLANS_MAX) return null;
  const plans = r.plans.map(parsePlanOption);
  if (plans.some((plan) => plan === null)) return null;
  const declared = r.declared == null ? null : parsePlanOption(r.declared);
  if (r.declared != null && declared === null) return null;
  const known = plans as PlanOption[];
  const suggested = typeof r.suggested === "string" && known.some((plan) => plan.id === r.suggested) ? r.suggested : null;
  return { provider: r.provider, declared, plans: known, suggested };
}

/**
 * Reads the plans on the team's host (`jht providers plan --json`): `host` is the one being set up, null the saved
 * one. Rejects with `{ code }` when the plans cannot be read; the setup then goes on without the choice.
 */
export async function loadPlans(host: ExecutionHost | null): Promise<PlanChoiceData> {
  if (!isTauri()) throw { code: "desktop_only" };
  const choice = parsePlanChoice(await invoke("onboarding_plans", { host }));
  if (!choice) throw { code: "plans_unavailable" };
  return choice;
}

/** Declares the plan the person chose, and nothing else. Rejects with `{ code }` when it was not saved. */
export async function declarePlan(host: ExecutionHost | null, plan: string): Promise<PlanOption> {
  if (!isTauri()) throw { code: "desktop_only" };
  const declared = parsePlanOption(await invoke("onboarding_plan_declare", { host, plan }));
  if (!declared || declared.id !== plan) throw { code: "plan_declare_failed" };
  return declared;
}
