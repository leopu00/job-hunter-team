/**
 * `shared/skills/validate_profile.py`: the profile's own gate (T38).
 *
 * The ASSISTENTE is the one role that WRITES `candidate_profile.yml` — the
 * file the whole team then reads — and its rule A-02 says every write is
 * followed by a validation, because an invalid profile is an empty left panel
 * for the person and a scoring run with nothing to score. In the TUI that
 * validation is `python3 validate_profile.py <path>`; the image has no Python,
 * so it is this tool, with the same checks, the same words and the same exit
 * code.
 *
 * Three levels, as the script has them: the mandatory core (name, target role,
 * location, years, degree, seniority, one skill, one language), the optional
 * `blocks[]` of the dashboard, and the canonical target-role choice. Legacy
 * spellings the transition still accepts (`languages[].name`, a flat `skills`
 * list) are warnings, not errors — and `--strict` makes them errors, which is
 * what the CLI does after a migration.
 *
 * The YAML is read as PyYAML reads it (`pySafeLoad`, the same reader the
 * score's gate uses): a profile that the script parses and this one does not
 * would fail the person for a difference between two parsers.
 */

import { readFileSync } from "node:fs";

import { isInside, realPath, resolveUserPath } from "../../tools/paths.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";
import { pySafeLoad } from "./profile-gate.ts";
import { pyJson } from "./py-compat.ts";

export const VALIDATE_PROFILE_TOOL = "validate_profile";

/** The `kind` a dashboard block may have. */
const BLOCK_KINDS = ["distribution", "key_points", "key_value", "narrative", "tag_list", "timeline"] as const;

const TARGET_ROLE_SPECIALTIES: Readonly<Record<string, readonly string[]>> = {
  software: ["backend", "frontend", "fullstack", "platform", "embedded", "open"],
  data: ["data_science", "ml", "genai", "data_engineering", "research", "open"],
  product: ["product", "project", "technical_pm", "delivery", "founder"],
  design: ["specialist", "generalist", "leadership", "individual", "explore"],
  business: ["specialist", "generalist", "leadership", "individual", "explore"],
  security: ["specialist", "generalist", "leadership", "individual", "explore"],
  other: ["specialist", "generalist", "leadership", "individual", "explore"],
};

export interface ProfileReport {
  errors: string[];
  warnings: string[];
}

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => typeof value === "object" && value !== null && !Array.isArray(value);
/** Python's `isinstance(v, str) and v.strip() != ""`. */
const isStr = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
/**
 * `isinstance(v, int)` in Python: an integer and not a float. The reader gives
 * an int as a bigint (`intAsBigInt`), so `6` is a bigint and `6.0` is a
 * number — and `6.0` is exactly what the script refuses.
 */
const isInt = (value: unknown): boolean => typeof value === "bigint";
const isNum = (value: unknown): boolean => typeof value === "bigint" || (typeof value === "number" && !Number.isNaN(value));

/** Every check of the script, in its order, so the messages come out in its order too. */
export function validateProfile(profile: unknown): ProfileReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (message: string) => errors.push(message);
  const warn = (message: string) => warnings.push(message);
  const requireStr = (object: Dict, key: string, where: string) => {
    if (!isStr(object[key])) err(`${where}.${key}: non-empty string required`);
  };

  if (!isDict(profile)) {
    return { errors: ["(root): profile must be a top-level YAML object"], warnings };
  }
  for (const key of ["name", "target_role", "location", "seniority_target"]) requireStr(profile, key, "(root)");
  const years = profile["experience_years"];
  if (!isInt(years) || Number(years) < 0) err("experience_years: integer >= 0 required");
  if (typeof profile["has_degree"] !== "boolean") err("has_degree: boolean required");

  // skills: the canonical object, or the flat list of the transition.
  const skills = profile["skills"];
  if (isDict(skills)) {
    const primary = skills["primary"];
    if (!Array.isArray(primary) || primary.filter(isStr).length < 1) err("skills.primary: at least one skill required");
  } else if (Array.isArray(skills)) {
    warn("skills: legacy flat list — use { primary: [...], secondary: [...] }");
    if (skills.filter(isStr).length < 1) err("skills: at least one skill required");
  } else {
    err("skills: {primary, secondary} object required");
  }

  const languages = profile["languages"];
  if (!Array.isArray(languages) || languages.length === 0) {
    err("languages: list with at least one entry required");
  } else {
    for (const [i, entry] of languages.entries()) {
      if (!isDict(entry)) {
        err(`languages[${i}]: object required`);
        continue;
      }
      if (!isStr(entry["language"])) {
        if (isStr(entry["name"])) warn(`languages[${i}]: use 'language' (not 'name') — canonical key`);
        else err(`languages[${i}].language: required`);
      }
      if (!isStr(entry["level"])) err(`languages[${i}].level: required`);
    }
  }

  validateBlocks(profile["blocks"], err, requireStr);

  // The canonical target-role choice: a specialty without its category, or one
  // that does not belong to it, is what the onboarding must not save.
  const category = profile["target_role_category_id"];
  const specialty = profile["target_specialty"];
  if (category === undefined || category === null) {
    if (specialty !== undefined && specialty !== null) err("target_specialty: requires target_role_category_id");
  } else if (typeof category !== "string" || !(category in TARGET_ROLE_SPECIALTIES)) {
    err("target_role_category_id: invalid canonical ID");
  } else if (specialty !== undefined && specialty !== null && !TARGET_ROLE_SPECIALTIES[category]!.includes(specialty as string)) {
    err("target_specialty: invalid for target_role_category_id");
  }

  return { errors, warnings };
}

function validateBlocks(blocks: unknown, err: (message: string) => void, requireStr: (object: Dict, key: string, where: string) => void): void {
  if (blocks === undefined || blocks === null) return;
  if (!Array.isArray(blocks)) {
    err("blocks: list required");
    return;
  }
  const seen = new Set<string>();
  for (const [i, block] of blocks.entries()) {
    const where = `blocks[${i}]`;
    if (!isDict(block)) {
      err(`${where}: object required`);
      continue;
    }
    requireStr(block, "key", where);
    requireStr(block, "title", where);
    const key = block["key"];
    if (isStr(key)) {
      if (seen.has(key)) err(`${where}.key: duplicate '${key}'`);
      seen.add(key);
    }
    const kind = block["kind"];
    if (typeof kind !== "string" || !BLOCK_KINDS.includes(kind as (typeof BLOCK_KINDS)[number])) {
      err(`${where}.kind: invalid '${pyRepr(kind)}' (allowed: ${BLOCK_KINDS.join(", ")})`);
    } else {
      validateBlockContent(kind, block["content"], where, err);
    }
  }
}

function validateBlockContent(kind: string, content: unknown, where: string, err: (message: string) => void): void {
  const list = Array.isArray(content) ? content : null;
  switch (kind) {
    case "narrative":
      if (!isStr(content)) err(`${where}.content: non-empty text required for kind=narrative`);
      return;
    case "tag_list":
      if (list === null || list.some((item) => !isStr(item))) err(`${where}.content: list of strings required for kind=tag_list`);
      return;
    case "key_value":
      if (list === null) err(`${where}.content: list of {label,value} required`);
      else for (const [j, item] of list.entries()) if (!isDict(item) || !isStr(item["label"])) err(`${where}.content[${j}]: 'label' required`);
      return;
    case "key_points":
      if (list === null) err(`${where}.content: list of {heading,text} required`);
      else for (const [j, item] of list.entries()) if (!isDict(item) || !isStr(item["heading"])) err(`${where}.content[${j}]: 'heading' required`);
      return;
    case "timeline":
      if (list === null) err(`${where}.content: list of entries required for kind=timeline`);
      else for (const [j, item] of list.entries()) if (!isDict(item) || !isStr(item["title"])) err(`${where}.content[${j}]: 'title' required`);
      return;
    case "distribution":
      if (list === null) err(`${where}.content: list of {label,value} required`);
      else {
        for (const [j, item] of list.entries()) {
          if (!isDict(item) || !isStr(item["label"]) || !isNum(item["value"])) err(`${where}.content[${j}]: 'label' (str) + 'value' (num) required`);
        }
      }
      return;
    default:
      return;
  }
}

/** A value inside the script's message, as Python's f-string prints it. */
function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

export interface ValidateProfileResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * The script's command line: `validate_profile.py <path> [--strict] [--json]`,
 * with its own output and exit code (0 valid, 1 invalid, 2 usage).
 */
export function runValidateProfile(args: string[], resolve: (path: string) => string): ValidateProfileResult {
  const strict = args.includes("--strict");
  const asJson = args.includes("--json");
  const paths = args.filter((arg) => !arg.startsWith("--"));
  if (paths.length === 0) {
    return { stdout: "", stderr: "usage: validate_profile.py <candidate_profile.yml> [--strict] [--json]\n", exitCode: 2 };
  }

  let text: string;
  try {
    text = readFileSync(resolve(paths[0]!), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { stdout: "", stderr: `ERROR: file not found: ${paths[0]}\n`, exitCode: 1 };
    return { stdout: "", stderr: `ERROR: ${error instanceof Error ? error.message : String(error)}\n`, exitCode: 1 };
  }

  let data: unknown;
  try {
    data = pySafeLoad(text);
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `INVALID_PROFILE\nERROR: YAML could not be parsed: ${said}\n`, exitCode: 1 };
  }

  const { errors, warnings } = validateProfile(data);
  const blocking = [...errors, ...(strict ? warnings : [])];
  if (asJson) {
    // `json.dumps` spacing, not JSON.stringify's: the skill greps this line.
    return { stdout: `${pyJson({ ok: blocking.length === 0, errors, warnings })}\n`, stderr: "", exitCode: blocking.length === 0 ? 0 : 1 };
  }
  const said = [...warnings.map((w) => `WARN: ${w}`), ...errors.map((e) => `ERROR: ${e}`)];
  return {
    stdout: `${blocking.length === 0 ? "VALID_PROFILE" : "INVALID_PROFILE"}\n`,
    stderr: said.length === 0 ? "" : `${said.join("\n")}\n`,
    exitCode: blocking.length === 0 ? 0 : 1,
  };
}

export interface ValidateProfileToolOptions {
  /** The person's profile folder: what the tool may read. Absolute. */
  profileDir: string;
  /** Where a relative path resolves, and the other folder the role may validate from. Absolute. */
  workdir: string;
}

/**
 * The script as a tool. The path stays the caller's to name — the ASSISTENTE
 * validates the profile it just wrote, and sometimes a draft in its own home —
 * but it is resolved and confined to those two folders: a validator that reads
 * any file on the box is a file reader with a nice name.
 */
export function createValidateProfileTool(options: ValidateProfileToolOptions): ToolHandler {
  const roots = [realPath(options.profileDir), realPath(options.workdir)];
  const resolve = (path: string): string => {
    const target = realPath(resolveUserPath(path, options.workdir));
    if (!roots.some((root) => isInside(root, target))) {
      throw new OutsideProfile(`${path}: the profile validator reads the person's profile folder and your own, nothing else.`);
    }
    return target;
  };

  return argvTool({
    name: VALIDATE_PROFILE_TOOL,
    script: "validate_profile.py",
    description:
      "Validate a candidate profile against the canonical schema (A-02: every write of candidate_profile.yml is followed by this). " +
      "Prints VALID_PROFILE or INVALID_PROFILE with a WARN/ERROR line per problem; `--strict` makes the warnings blocking, `--json` prints the report.",
    okCodes: [0, 1],
    run: (args) => {
      try {
        return runValidateProfile(args, resolve);
      } catch (error) {
        if (error instanceof OutsideProfile) return { stdout: "", stderr: `ERROR: ${error.message}\n`, exitCode: 1 };
        throw error;
      }
    },
  });
}

class OutsideProfile extends Error {}
