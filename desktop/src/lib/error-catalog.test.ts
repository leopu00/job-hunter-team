// @vitest-environment node
/**
 * Every error code the person can meet has a sentence and an action.
 *
 * The codes are not listed by hand here: they are read from the sources.
 * - Rust: every snake_case literal of the modules lib.rs compiles (test
 *   modules excluded), plus the one-word codes at error sites (`failure("x")`,
 *   `Err("x")`, `code: "x"`, `|_| "x"`, `"x" =>`). Each one is either in the
 *   catalog or in NOT_ERRORS below, with the reason it never reaches the
 *   person. A new literal that is neither turns this test red: whoever adds a
 *   code writes its sentence, or says why it is not an error.
 * - TS: every `code: "x"` and `?? "x"` the desktop layer creates.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROR_CATALOG, NOT_EMITTED, describeError, errorCodeOf, errorResetsAt } from "./error-catalog";
import { EXISTING_TEAM_ERROR_CODES } from "./existing-team";
import { liveScreenErrorCode } from "./live-screen";
import { LOGIN_ERROR_CATALOG_CODE } from "./login-error-codes";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const RUST = fileURLToPath(new URL("../../src-tauri/src/", import.meta.url));

/** Literals that look like codes but never reach the person, and why. */
const NOT_ERRORS: Record<string, string> = {
  // Candidate profile fields validated by profile import and migration.
  birth_year: "profile field",
  candidate_profile: "profile artifact id",
  data_engineering: "profile category",
  data_science: "profile category",
  experience_months: "profile field",
  experience_years: "profile field",
  has_degree: "profile field",
  key_points: "profile block kind",
  key_value: "profile block kind",
  location_preferences: "profile field",
  schema_version: "profile field",
  seniority_target: "profile field",
  tag_list: "profile block kind",
  target_role: "profile field",
  target_role_category_id: "profile field",
  target_specialty: "profile field",
  technical_pm: "profile category",
  work_authorization: "profile field",
  // OAuth and Supabase protocol parameters.
  access_token: "oauth parameter",
  api_key: "oauth parameter",
  client_secret: "oauth parameter",
  code_challenge: "oauth parameter",
  code_challenge_method: "oauth parameter",
  code_verifier: "oauth parameter",
  error_description: "oauth parameter (its text is the detail of `denied`)",
  id_token: "oauth parameter",
  redirect_to: "oauth parameter",
  refresh_token: "oauth parameter",
  sb_flow_id: "oauth parameter",
  session_token: "oauth parameter",
  // Names, attributes and non-error states.
  snake_case: "serde attribute",
  known_hosts: "file name",
  jht_voice_input: "native library name",
  confirmation_required: "SSH host key probe status, not a failure",
  // Debug-only trace events (trace_local_runtime / trace_auth_store).
  cache_initialized: "debug trace event",
  keychain_read: "debug trace event",
  keychain_write: "debug trace event",
  install_failed: "debug trace event",
  install_required: "debug trace event",
  install_reused: "debug trace event",
  not_ready: "debug trace event",
  start_failed: "debug trace event",
  snapshot_not_ready: "debug trace event",
  // Written only to the local diagnostics file, never returned.
  diagnostic_encode_failed: "diagnostics file only",
  diagnostic_path_invalid: "diagnostics file only",
  diagnostic_record_invalid: "diagnostics file only",
  diagnostic_storage_failed: "diagnostics file only",
  diagnostic_storage_invalid: "diagnostics file only",
  // One-word values at error-looking sites that are not errors.
  claude: "provider id",
  codex: "provider id",
  kimi: "provider id",
  default: "browser id",
  manual: "browser id",
  granted: "permission state",
  local: "host kind",
  vps: "host kind",
  snapshot: "wrapper subcommand",
  status: "wrapper subcommand",
  up: "wrapper subcommand",
};

function compiledRustModules(): string[] {
  const lib = readFileSync(join(RUST, "lib.rs"), "utf8");
  const modules: string[] = [];
  const lines = lib.split("\n");
  lines.forEach((line, index) => {
    const match = /^mod (\w+);$/.exec(line.trim());
    if (match && lines[index - 1]?.trim() !== "#[cfg(test)]") modules.push(match[1]);
  });
  return modules;
}

function withoutTests(source: string): string {
  const index = source.indexOf("#[cfg(test)]\nmod tests");
  return index >= 0 ? source.slice(0, index) : source;
}

const SNAKE_LITERAL = /"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g;
const ERROR_SITE_WORD = /(?:failure|Err|ok_or|code:|\|_\||=>|Some|error:)\s*\(?\s*"([a-z][a-z0-9]*)"/g;

function rustCodes(): Set<string> {
  const codes = new Set<string>();
  for (const module of compiledRustModules()) {
    const source = withoutTests(readFileSync(join(RUST, `${module}.rs`), "utf8"));
    for (const match of source.matchAll(SNAKE_LITERAL)) codes.add(match[1]);
    for (const match of source.matchAll(ERROR_SITE_WORD)) codes.add(match[1]);
  }
  return codes;
}

function tsSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test-support" ? [] : tsSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) &&
      entry.name !== "error-catalog.ts" ? [path] : [];
  });
}

const TS_CODE = /code:\s*"([a-z][a-z0-9_]*)"|\?\?\s*"([a-z][a-z0-9]*_[a-z0-9_]+)"|fallback:\s*"([a-z][a-z0-9_]*)"/g;

function tsCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of tsSources(SRC)) {
    for (const match of readFileSync(file, "utf8").matchAll(TS_CODE)) codes.add(match[1] ?? match[2] ?? match[3]);
  }
  return codes;
}

describe("error catalog", () => {
  const rust = rustCodes();
  const ts = tsCodes();

  it("reads the real sources, not an empty search", () => {
    expect(compiledRustModules()).toEqual(expect.arrayContaining(["onboarding", "direct_chat", "auth_login"]));
    expect(rust.size).toBeGreaterThan(200);
    expect([...ts]).toEqual(expect.arrayContaining([
      "desktop_only", "local_migration_in_progress", "receipt_unverified", "status_failed", "reconnect_failed",
    ]));
  });

  it("has a sentence and an action for every Rust code that can reach the person", () => {
    const missing = [...rust].filter((code) => !(code in ERROR_CATALOG) && !(code in NOT_ERRORS)).sort();
    expect(missing, "codes with no sentence: add them to ERROR_CATALOG or to NOT_ERRORS with a reason").toEqual([]);
  });

  it("has a sentence and an action for every code the TS layer creates", () => {
    const missing = [...ts].filter((code) => !(code in ERROR_CATALOG)).sort();
    expect(missing).toEqual([]);
  });

  it("covers the codes of the screens that used to keep their own map", () => {
    const login = Object.values(LOGIN_ERROR_CATALOG_CODE).filter((code) => !(code in ERROR_CATALOG));
    expect(login, "login codes without a catalog entry").toEqual([]);
    const existingTeam = [...EXISTING_TEAM_ERROR_CODES].filter((code) => !(code in ERROR_CATALOG));
    expect(existingTeam, "existing-team codes without a catalog entry").toEqual([]);
    for (const native of ["screen_not_running", "invalid_password", "invalid_port", "home_missing", "window_failed", "brand_new"]) {
      const code = liveScreenErrorCode({ code: native });
      expect(code in ERROR_CATALOG, `${native} -> ${code}`).toBe(true);
    }
    expect(liveScreenErrorCode({ code: "invalid_port" })).toBe("live_screen_invalid_port");
    expect(liveScreenErrorCode(new Error("boom"))).toBe("live_screen_failed");
  });

  it("does not count codes nothing emits as covered: they are marked, and a marked one may not be emitted", () => {
    for (const code of NOT_EMITTED) expect(code in ERROR_CATALOG, code).toBe(true);
    const rustSources = compiledRustModules()
      .map((module) => withoutTests(readFileSync(join(RUST, `${module}.rs`), "utf8")))
      .join("\n");
    const tsSourceText = tsSources(SRC).map((file) => readFileSync(file, "utf8")).join("\n");
    for (const code of NOT_EMITTED) {
      // Rust: the only place allowed is the message table of failure().
      const anywhere = rustSources.split(`"${code}"`).length - 1;
      const inTable = rustSources.split(`"${code}" =>`).length - 1;
      expect(anywhere - inTable, `${code} is emitted by Rust: take it out of NOT_EMITTED`).toBe(0);
      // TS: never produced as a code.
      const produced = new RegExp(`(?:code:|\\?\\?|return)\\s*"${code}"`);
      expect(produced.test(tsSourceText), `${code} is produced by TS: take it out of NOT_EMITTED`).toBe(false);
    }
  });

  it("keeps NOT_ERRORS honest: each entry still exists and is not also a catalog code", () => {
    const stale = Object.keys(NOT_ERRORS).filter((code) => !rust.has(code)).sort();
    expect(stale, "remove entries the sources no longer contain").toEqual([]);
    const both = Object.keys(NOT_ERRORS).filter((code) => code in ERROR_CATALOG).sort();
    expect(both).toEqual([]);
  });

  it("writes every entry in Italian and English, as a sentence and an action, never as the code", () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      for (const locale of ["it", "en"] as const) {
        for (const text of [entry.text[locale], entry.action[locale]]) {
          expect(text.trim().length, `${code}/${locale}`).toBeGreaterThan(8);
          expect(text, `${code}/${locale}`).not.toMatch(/\b[a-z]+_[a-z0-9_]+\b/);
          expect(text, `${code}/${locale}`).toMatch(/[.!?]$/);
        }
      }
    }
  });
});

describe("describeError", () => {
  const now = Date.UTC(2026, 9, 8, 9, 0);

  it("gives the catalog sentence and action", () => {
    const described = describeError("team_verify_failed");
    expect(described).toMatchObject({ code: "team_verify_failed", known: true });
    expect(described.text).toBe("Assistente e Capitano non risultano entrambi attivi.");
    expect(described.action).toContain("Riprova l’avvio");
  });

  it("never shows an unknown code, it falls back to the generic copy", () => {
    const described = describeError("brand_new_backend_code");
    expect(described.known).toBe(false);
    expect(described.text).toBe(ERROR_CATALOG.unknown.text.it);
    expect(`${described.text} ${described.action}`).not.toContain("brand_new_backend_code");
    expect(describeError(null).text).toBe(ERROR_CATALOG.unknown.text.it);
    expect(describeError("__proto__").known).toBe(false);
    expect(describeError("unknown").known).toBe(false);
  });

  it("uses the screen's own fallback for an unknown code, never the code", () => {
    const described = describeError("brand_new_backend_code", { fallback: "profile_import_failed" });
    expect(described.known).toBe(false);
    expect(described.text).toBe(ERROR_CATALOG.profile_import_failed.text.it);
    expect(describeError("unknown", { fallback: "profile_import_failed" }).text)
      .toBe(ERROR_CATALOG.profile_import_failed.text.it);
    // A known code wins over the fallback.
    expect(describeError("host_key_changed", { fallback: "profile_import_failed" }).text)
      .toBe(ERROR_CATALOG.host_key_changed.text.it);
  });

  it("uses English only for unsupported locales", () => {
    expect(describeError("agent_busy", { locale: "en" }).text).toBe(ERROR_CATALOG.agent_busy.text.en);
    expect(describeError("agent_busy", { locale: "nl" }).text).toBe(ERROR_CATALOG.agent_busy.text.en);
    expect(describeError("agent_busy").text).toBe(ERROR_CATALOG.agent_busy.text.it);
  });

  it("says when exhausted provider limits free again", () => {
    const resetsAt = Math.floor(Date.UTC(2026, 9, 8, 13, 30) / 1000);
    const described = describeError("provider_limits_exhausted", { resetsAt, now });
    const time = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" })
      .format(new Date(resetsAt * 1000));
    expect(described.known).toBe(true);
    expect(described.text).toContain(time);
    expect(described.action).toContain(time);
    expect(described.text).not.toContain("{time}");
  });

  it("names the day when the limits free on another day", () => {
    const resetsAt = Math.floor(Date.UTC(2026, 9, 11, 9, 0) / 1000);
    const described = describeError("provider_limits_exhausted", { resetsAt, now });
    const day = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" })
      .format(new Date(resetsAt * 1000));
    expect(described.text).toContain(day);
  });

  it("never shows a placeholder when the time is missing", () => {
    const described = describeError("provider_limits_exhausted");
    expect(described.known).toBe(false);
    expect(described.text).not.toContain("{time}");
  });

  it("reads the code and the reset time from native errors", () => {
    expect(errorCodeOf({ code: "host_key_changed", message: "x" })).toBe("host_key_changed");
    expect(errorCodeOf("host_key_changed")).toBe("host_key_changed");
    expect(errorCodeOf({ code: "Bad Code" })).toBeNull();
    expect(errorCodeOf(new Error("boom"))).toBeNull();
    expect(errorResetsAt({ code: "provider_limits_exhausted", resetsAt: 1_900_000_000 })).toBe(1_900_000_000);
    expect(errorResetsAt({ resetsAt: -1 })).toBeNull();
    expect(errorResetsAt(null)).toBeNull();
  });
});
