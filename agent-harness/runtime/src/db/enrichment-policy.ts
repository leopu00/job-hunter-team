/**
 * `enrichment_policy.py` and `mode_deadline.py`, read-only (T14): the
 * spending brake on the team's autonomous enrichment.
 *
 * Two files in the person's profile folder: `enrichment-policy.json` (the
 * fine flags, defaults for anything missing) and `capitano-maintenance.json`
 * (the working mode, which `saving` or an unreadable file turn into "no
 * autonomous enrichment", and `mode_until` ends). The Python resolves them as
 * `dirname(jobs.db)/profile/`; the runtime keeps the team database in a
 * folder of its own, so they are read from the profile folder itself — the
 * same files. Nothing here writes: `set` is the Capitano's, on the person's
 * order.
 *
 * Python's `json.load` tells `70` from `70.0` and counts `true` as an int;
 * the reader below keeps both distinctions, since the policy accepts a
 * threshold only when it is an int.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PY_SPACE_CLASS } from "./py-format.ts";

export interface Policy {
  economy: boolean;
  logo: { enabled: boolean; min_score: number | boolean | null };
  geocode_missing: { enabled: boolean; min_score: number | boolean | null; non_remote_only: boolean };
  recheck_weekly: { enabled: boolean; min_score: number | boolean; older_than_days: number | boolean };
}

export type EnrichmentKind = "logo" | "geocode_missing" | "recheck_weekly";

const MODES = ["search", "harvest", "care", "calibration", "saving"];
export const MODE_UNKNOWN = "unknown";

/** A number json.load would read as a float. */
class PyFloat {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }
}

/** `json.load`, keeping floats apart from ints. Throws on what JSON.parse refuses. */
function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"), function (_key, value, context?: { source?: string }) {
    if (typeof value === "number" && context?.source && /[.eE]/.test(context.source)) return new PyFloat(value);
    return value;
  });
}

/** `isinstance(v, int)`: an int, or a bool, which Python counts as one. */
const isInt = (v: unknown): v is number | boolean => (typeof v === "number" && Number.isInteger(v)) || typeof v === "boolean";
const asNumber = (v: number | boolean) => (typeof v === "boolean" ? Number(v) : v);
const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof PyFloat);

export class EnrichmentPolicy {
  readonly policyPath: string;
  readonly modePath: string;
  readonly now: () => Date;

  constructor(profileDir: string, now: () => Date = () => new Date()) {
    this.policyPath = join(profileDir, "enrichment-policy.json");
    this.modePath = join(profileDir, "capitano-maintenance.json");
    this.now = now;
  }

  /** `current_mode`: missing file is `search`; unreadable or out of the enum is `unknown`; a passed `mode_until` is `search`. */
  currentMode(): string {
    let data: unknown;
    try {
      data = loadJson(this.modePath);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "search" : MODE_UNKNOWN;
    }
    if (!isDict(data)) return MODE_UNKNOWN;
    const raw = data["mode"];
    const strip = new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu");
    if (typeof raw !== "string" || !raw.replace(strip, "")) return MODE_UNKNOWN;
    let mode = raw.replace(strip, "");
    if (mode === "maintenance") mode = "care";
    if (!MODES.includes(mode)) return MODE_UNKNOWN;
    const deadline = parseDeadline(data["mode_until"]);
    return deadline !== null && this.now().getTime() >= deadline ? "search" : mode;
  }

  /** `load_policy`: the defaults, overridden key by key by what the file holds and validates. */
  load(): Policy {
    const merged: Policy = {
      economy: false,
      logo: { enabled: true, min_score: null },
      geocode_missing: { enabled: true, min_score: null, non_remote_only: true },
      recheck_weekly: { enabled: true, min_score: 70, older_than_days: 14 },
    };
    let data: unknown;
    try {
      data = loadJson(this.policyPath);
    } catch {
      return merged;
    }
    if (!isDict(data)) return merged;
    if (typeof data["economy"] === "boolean") merged.economy = data["economy"];
    for (const section of ["logo", "geocode_missing", "recheck_weekly"] as const) {
      const sec = data[section];
      if (!isDict(sec)) continue;
      if (typeof sec["enabled"] === "boolean") merged[section].enabled = sec["enabled"];
      if (section === "logo" || section === "geocode_missing") {
        const ms = sec["min_score"];
        // `sec.get("min_score")`: a missing key is None too.
        if (ms === undefined || ms === null) merged[section].min_score = null;
        else if (isInt(ms) && asNumber(ms) >= 0 && asNumber(ms) <= 100) merged[section].min_score = ms;
      }
      if (section === "geocode_missing" && typeof sec["non_remote_only"] === "boolean") merged.geocode_missing.non_remote_only = sec["non_remote_only"];
      if (section === "recheck_weekly") {
        const score = sec["min_score"];
        const days = sec["older_than_days"];
        if (isInt(score) && asNumber(score) >= 0 && asNumber(score) <= 100) merged.recheck_weekly.min_score = score;
        if (isInt(days) && asNumber(days) >= 1 && asNumber(days) <= 365) merged.recheck_weekly.older_than_days = days;
      }
    }
    return merged;
  }

  /** `is_enabled`: saving or an unreadable mode first, then economy, then the fine flag. */
  isEnabled(kind: EnrichmentKind): boolean {
    const mode = this.currentMode();
    if (mode === "saving" || mode === MODE_UNKNOWN) return false;
    const p = this.load();
    return !p.economy && p[kind].enabled;
  }

  /** `disabled_reason`. */
  disabledReason(kind: EnrichmentKind): string {
    const mode = this.currentMode();
    if (mode === "saving") return "SAVING mode is active (mode=saving)";
    if (mode === MODE_UNKNOWN) {
      return "capitano-maintenance.json exists but cannot be interpreted: autonomous enrichment is suspended until a person reviews it";
    }
    const p = this.load();
    if (p.economy) return "SAVING policy is active (economy=true)";
    if (!p[kind].enabled) return `disabled by policy (${kind}.enabled=false)`;
    return "";
  }

  /** `recheck_options`: `int()` of the two values. */
  recheckOptions(): { min_score: number; older_than_days: number } {
    const r = this.load().recheck_weekly;
    return { min_score: asNumber(r.min_score), older_than_days: asNumber(r.older_than_days) };
  }

  geocodeOptions(): { min_score: number | boolean | null; non_remote_only: boolean } {
    const g = this.load().geocode_missing;
    return { min_score: g.min_score, non_remote_only: g.non_remote_only };
  }

  logoMinScore(): number | boolean | null {
    return this.load().logo.min_score;
  }
}

/**
 * `mode_deadline.parse_deadline`: an ISO 8601 instant as epoch ms, UTC when
 * it has no zone, a trailing `Z` accepted; null when missing or unreadable
 * (an unreadable deadline never expires). The forms Python's `fromisoformat`
 * reads that a person writes: a date, and a date with a time.
 */
export function parseDeadline(value: unknown): number | null {
  if (typeof value !== "string") return null;
  let raw = value.replace(new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu"), "");
  if (!raw) return null;
  if (/[Zz]$/.test(raw)) raw = `${raw.slice(0, -1)}+00:00`;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?([+-]\d{2}:?\d{2})?)?$/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", zone] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(frac.padEnd(3, "0").slice(0, 3))));
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  let offset = 0;
  if (zone) {
    const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
    offset = (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60_000;
  }
  return date.getTime() - offset;
}
