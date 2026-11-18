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
import { fileURLToPath } from "node:url";

import { type JsonCell, PY_SPACE_CLASS } from "./py-format.ts";

export interface Policy {
  economy: boolean;
  logo: { enabled: boolean; min_score: number | boolean | null };
  /** The Analista's pipeline step 6 (the new position); the care queue is geocode_missing. */
  geocode_pipeline: { enabled: boolean };
  geocode_missing: { enabled: boolean; min_score: number | boolean | null; non_remote_only: boolean };
  recheck_weekly: { enabled: boolean; min_score: number | boolean; older_than_days: number | boolean };
  /** T325: the hosted web search of each role that has one; the Analista's off by default. */
  web_search: Record<WebSearchRole, { enabled: boolean }>;
}

export const WEB_SEARCH_ROLES = ["analista", "scout", "mentor"] as const;
export type WebSearchRole = (typeof WEB_SEARCH_ROLES)[number];

/** The switches `enrichment_costs.json` may price: the bool keys `set` takes (`_SETTABLE` with "bool"). */
const PRICED_SWITCHES = [
  "economy", "logo.enabled", "geocode_pipeline.enabled", "geocode_missing.enabled", "geocode_missing.non_remote_only",
  "recheck_weekly.enabled", ...WEB_SEARCH_ROLES.map((role) => `web_search.${role}.enabled`),
];
const COSTS_MAX_BYTES = 64 * 1024;
/** `COSTS_PATH`: next to enrichment_policy.py, in this repository's shared/skills. */
export const COSTS_PATH = fileURLToPath(new URL("../../../../shared/skills/enrichment_costs.json", import.meta.url));

type Usd = number | JsonCell | null;
export interface Costs {
  version: 1;
  positions_per_day: number;
  switches: Record<string, { costly: boolean; usd_per_position: Usd; usd_per_search?: Usd }>;
}

export type EnrichmentKind = "logo" | "geocode_pipeline" | "geocode_missing" | "recheck_weekly";

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
  return parseJson(readFileSync(path, "utf8"));
}

function parseJson(text: string): unknown {
  return JSON.parse(text, function (_key, value, context?: { source?: string }) {
    if (typeof value === "number" && context?.source && /[.eE]/.test(context.source)) return new PyFloat(value);
    return value;
  });
}

const asNumber = (v: number | boolean) => (typeof v === "boolean" ? Number(v) : v);
/** An int that is not a bool: `true` is not a score or a number of days (enrichment_policy.load_policy, T327). */
const isWholeNumber = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof PyFloat);

export class EnrichmentPolicy {
  readonly policyPath: string;
  readonly modePath: string;
  readonly now: () => Date;

  readonly costsPath: string;

  constructor(profileDir: string, now: () => Date = () => new Date(), costsPath: string = COSTS_PATH) {
    this.policyPath = join(profileDir, "enrichment-policy.json");
    this.modePath = join(profileDir, "capitano-maintenance.json");
    this.now = now;
    this.costsPath = costsPath;
  }

  /** `costs`: the price of each switch, checked whole; null when the file is missing, too big or out of shape. */
  costs(): Costs | null {
    let data: unknown;
    try {
      const raw = readFileSync(this.costsPath);
      if (raw.length > COSTS_MAX_BYTES) return null;
      data = parseJson(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    } catch {
      return null;
    }
    if (!isDict(data) || data["version"] !== 1 || !isDict(data["switches"])) return null;
    const perDay = data["positions_per_day"];
    if (!isWholeNumber(perDay) || perDay < 1 || perDay > 10000) return null;
    const usd = (value: unknown): Usd => {
      if (value === null) return null;
      const number = value instanceof PyFloat ? value.value : value;
      if (typeof number !== "number" || number < 0 || number > 100) throw new Error("usd");
      return value instanceof PyFloat ? { value: number, declared: "REAL" } : number;
    };
    const switches: Costs["switches"] = {};
    for (const [key, entry] of Object.entries(data["switches"])) {
      if (!PRICED_SWITCHES.includes(key)) continue;
      if (!isDict(entry) || typeof entry["costly"] !== "boolean") return null;
      try {
        const item: Costs["switches"][string] = { costly: entry["costly"], usd_per_position: usd(entry["usd_per_position"] ?? null) };
        if ("usd_per_search" in entry) item.usd_per_search = usd(entry["usd_per_search"]);
        switches[key] = item;
      } catch {
        return null;
      }
    }
    return { version: 1, positions_per_day: perDay, switches };
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
      geocode_pipeline: { enabled: true },
      geocode_missing: { enabled: true, min_score: null, non_remote_only: true },
      recheck_weekly: { enabled: true, min_score: 70, older_than_days: 14 },
      web_search: { analista: { enabled: false }, scout: { enabled: true }, mentor: { enabled: true } },
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
        else if (isWholeNumber(ms) && ms >= 0 && ms <= 100) merged[section].min_score = ms;
      }
      if (section === "geocode_missing" && typeof sec["non_remote_only"] === "boolean") merged.geocode_missing.non_remote_only = sec["non_remote_only"];
      if (section === "recheck_weekly") {
        const score = sec["min_score"];
        const days = sec["older_than_days"];
        if (isWholeNumber(score) && score >= 0 && score <= 100) merged.recheck_weekly.min_score = score;
        if (isWholeNumber(days) && days >= 1 && days <= 365) merged.recheck_weekly.older_than_days = days;
      }
    }
    const searches = data["web_search"];
    if (isDict(searches)) {
      for (const role of WEB_SEARCH_ROLES) {
        const sec = searches[role];
        if (isDict(sec) && typeof sec["enabled"] === "boolean") merged.web_search[role].enabled = sec["enabled"];
      }
    }
    const pipeline = data["geocode_pipeline"];
    if (isDict(pipeline) && typeof pipeline["enabled"] === "boolean") merged.geocode_pipeline.enabled = pipeline["enabled"];
    // A file from before the two switches: whoever had turned geocoding off finds it off still.
    else if (!("geocode_pipeline" in data)) merged.geocode_pipeline.enabled = merged.geocode_missing.enabled;
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
