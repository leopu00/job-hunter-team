/**
 * `shared/skills/profile_gate.py`: the "minimum viable profile" a score needs.
 *
 * `db_insert.py score` runs it before every write (incident 2026-07: a score
 * of 45 persisted for a person whose profile was never filled in). The gate is
 * deterministic and not the model's to decide, so `db_insert score` runs this
 * before it writes, as the script does.
 *
 * It is not a completeness check: a partial profile passes. It fails closed on
 * a missing, unreadable, empty or template profile, one with no target role,
 * and one with nothing besides the target role.
 *
 * The file is YAML read by PyYAML (`safe_load`, YAML 1.1). The parser here is
 * set up to read it the same way: 1.1 scalars (`yes` is true, `1e3` is not a
 * number), integers apart from floats (`experience_years: 5.0` is not an int),
 * the last of two equal keys, and any tag `safe_load` cannot build refused.
 */

import { readFileSync, statSync } from "node:fs";

import { isScalar, parseDocument, visit } from "yaml";

import { PY_SPACE } from "./py-compat.ts";

/** Placeholder name of docs/examples/candidate_profile.yml.example. */
const PLACEHOLDER_NAME = "nome cognome";

/** A profile is a page of text; anything this large is not one. */
const MAX_PROFILE_BYTES = 4 * 1024 * 1024;

/**
 * PyYAML's implicit float (resolver.py): a dot is required and an exponent is
 * signed, so `1e3` and `1.5e3` stay strings there while the 1.1 schema here
 * reads them as numbers.
 */
const PY_FLOAT =
  /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "gu");

export interface ProfileGateResult {
  ok: boolean;
  /** Empty when `ok`. */
  reason: string;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Uint8Array);
}

/** `_first_str`: the first string that is not blank, stripped. */
function firstStr(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string") {
      const stripped = v.replace(PY_STRIP, "");
      if (stripped) return stripped;
    }
  }
  return null;
}

/** `_has_items`: a list with an element, or a mapping with a meaningful value. */
function hasItems(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isDict(value)) return Object.values(value).some((v) => hasItems(v) || firstStr(v) !== null);
  return false;
}

function get(dict: Dict, key: string): unknown {
  return Object.hasOwn(dict, key) ? dict[key] : undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function checkMinimumViableProfile(path: string): ProfileGateResult {
  const fail = (reason: string): ProfileGateResult => ({ ok: false, reason });
  if (!isFile(path)) return fail(`candidate profile is missing: file not found (${path})`);

  let text: string;
  try {
    const bytes = readFileSync(path);
    if (bytes.length > MAX_PROFILE_BYTES) return fail(`candidate profile could not be read: larger than ${MAX_PROFILE_BYTES} bytes`);
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    return fail(`candidate profile could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  let data: unknown;
  try {
    const doc = parseDocument(text, { version: "1.1", intAsBigInt: true, uniqueKeys: false, merge: true, prettyErrors: false });
    // safe_load refuses what it cannot construct (`!!python/object`, `!custom`):
    // the parser only warns about an unknown tag, so a warning refuses here too.
    const problem = doc.errors[0] ?? doc.warnings[0];
    if (problem) throw problem;
    visit(doc, {
      Scalar(_key, node) {
        if (!isScalar(node)) return;
        if (node.tag === undefined && typeof node.value === "number" && !PY_FLOAT.test(node.source ?? "")) node.value = node.source;
      },
    });
    data = doc.toJS({ maxAliasCount: 100 });
  } catch (error) {
    return fail(`candidate profile could not be parsed (invalid YAML): ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isDict(data) || Object.keys(data).length === 0) return fail("candidate profile is empty (no fields completed)");

  const candidateRaw = get(data, "candidate");
  const personalRaw = get(data, "personal");
  const rolesRaw = get(data, "target_roles");
  const candidate: Dict = isDict(candidateRaw) ? candidateRaw : {};
  const personal: Dict = isDict(personalRaw) ? personalRaw : {};
  const targetRoles: unknown[] = Array.isArray(rolesRaw) ? rolesRaw : [];

  const targetRole = firstStr(get(data, "target_role"), get(candidate, "target_role"), targetRoles.length ? targetRoles[0] : null);
  if (!targetRole) {
    return fail("candidate profile has no job title or professional target (target_role): a score without a target is not meaningful");
  }

  const name = firstStr(get(data, "name"), get(candidate, "name"), get(personal, "name"));
  if (name && name.toLowerCase() === PLACEHOLDER_NAME) {
    return fail("candidate profile is an unedited template (name placeholder 'Nome Cognome')");
  }

  // Without anything beside target_role every sub-score (stack, seniority,
  // location, salary) stays incalculable.
  const hasSecondSignal =
    name !== null ||
    hasItems(get(data, "skills")) ||
    hasItems(get(candidate, "skills")) ||
    typeof get(data, "experience_years") === "bigint" ||
    firstStr(get(data, "location"), get(personal, "location")) !== null ||
    hasItems(get(data, "languages")) ||
    hasItems(get(candidate, "languages")) ||
    hasItems(get(data, "experience")) ||
    hasItems(get(candidate, "experience"));
  if (!hasSecondSignal) {
    return fail("candidate profile contains only target_role: no other signal (name, skills, experience, location, or languages)");
  }
  return { ok: true, reason: "" };
}
