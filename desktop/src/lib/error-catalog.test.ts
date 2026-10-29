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
import { ERROR_CATALOG, ERROR_LOCALES, NOT_EMITTED, describeError, errorCodeOf, errorMachineOf, errorResetsAt } from "./error-catalog";
import { ERROR_CATALOG_LOCALES } from "./error-catalog.locales";
import { EXISTING_TEAM_ERROR_CODES } from "./existing-team";
import { isRuntimeTextKey } from "./onboarding-runtime.i18n";
import { liveScreenErrorCode } from "./live-screen";
import { LOGIN_ERROR_CATALOG_CODE } from "./login-error-codes";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const RUST = fileURLToPath(new URL("../../src-tauri/src/", import.meta.url));

/** Literals that look like codes but never reach the person, and why. */
const NOT_ERRORS: Record<string, string> = {
  // runtime_log.rs ATTEST_REASONS: the step of the container check a failed chat read stopped at, written beside
  // the failure in runtime.log (`local_container_not_attested (label_project)`). The person is told the failure's
  // own code; these words are for whoever reads the log.
  ...Object.fromEntries(
    [
      "hash_tool_missing", "hash_podman_version_unreadable", "hash_podman_version_differs", "hash_machine_file",
      "hash_compose_version_unreadable", "hash_compose_version_differs", "hash_image_pin", "hash_dry_run_exit",
      "hash_dry_run_timeout", "hash_dry_run_not_started", "hash_plan_without_create", "hash_plan_ambiguous",
      "label_project", "label_service", "label_container_number", "label_working_dir", "label_hash_form",
      "label_config_files", "label_compose_version", "label_systemd_unit", "label_config_hash_differs",
      "label_image", "label_windows",
    ].map((word) => [word, "reason word of runtime.log beside a container check failure, never shown to the person"]),
  ),
  // private_copy.rs: the extensions a private copy of a document can have, from a fixed list in the module. Words of a file
  // name, never an error the person is told.
  ...Object.fromEntries(
    ["pdf", "docx", "odt", "rtf", "xlsx", "ods", "pptx", "odp", "png", "jpg", "gif", "webp", "txt", "md"].map((extension) => [
      extension,
      "extension of the private copy of a document (private_copy.rs), never shown as an error",
    ]),
  ),
  // team_settings.rs: the verbs of `jht team-settings`, the keys of the settings the page edits, and the
  // box's own word for a refused value, which is mapped to team_settings_value_invalid before the person sees it.
  apply: "verb of the team-settings command, not an error",
  get: "verb of the team-settings command, not an error",
  role_models: "key of the team settings JSON, not an error",
  working_hours: "key of the team settings JSON, not an error",
  min_window_hours: "key of the lists the team settings answer with, not an error",
  value_invalid: "the box's word for a refused value (team_settings.rs), mapped to team_settings_value_invalid",
  // public_pages.rs and app_update.rs: the page reads `ok` and says its own sentence (lib/public-pages.ts); the
  // other word is a field of the project's public release list.
  public_page_unknown: "reply of open_public_page: the page only reads ok and says its own sentence",
  public_page_window_refused: "reply of open_public_page: the page only reads ok and says its own sentence",
  tag_name: "field of the public release list read in app_update.rs, not an error",
  // What the start-up reopening did with the record of the full connection, for the runtime log only
  // (runtime_log.rs record_full_link; "restored" is the fourth word): the person sees the fixed row, not these.
  discarded: "closed word of the runtime log for the record of the full connection",
  expired: "closed word of the runtime log for the record of the full connection",
  not_restored: "closed word of the runtime log for the record of the full connection",
  // The Windows autostart's nonfatal notice id in windows_runtime.rs; it is
  // interpreted there, never shown through the error catalog.
  autostart_inactive: "id of the nonfatal Windows autostart notice",
  // The rule a node of the installed runtime broke, for the runtime log only (windows_runtime.rs).
  acl_inherited: "closed word of the runtime log for the runtime attestation",
  acl_user_missing: "closed word of the runtime log for the runtime attestation",
  acl_other_account: "closed word of the runtime log for the runtime attestation",
  acl_unreadable: "closed word of the runtime log for the runtime attestation",
  user_unreadable: "closed word of the runtime log for the runtime attestation",
  ancestor_reparse: "closed word of the runtime log for the runtime attestation",
  kind: "closed word of the runtime log for the runtime attestation",
  missing: "closed word of the runtime log for the runtime attestation",
  owner: "closed word of the runtime log for the runtime attestation",
  reparse: "closed word of the runtime log for the runtime attestation",
  // How a step of the autostart registration ended, for the runtime log only (windows_runtime.rs).
  autostart_sid_unreadable: "closed word of the runtime log for the autostart registration",
  autostart_stage_failed: "closed word of the runtime log for the autostart registration",
  autostart_contract_mismatch: "closed word of the runtime log for the autostart registration",
  // The container engine executable the app resolves and spawns (direct_chat.rs, onboarding.rs).
  docker: "name of the container engine program, not a code",
  // A successful, idempotent broker receipt: the native side accepts it and
  // does not return it as an error to the person.
  already_recorded: "successful idempotent broker receipt",
  // What ssh prints when the server turns an address away; read to pick ssh_rate_limited.
  kex_exchange_identification: "text of ssh stderr, not a code",
  // The reader's op cloud_sync and the fields of its reply (existing_team_runtime.rs): the page
  // shows them in its own words (cloud-sync-card), they are never a code to describe.
  cloud_sync: "op of the existing team's reader, not a code",
  absent: "state of the cloud_sync reply, shown by the team page's card",
  ok: "state of the cloud_sync reply, shown by the team page's card",
  auth_failed: "status of the box's periodic push in the cloud_sync reply, shown by the card",
  signature_unavailable: "status of the box's periodic push in the cloud_sync reply, shown by the card",
  consecutive_failures: "field of the cloud_sync reply, not a code",
  last_attempt_at: "field of the cloud_sync reply, not a code",
  last_success_at: "field of the cloud_sync reply, not a code",
  // The direct chat's system lines (direct_chat.rs): a closed code on a line of the conversation, said by the
  // chat page from its own catalog (direct-chat.i18n.ts), and the name of the serde function that lets only
  // that list through. Neither is an error the person is told.
  mail_not_taken: "closed code of a system line of the chat, not an error",
  message_too_long: "closed code of a system line of the chat, not an error",
  closed_code: "name of a serde function in direct_chat.rs, not a code",
  closed_reason: "name of a serde function in direct_chat.rs, not a code",
  message_kind: "name of a serde function in direct_chat.rs, not a code",
  taken_flag: "name of a serde function in direct_chat.rs, not a code",
  closed_queue: "name of a serde function in direct_chat.rs, not a code",
  closed_activity: "name of a serde function in direct_chat.rs, not a code",
  queued_ids: "name of a serde function in direct_chat.rs, not a code",
  queue_endings: "name of a serde function in direct_chat.rs, not a code",
  queued: "state of a receipt (the team holds the turn), said as «In coda» by the chat page, not an error",
  // The answer to an agent's question (direct_chat.rs, direct_chat_answer): the refusals the chat page
  // says next to the question, from its own catalog (direct-chat.i18n.ts, answerErrors).
  question_closed: "refusal of an answer, said by the chat page next to the question",
  invalid_choice: "refusal of an answer, said by the chat page next to the question",
  // Why the team does not know whether the agent's CLI took a text (TAKEN_REASONS): said by the chat page
  // next to the message, from its own catalog, never as an error.
  not_ours: "reason of a receipt with taken null, said by the chat page",
  empty_unseen: "reason of a receipt with taken null, said by the chat page",
  // A file attached in the Assistant's chat (direct_chat.rs direct_chat_attach, chat_attachment.rs): the refusals and
  // the reasons the paperclip is off are said by the chat page next to the composer, from its own catalog
  // (direct-chat.i18n.ts, attachErrors and attachOff), never through the error catalog.
  attach_platform: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attach_vps: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attach_read_only: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attach_not_connected: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attach_busy: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attach_failed: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachment_unreadable: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachment_type: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachment_type_mismatch: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachment_too_big: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachment_is_link: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachment_not_file: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachments_folder_unsafe: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachments_folder_full: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachment_save_failed: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  attachment_not_shared: "refusal or reason of the chat's paperclip, said by the chat page next to the composer",
  // The moments chat_attachment.rs tells a test (the person's file open, its size checked, the folder open) and the
  // outcome of an attachment: neither reaches the person.
  source_open: "moment of an attachment the tests act on, not an error",
  source_checked: "moment of an attachment the tests act on, not an error",
  folder_open: "moment of an attachment the tests act on, not an error",
  saved_not_sent: "outcome of an attachment (copied, the Assistant not told), said by the chat page",
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
  // How the profile file of an existing team was read: states the Profile page tells in its
  // own sentences, not errors.
  aliases_unsupported: "profile file parse state",
  invalid_yaml: "profile file parse state",
  not_a_mapping: "profile file parse state",
  none: "profile file parse state (no profile file)",
  // The values of the person's judgement on a position, sent to the VPS's position script
  // (existing_team_judgement.rs): verbs of the request, never an outcome or an error.
  like: "position judgement value",
  dislike: "position judgement value",
  hide: "position judgement value",
  clear: "position judgement value",
  star: "position judgement value",
  more_like_this: "position judgement direction (feedback_record)",
  less_like_this: "position judgement direction (feedback_record)",
  // What the Writer is asked for in a write request: the closed kinds of write_request.py.
  cv: "write request kind",
  cover_letter: "write request kind",
  // The exclusions of the profile decided from the panel (agent_control.rs): the codes with an underscore that act on
  // the score, the field names of the judgements the proposals are made of, and a result word.
  salary_low: "exclusion code (shared/feedback-reasons.json)",
  wrong_location: "exclusion code (shared/feedback-reasons.json)",
  wrong_stack: "exclusion code (shared/feedback-reasons.json)",
  too_senior: "exclusion code (shared/feedback-reasons.json)",
  too_junior: "exclusion code (shared/feedback-reasons.json)",
  created_at: "field of the jobs.db judgement read",
  decided_at: "field of the jobs.db exclusion read",
  legacy_id: "field of the jobs.db judgement read",
  exclusion_withdrawn: "result word of an exclusion withdrawn",
  exclusion_accept: "operation name of the panel's request",
  exclusion_withdraw: "operation name of the panel's request",
  stop_team: "operation name of the panel's request (JHT-T54: «Ferma la squadra»)",
  // How a previous session of an agent ended (the panel's history read, agent_control.rs): a state of the session
  // the Agents page tells in its own words, not an error.
  restarted_by_user: "how a previous session ended",
  stopped_by_user: "how a previous session ended",
  started_again: "how a previous session ended",
  // The outcome of «Attiva assistente» when the assistant was already running: a result, not an error.
  already_active: "assistant start outcome",
  // The outcome of the in-app registration of a team's target: a result, not an error.
  registered: "target registration outcome",
  already_registered: "target registration outcome",
  restored: "target registration outcome",
  rebound: "target registration outcome",
  target_role: "profile field",
  target_role_category_id: "profile field",
  target_specialty: "profile field",
  technical_pm: "profile category",
  work_authorization: "profile field",
  domain_expertise: "profile field",
  sector_details: "profile field",
  target_roles: "profile field",
  target_roles_priority: "profile field",
  // Columns the positions reader of an existing team may sort by (existing_team_runtime.rs).
  applied_at: "positions sort column",
  found_at: "positions sort column",
  last_action_at: "positions sort column",
  last_action_by: "positions sort column",
  loc_city: "positions sort column",
  loc_country: "positions sort column",
  role_family: "positions sort column",
  written_at: "positions sort column",
  // The assisted browser (closer_desktop.rs): request and reply fields, input kinds, and the
  // registration's reply.
  display_id: "assisted browser request field",
  event_id: "assisted browser request field",
  frame_sequence: "assisted browser request field",
  mission_id: "assisted browser request field",
  owner_id: "assisted browser request field",
  position_id: "assisted browser request field",
  review_id: "assisted browser request field",
  key: "assisted browser input kind",
  pointer: "assisted browser input kind",
  assistance_ready: "assisted browser registration reply field, not an error",
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
  jht: "compose project and service name",
  jht_voice_input: "native library name",
  runtime_untrusted: "detail of the generic container-not-ready diagnostic, not its error code",
  team_state: "runtime log step label",
  confirmation_required: "SSH host key probe status, not a failure",
  // Debug-only trace events (trace_local_runtime / trace_auth_store).
  cache_initialized: "debug trace event",
  keychain_read: "debug trace event",
  keychain_write: "debug trace event",
  install_failed: "debug trace event",
  install_required: "debug trace event",
  install_reused: "debug trace event",
  installed_on_another_engine: "debug trace event",
  not_ready: "debug trace event",
  start_failed: "debug trace event",
  snapshot_not_ready: "debug trace event",
  snapshot_not_configured: "debug trace event",
  // Name of a local runtime-log step, never an error returned to the person.
  provider_login: "runtime log step label",
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
  production: "release channel name (release_channel_rules.rs), not an error",
  snapshot: "wrapper subcommand",
  status: "wrapper subcommand",
  up: "wrapper subcommand",
  // The mailbox (mail.rs): broker words read from `jht mail status`, and the
  // broker's setup reasons, each mapped to a mail_* catalog code.
  allowlist: "mail admission policy",
  whole_mailbox: "mail admission policy",
  email_monitor: "broker secret name",
  present: "broker secret state",
  password_not_utf8: "broker reason, shown as mail_password_invalid",
  secret_password_missing: "broker reason, shown as mail_password_missing",
  secret_user_missing: "broker reason, shown as mail_address_invalid",
  // States of the broker's LinkedIn login (`jht linkedin status`), shown as a status.
  logged_in: "broker login state",
  login_required: "broker login state",
  // install.ps1's phases (windows_runtime::INSTALL_PHASES): shown as progress, never an error.
  wsl_check: "install.ps1 phase id",
  podman_install: "install.ps1 phase id",
  podman_machine_init: "install.ps1 phase id",
  podman_machine_start: "install.ps1 phase id",
  runtime_download: "install.ps1 phase id",
  image_pull: "install.ps1 phase id",
  team_restart: "enable-podman-windows-runtime.ps1 phase id",
  // runtime_log.rs: a log that cannot be written never stops the step it describes (RuntimeLog::record drops it).
  runtime_log_failed: "runtime log write, never surfaced",
  runtime_log_invalid: "runtime log write, never surfaced",
  // runtime_log.rs: an existing-team connection's phases and outcomes, written only to the private log.
  scope: "runtime log phase name",
  validate_host: "runtime log phase name",
  read_only_open: "runtime log phase name",
  candidate: "runtime log phase name",
  ssh: "runtime log phase name",
  activation: "runtime log phase name",
  final: "runtime log phase name",
  io_error_other: "runtime log word for a code outside its allowlist, never returned",
  process_write_failed: "named only by the runtime log's allowlist: nothing emits it",
  // existing_team_register.rs: a probe reply over its size limit; the probe returns existing_team_unavailable instead.
  process_output_unavailable: "probe output too large, shown as existing_team_unavailable",
  // jht.ps1 uninstall's phases (windows_runtime::UNINSTALL_PHASES): shown as progress, never an error.
  uninstall_machine: "jht.ps1 uninstall phase id",
  uninstall_runtime: "jht.ps1 uninstall phase id",
  uninstall_commands: "jht.ps1 uninstall phase id",
  // vps_link.rs: the kind of a failed read of a team on a VPS, sent with its catalog code.
  network: "vps link kind",
  application: "vps link kind",
  version: "vps link kind",
  blocked: "vps link kind",
  // The agents' control panel (agent_control.rs): the outcomes of an action,
  // which the page says with its own sentences, and the fields of its reads.
  already_paused: "agent control outcome",
  already_running: "agent control outcome",
  already_stopped: "agent control outcome",
  already_answered: "agent control outcome: the question was answered elsewhere first (the page says it)",
  not_paused: "agent control outcome",
  team_stopped: "agent control outcome",
  team_already_stopped: "agent control outcome",
  existing_team_runtime_own_vps_invalid: "own-VPS mark: refused or unreadable, never shown (the setup says storage_unavailable)",
  existing_team_runtime_own_vps_missing: "own-VPS mark: absent, read as «not the person's own»",
  // Where a VPS of the person's own stands, as the agents list tells the page (own_vps_claim_* are the errors).
  claimable: "own-VPS state word: no mark yet, the page offers the claim",
  key_changed: "own-VPS state word: the host key is not the marked one, the page offers a new claim",
  marked: "own-VPS state word: the mark is there",
  not_own: "own-VPS state word: an existing team or this computer",
  own_vps_claim: "runtime-log label of the claim, not an error",
  user_id: "field of the claim's identity probe (the account's id, from the backend's own session)",
  by_user: "agent control read field",
  weekly_reset: "agent control pause exit kind",
  burn_intent: "agent control read field (the full-throttle override)",
  expires_at: "agent control read field (when the full-throttle override ends)",
  remaining_min: "agent control read field (minutes left of the full-throttle override)",
  // An agent's health in the list (existing_team_agents.rs shape_usage): numbers, never an outcome.
  context_pct: "agent list read field (how full the agent's context is)",
  context_tokens: "agent list read field (the tokens of the agent's last call)",
  context_window: "agent list read field (the window of the agent's model, when its CLI writes it)",
  context_at: "agent list read field (when the context was read)",
  tokens_1h: "agent list read field (the agent's tokens of the last hour)",
  tokens_at: "agent list read field (when the hour was counted)",
  // The positions table's CSV export (export_file.rs): the page catches every failure of
  // `export_csv_save` and says its own sentence (page.i18n.ts, export_failed); the code
  // itself never reaches the person.
  export_dir_unavailable: "CSV export failure, said by the page as export_failed",
  export_name_invalid: "CSV export failure, said by the page as export_failed",
  export_window: "CSV export failure, said by the page as export_failed",
  export_write_failed: "CSV export failure, said by the page as export_failed",
  // install.ps1's notice id (windows_runtime.rs, INSTALL_NOTICES): not a failure, the setup
  // goes on; the person reads ui_notice_windows10_unsupported (onboarding-runtime.i18n.ts).
  windows10_unsupported: "id of install.ps1's JHT_NOTICE line, told as ui_notice_windows10_unsupported",
  // The Mac setup's own notice (windows_runtime.rs, INSTALL_NOTICES): the machine that exists has less
  // memory than the team needs; not a failure, told as ui_notice_podman_machine_memory_low.
  podman_machine_memory_low: "id of the notice of a Podman machine with too little memory, told as ui_notice_podman_machine_memory_low",
};

function compiledRustModules(): string[] {
  const lib = readFileSync(join(RUST, "lib.rs"), "utf8");
  const modules: string[] = [];
  const lines = lib.split("\n");
  lines.forEach((line, index) => {
    const match = /^mod (\w+);$/.exec(line.trim());
    // A module behind any `#[cfg(...test...)]` (`test`, `all(test, unix)`) is test code.
    if (match && !/^#\[cfg\(.*\btest\b.*\)\]$/.test(lines[index - 1]?.trim() ?? "")) modules.push(match[1]);
  });
  return modules;
}

/**
 * The files the compiled modules are made of: each module, plus the non-test files it pulls in
 * with `#[path = "x.rs"] mod y;` (the assisted browser's transport is one).
 */
function compiledRustFiles(): string[] {
  return compiledRustModules().flatMap((module) => {
    const lines = readFileSync(join(RUST, `${module}.rs`), "utf8").split("\n");
    const submodules = lines.flatMap((line, index) => {
      const match = /^#\[path = "([\w.]+\.rs)"\]$/.exec(line.trim());
      const test = /^#\[cfg\(.*\btest\b.*\)\]$/.test(lines[index - 1]?.trim() ?? "");
      return match && !test && /^mod \w+;$/.test(lines[index + 1]?.trim() ?? "") ? [match[1]] : [];
    });
    return [`${module}.rs`, ...submodules];
  });
}

function withoutTests(source: string): string {
  const index = source.indexOf("#[cfg(test)]\nmod tests");
  return index >= 0 ? source.slice(0, index) : source;
}

const SNAKE_LITERAL = /"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g;
const ERROR_SITE_WORD = /(?:failure|Err|ok_or|code:|\|_\||=>|Some|error:)\s*\(?\s*"([a-z][a-z0-9]*)"/g;

function rustCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of compiledRustFiles()) {
    const source = withoutTests(readFileSync(join(RUST, file), "utf8"));
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
    expect(compiledRustFiles()).toContain("closer_desktop_transport.rs");
    expect(compiledRustFiles()).not.toContain("closer_desktop_tests.rs");
    expect(rust.size).toBeGreaterThan(200);
    expect([...ts]).toEqual(expect.arrayContaining([
      "desktop_only", "local_migration_in_progress", "receipt_unverified", "status_failed", "reconnect_failed",
    ]));
  });

  it("has a sentence and an action for every Rust code that can reach the person", () => {
    // `ui_*` keys are texts, not errors: the onboarding's progress, phases
    // and login instructions, told by onboarding-runtime.i18n.ts. A `ui_*`
    // key that table lacks is still reported here.
    const missing = [...rust]
      .filter((code) => !(code in ERROR_CATALOG) && !(code in NOT_ERRORS) && !isRuntimeTextKey(code))
      .sort();
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
    const rustSources = compiledRustFiles()
      .map((file) => withoutTests(readFileSync(join(RUST, file), "utf8")))
      .join("\n");
    const tsSourceText = tsSources(SRC).map((file) => readFileSync(file, "utf8")).join("\n");
    for (const code of NOT_EMITTED) {
      // Rust: the only places allowed are match patterns, which read a code and never
      // produce one: the message table of failure() (`"x" =>`) and allowlists such as
      // the runtime log's (`"a" | "x"`, a line opening with `| "x"`).
      const anywhere = rustSources.split(`"${code}"`).length - 1;
      const inPattern = rustSources.match(
        new RegExp(`(?:"[a-z0-9_]+"\\s*\\||^\\s*\\|)\\s*"${code}"|"${code}"\\s*(?:=>|\\|)`, "gm"),
      )?.length ?? 0;
      expect(anywhere - inPattern, `${code} is emitted by Rust: take it out of NOT_EMITTED`).toBe(0);
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

// The two panels of the assisted browser: the panel on the team page and the registration of its
// VPS in the first setup. What they can receive is read from their sources, not listed here.
const PANEL_SOURCES = [
  "closer-desktop/session.ts", "closer-desktop/CloserDesktopPanel.tsx", "lib/closer-desktop.ts",
  "lib/closer-desktop-connection.ts", "onboarding/FirstSetupAssistance.tsx",
];
/** Literals of those sources that are not codes. */
const PANEL_NOT_ERRORS: Record<string, string> = {
  delete_snapshot: "assisted browser request op",
  handoff_pending: "assisted browser phase",
  review_wait: "assisted browser phase",
  closer_desktop_request: "native command name",
  closer_desktop_register_host: "native command name",
};
const BRIDGE = fileURLToPath(new URL("../../src-tauri/src/closer_desktop_bridge.py", import.meta.url));

/** The codes the VPS bridge can answer with: its `ValueError("x")`s, FAILED, and its allowlist. */
function bridgeCodes(): Set<string> {
  const source = readFileSync(BRIDGE, "utf8");
  const codes = new Set([...source.matchAll(/"(browser_[a-z0-9_]+)"/g)].map((match) => match[1]));
  const allowlist = /"browser_"\s*\+\s*c\s+for\s+c\s+in\s+\(([^)]*)\)/.exec(source)?.[1] ?? "";
  for (const match of allowlist.matchAll(/"([a-z0-9_]+)"/g)) codes.add(`browser_${match[1]}`);
  return codes;
}

describe("the assisted browser panels", () => {
  it("has a sentence and an action for every code the two panels and the VPS bridge produce", () => {
    const panel = new Set(PANEL_SOURCES.flatMap((file) =>
      [...readFileSync(join(SRC, file), "utf8").matchAll(SNAKE_LITERAL)].map((match) => match[1])));
    expect([...panel]).toEqual(expect.arrayContaining(["desktop_request_denied", "desktop_image_invalid", "ssh_host_key_invalid"]));
    const missing = [...panel].filter((code) => !(code in ERROR_CATALOG) && !(code in PANEL_NOT_ERRORS)).sort();
    expect(missing, "panel codes with no sentence").toEqual([]);
    const stale = Object.keys(PANEL_NOT_ERRORS).filter((code) => !panel.has(code)).sort();
    expect(stale, "remove entries the panel sources no longer contain").toEqual([]);

    expect(readFileSync(join(RUST, "closer_desktop.rs"), "utf8")).toContain('include_str!("closer_desktop_bridge.py")');
    const bridge = bridgeCodes();
    expect([...bridge]).toEqual(expect.arrayContaining(["browser_container_mismatch", "browser_transport_timeout"]));
    expect([...bridge].filter((code) => !(code in ERROR_CATALOG)).sort(), "bridge codes with no sentence").toEqual([]);
  });

  const NEW_CODES = [
    "browser_transport_timeout", "browser_container_mismatch", "browser_image_mismatch",
    "desktop_request_denied", "desktop_descriptor_unavailable", "desktop_frame_invalid",
    "desktop_snapshot_invalid", "desktop_image_invalid", "ssh_host_key_invalid",
  ];
  it.each(ERROR_LOCALES)("%s: says each code of the panels in that language, never as the code", (locale) => {
    for (const code of NEW_CODES) {
      const described = describeError(code, { locale });
      expect(described.known, code).toBe(true);
      const [text, action] = locale === "it" || locale === "en"
        ? [ERROR_CATALOG[code].text[locale], ERROR_CATALOG[code].action[locale]]
        : ERROR_CATALOG_LOCALES[code][locale];
      expect([described.text, described.action], `${code}/${locale}`).toEqual([text, action]);
      if (locale !== "en") expect(described.text, `${code}/${locale}`).not.toBe(ERROR_CATALOG[code].text.en);
      expect(`${described.text} ${described.action}`, `${code}/${locale}`).not.toMatch(/\b[a-z]+_[a-z0-9_]+\b/);
    }
  });
});

describe("the assisted browser's sentences for what the code cannot tell apart", () => {
  it("browser_container_mismatch: the bridge says it for a merely stopped container too, and the sentence covers that", () => {
    const bridge = readFileSync(BRIDGE, "utf8");
    const raise = bridge.indexOf('raise ValueError("browser_container_mismatch")');
    expect(raise).toBeGreaterThan(0);
    const condition = bridge.slice(bridge.lastIndexOf("if (", raise), raise);
    expect(condition, "the condition that raises it").toContain('info.get("Run") is not True');
    // Each language says the team may be off and asks to start it first.
    const STOPPED: Record<string, [RegExp, RegExp]> = {
      it: [/spenta/, /^Avvia la squadra/], en: [/ is off /, /^Start the team/], de: [/ ist aus /, /^Starte das Team/],
      es: [/apagado/, /^Inicia el equipo/], fr: [/arrêtée/, /^Démarre l’équipe/],
      hu: [/ki van kapcsolva/, /^Indítsd el a csapatot/], pt: [/desligada/, /^Inicia a equipa/],
    };
    for (const locale of ERROR_LOCALES) {
      const { text, action, known } = describeError("browser_container_mismatch", { locale });
      expect(known, locale).toBe(true);
      expect(text, locale).toMatch(STOPPED[locale][0]);
      expect(action, locale).toMatch(STOPPED[locale][1]);
    }
    // An image mismatch comes only from a running container: it keeps its own sentence — in EVERY
    // language, not just the default one (T10): a translation that copied the stopped-container
    // sentence into the image one would tell a person with a running team to start it.
    for (const locale of ERROR_LOCALES) {
      const image = describeError("browser_image_mismatch", { locale });
      const container = describeError("browser_container_mismatch", { locale });
      expect(image.known, locale).toBe(true);
      expect(image.text, locale).not.toBe(container.text);
      expect(image.action, locale).not.toBe(container.action);
      expect(image.text, locale).not.toMatch(STOPPED[locale][0]);
    }
  });

  it("ssh_host_key_invalid: names the ed25519 key the VPS did not offer, never host and port", () => {
    for (const locale of ERROR_LOCALES) {
      const { text, action, known } = describeError("ssh_host_key_invalid", { locale });
      expect(known, locale).toBe(true);
      expect(text, locale).toContain("ed25519");
      expect(action, locale).toContain("ed25519");
    }
    expect(describeError("ssh_host_key_invalid").action).not.toMatch(/host e porta/);
    expect(describeError("ssh_host_key_invalid", { locale: "en" }).action).not.toMatch(/host and port/);
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

describe("«Free up space» on a full disk (clean_images_*)", () => {
  const CODES = Object.keys(ERROR_CATALOG).filter((code) => code.startsWith("clean_images_"));
  const BYTES = 3_435_973_837; // 3.2 GB

  it("has the confirmation, every outcome and every failure", () => {
    expect(CODES.sort()).toEqual([
      "clean_images_confirm", "clean_images_confirm_vm", "clean_images_container_off",
      "clean_images_dates_unreadable", "clean_images_engine_off", "clean_images_engine_unreadable",
      "clean_images_failed", "clean_images_freed", "clean_images_freed_vm", "clean_images_in_use",
      "clean_images_kept", "clean_images_kept_by_choice", "clean_images_nothing", "clean_images_refused",
      "clean_images_unsupported", "clean_images_upgrade",
    ]);
  });

  const UP_TO: Record<string, RegExp> = {
    it: /fino a circa/, en: /up to about/, de: /bis zu etwa/, es: /hasta unos/,
    fr: /jusqu’à environ/, hu: /legfeljebb nagyjából/, pt: /até cerca de/,
  };
  const CONTAINER_ENGINE: Record<string, RegExp> = {
    it: /motore dei container/, en: /container engine/, de: /Container-Engine/, es: /motor de contenedores/,
    fr: /moteur de conteneurs/, hu: /konténermotor/, pt: /motor de contentores/,
  };

  it.each(ERROR_LOCALES)("%s: says each of them in that language, with the freed size", (locale) => {
    for (const code of CODES) {
      const described = describeError(code, { locale, bytes: BYTES });
      expect(described.known, `${code}/${locale}`).toBe(true);
      expect(`${described.text} ${described.action}`, `${code}/${locale}`).not.toMatch(/[{}]/);
      if (locale !== "en") expect(described.text, `${code}/${locale}`).not.toBe(ERROR_CATALOG[code].text.en);
    }
    for (const code of ["clean_images_freed", "clean_images_freed_vm"]) {
      const { text } = describeError(code, { locale, bytes: BYTES });
      expect(text, `${code}/${locale}`).toMatch(/3[.,]2 GB/);
      // The size is the images' NOMINAL size and layers shared between versions are freed only
      // in part: the sentence promises "up to", never "freed {size}".
      expect(text, `${code}/${locale}`).toMatch(UP_TO[locale]);
    }
    // On the Mac: the space is the virtual machine's, the Mac's disk is promised nothing, and
    // the engine is not named: Colima (the default), Podman and Docker Desktop all run in one.
    for (const code of ["clean_images_freed_vm", "clean_images_confirm_vm"]) {
      const { text, action } = describeError(code, { locale, bytes: BYTES });
      expect(text, `${code}/${locale}`).toMatch(CONTAINER_ENGINE[locale]);
      expect(text, `${code}/${locale}`).not.toMatch(/Podman|Colima|Docker Desktop/);
      expect(action, `${code}/${locale}`).toContain("Mac");
    }
    expect(describeError("clean_images_freed", { locale, bytes: BYTES }).text).not.toMatch(/Podman|Colima|Docker Desktop/);
  });

  it("writes small sizes in MB and never shows {size} without a size", () => {
    expect(describeError("clean_images_freed", { locale: "en", bytes: 524_288_000 }).text).toContain("about 500 MB.");
    for (const bytes of [undefined, null, -1, 1.5, Number.NaN]) {
      const described = describeError("clean_images_freed", { bytes });
      expect(described.known).toBe(false);
      expect(described.text).toBe(ERROR_CATALOG.unknown.text.it);
    }
  });
});

describe("podman_other_machine_running", () => {
  // The Retry button, as each language labels it.
  const RETRY = { it: "Riprova", en: "Try again", de: "Erneut versuchen", es: "Reintentar", fr: "Réessayer", hu: "Újra", pt: "Tentar novamente" };
  it.each(Object.entries(RETRY))("%s: says only one machine runs on a Mac, asks to stop the other one without a terminal, then Retry", (locale, retry) => {
    const described = describeError("podman_other_machine_running", { locale });
    expect(described.text).toContain("Podman");
    expect(described.action).toContain("Podman Desktop");
    expect(described.action).toContain(retry);
    expect(described.action).toContain("Job Hunter Team");
    expect(`${described.text} ${described.action}`).not.toMatch(/Terminal|podman machine (stop|list)|`/i);
  });
});

describe("podman_other_machine_running with the machine's name", () => {
  it.each(["it", "en", "de", "es", "fr", "hu", "pt"])("%s: names the machine in the sentence and in the action", (locale) => {
    const named = describeError("podman_other_machine_running", { locale, machine: "altra" });
    const plain = describeError("podman_other_machine_running", { locale });
    expect(named.code).toBe("podman_other_machine_running");
    expect(named.known).toBe(true);
    expect(named.text).toContain("altra");
    expect(named.action).toContain("altra");
    expect(`${named.text} ${named.action}`).not.toContain("{machine}");
    expect(plain.text).not.toContain("{machine}");
    expect(named.text).not.toBe(plain.text);
  });

  it("names only a machine name the wrapper could print, and only for this code", () => {
    const plain = describeError("podman_other_machine_running");
    for (const machine of ["bad name", "$(reboot)", "", "x".repeat(65), null]) {
      expect(describeError("podman_other_machine_running", { machine })).toEqual(plain);
    }
    expect(describeError("podman_start_failed", { machine: "altra" })).toEqual(describeError("podman_start_failed"));
    expect(errorMachineOf({ code: "podman_other_machine_running", machine: "podman-machine-default" })).toBe("podman-machine-default");
    expect(errorMachineOf({ machine: "a b" })).toBeNull();
    expect(errorMachineOf("podman_other_machine_running")).toBeNull();
  });
});

describe("a VPS whose team already runs on Docker", () => {
  it("says that a migration is needed, that the data stays and what to do, in every language", () => {
    const texts = new Set<string>();
    for (const locale of ERROR_LOCALES) {
      const { text, action } = describeError("vps_runtime_change_requires_migration", { locale });
      expect(text, locale).toMatch(/Docker/);
      expect(text, locale).toMatch(/Podman/);
      expect(action, locale).toMatch(/VPS/);
      expect(text).not.toEqual(describeError("runtime_change_requires_migration", { locale }).text);
      for (const value of [text, action]) {
        expect(value, locale).not.toMatch(/terminal|curl|install\.sh|--runtime|Colima|Mac\b|`/i);
      }
      texts.add(text);
    }
    expect(texts.size).toBe(ERROR_LOCALES.length);
  });
});

describe("this computer's team already running when the preparation needs to install", () => {
  it("says that nothing was changed and how to go on, in every language, and not that the preparation failed", () => {
    const texts = new Set<string>();
    for (const locale of ERROR_LOCALES) {
      const { text, action, known } = describeError("local_team_running", { locale });
      expect(known, locale).toBe(true);
      expect(text, locale).toMatch(/Job Hunter Team/);
      expect(action, locale).toMatch(/jht down/);
      expect(text, locale).not.toEqual(describeError("runtime_install_failed", { locale }).text);
      expect(text, locale).not.toEqual(describeError("vps_team_running", { locale }).text);
      // it is the person's own team, not a VPS
      expect(text, locale).not.toMatch(/VPS/);
      texts.add(text);
    }
    expect(texts.size).toBe(ERROR_LOCALES.length);
  });
});

describe("a Mac installed with another container engine", () => {
  it("says what would stay behind and what to do, in every language, without a terminal", () => {
    for (const locale of ERROR_LOCALES) {
      const { text, action } = describeError("runtime_change_requires_migration", { locale });
      expect(text, locale).toMatch(/Colima/);
      expect(text, locale).toMatch(/LinkedIn/);
      expect(text, locale).toMatch(/Telegram/);
      expect(action, locale).toMatch(/VPS/);
      expect(action, locale).toMatch(/~\/\.jht/);
      for (const value of [text, action]) {
        expect(value, locale).not.toMatch(/terminal|curl|install\.sh|--runtime|`/i);
      }
    }
  });
});

describe("homebrew_missing", () => {
  // The Retry button of the setup's error screen, as each language labels it.
  const RETRY = { it: "Riprova", en: "Try again", de: "Erneut versuchen", es: "Reintentar", fr: "Réessayer", hu: "Újra", pt: "Tentar novamente" };
  it.each(Object.entries(RETRY))("%s: points to Homebrew's .pkg on brew.sh and to Retry, never to a terminal", (locale, retry) => {
    const described = describeError("homebrew_missing", { locale });
    expect(described.text).toContain("Homebrew");
    expect(described.action).toContain("brew.sh");
    expect(described.action).toContain(".pkg");
    expect(described.action).toContain(retry);
    expect(`${described.text} ${described.action}`).not.toMatch(/Terminal|brew install|curl|sudo/i);
  });
});

// T10: a limit of the app, a wait the provider asked for, a spent plan, a program that never came up
// and a provider that did not answer are five different facts, and the person reads which one.
describe("the limits, said apart", () => {
  const LIMIT_CODES = ["throttled_local", "rate_limit_429", "quota", "runtime_not_started", "provider_failed"];
  const ALIASES = ["rate_limited", "rate_limited_burst", "rate_limited_daily"];
  const RESETS_AT = Math.floor(Date.UTC(2026, 9, 19, 13, 30) / 1000);
  const NOW = Date.UTC(2026, 9, 19, 10, 0);
  const say = (code: string, locale: string) => describeError(code, { locale, resetsAt: RESETS_AT, now: NOW });
  /** How each language says «of the app», which only the local limit may say. */
  const OF_THE_APP: Record<string, RegExp> = {
    it: /dell’app/, en: /of the app/, de: /der App/, es: /de la aplicación/, fr: /de l’application/,
    hu: /alkalmazás/, pt: /da aplicação/,
  };
  /** How each language says «your subscription is not used up» / «not a limit of your subscription». */
  const NOT_THE_PLAN: Record<string, RegExp> = {
    it: /non è esaurito|non è un limite del tuo abbonamento/, en: /is not used up|not a limit of your subscription/,
    de: /nicht aufgebraucht|kein Limit deines Abos/, es: /no está agotada|no es un límite de tu suscripción/,
    fr: /n’est pas épuisé|pas une limite de ton abonnement/, hu: /nem merült ki|nem az előfizetésed korlátja/,
    pt: /não está esgotada|não é um limite da tua subscrição/,
  };

  it.each(ERROR_LOCALES)("%s: has a sentence and an action for every code, never the code itself", (locale) => {
    for (const code of [...LIMIT_CODES, ...ALIASES]) {
      const described = say(code, locale);
      expect(described.known, `${code}/${locale}`).toBe(true);
      for (const text of [described.text, described.action]) {
        expect(text.trim().length, `${code}/${locale}`).toBeGreaterThan(8);
        expect(text, `${code}/${locale}`).not.toMatch(/\b[a-z]+_[a-z0-9_]+\b/);
        expect(text, `${code}/${locale}`).not.toContain("{time}");
      }
      if (locale !== "en") expect(described.text, `${code}/${locale}`).not.toBe(say(code, "en").text);
    }
  });

  it.each(ERROR_LOCALES)("%s: the three limits never share a sentence", (locale) => {
    const texts = ["throttled_local", "rate_limit_429", "quota"].map((code) => say(code, locale).text);
    expect(new Set(texts).size).toBe(3);
    const actions = ["throttled_local", "rate_limit_429", "quota"].map((code) => say(code, locale).action);
    expect(new Set(actions).size).toBe(3);
  });

  it.each(ERROR_LOCALES)("%s: a local limit is never shown as the provider limiting the person, and says so", (locale) => {
    const local = say("throttled_local", locale).text;
    expect(local, locale).toMatch(OF_THE_APP[locale]);
    for (const code of ["rate_limit_429", "quota", "provider_failed"]) {
      expect(say(code, locale).text, `${code}/${locale}`).not.toMatch(OF_THE_APP[locale]);
    }
    // A 429 and a failed call both say the subscription is fine; the local limit says whose limit it is instead.
    expect(say("rate_limit_429", locale).text, locale).toMatch(NOT_THE_PLAN[locale]);
    expect(say("provider_failed", locale).text, locale).toMatch(NOT_THE_PLAN[locale]);
    expect(say("quota", locale).text, locale).not.toMatch(NOT_THE_PLAN[locale]);
    expect(local, locale).not.toMatch(NOT_THE_PLAN[locale]);
  });

  it.each(ERROR_LOCALES)("%s: the web, hub and Telegram local limits read as the app's own", (locale) => {
    for (const code of ALIASES) expect(say(code, locale), `${code}/${locale}`).toEqual({ ...say("throttled_local", locale), code });
  });

  it("says when a quota frees again, and is not shown without the hour (it would be a placeholder)", () => {
    const time = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(RESETS_AT * 1000));
    const described = say("quota", "it");
    expect(described.text).toContain(time);
    expect(described.action).toContain(time);
    expect(describeError("quota", { locale: "it" })).toMatchObject({ known: false });
    expect(describeError("quota", { locale: "it" }).text).not.toContain("{time}");
  });

  // The runtime does not retry a wait longer than the 45 s a call may spend: it stops and says how long was
  // asked. So the sentence tells the person to wait, it does not promise a retry nobody makes (T10 review).
  it("rate_limit_429 asks the person to try again after the wait, in every language, and promises no retry", () => {
    const ASKS: Record<string, string> = {
      it: "Riprova dopo l’attesa indicata. Nessun dato è andato perso.",
      en: "Try again after the wait it asked for. No data was lost.",
      de: "Versuche es nach der genannten Wartezeit erneut. Es sind keine Daten verloren gegangen.",
      es: "Vuelve a intentarlo tras la espera indicada. No se ha perdido ningún dato.",
      fr: "Réessaie après l’attente indiquée. Aucune donnée n’a été perdue.",
      hu: "A jelzett várakozás után próbáld újra. Nem veszett el adat.",
      pt: "Tenta de novo depois da espera indicada. Não se perdeu nenhum dado.",
    };
    for (const locale of ERROR_LOCALES) expect(say("rate_limit_429", locale).action, locale).toBe(ASKS[locale]);
  });

  it("mentions 429 only where a provider asked to wait", () => {
    for (const locale of ERROR_LOCALES) {
      expect(say("rate_limit_429", locale).text, locale).toContain("429");
      for (const code of ["throttled_local", "quota", "runtime_not_started", "provider_failed"]) {
        expect(say(code, locale).text, `${code}/${locale}`).not.toContain("429");
      }
    }
  });
});

describe("the provider that is not set up", () => {
  it("tells the VPS and this computer apart in every language: the action never sends this computer's team to a VPS or a terminal", () => {
    // the name of the step in the app's own setup (onboarding.i18n.ts `steps`), per language
    const step: Record<string, string> = { it: "Provider", en: "Provider", de: "Anbieter", es: "Proveedor", fr: "Fournisseur", pt: "Fornecedor", hu: "Szolgáltató" };
    for (const locale of Object.keys(step)) {
      const remote = describeError("provider_not_configured", { locale });
      const local = describeError("provider_not_configured_local", { locale });
      expect(remote.known && local.known, locale).toBe(true);
      expect(remote.action, locale).toMatch(/VPS/);
      for (const part of [local.text, local.action]) expect(part, locale).not.toMatch(/VPS|jht setup|terminal|Terminal/);
      expect(local.action, locale).toContain(step[locale]);
      expect(local.text, locale).not.toBe(remote.text);
    }
  });
});
