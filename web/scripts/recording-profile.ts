#!/usr/bin/env tsx
/**
 * Crea/resetta profili sintetici per riprese web e gioco.
 *
 * Nessun account, token o storage state vive nel repository. Le credenziali
 * sono file 0600 sotto la config utente; database, YAML e auth-state stanno
 * nella data directory utente. L'output nomina solo gli alias pubblici.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Session } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import yaml from "js-yaml";
import {
  RECORDING_PROFILE_ALIASES,
  buildRecordingProfileDataset,
  type RecordingProfileAlias,
  type RecordingProfileDataset,
} from "../lib/recording-profile";
import { getSupabaseConfig } from "../lib/supabase/config";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const XDG_CONFIG =
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const XDG_DATA =
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
const CONFIG_ROOT = path.join(XDG_CONFIG, "jht", "recording-profiles");
const DATA_ROOT = path.join(XDG_DATA, "jht", "recording-profiles");

type Credentials = { email: string; password: string };
type Command = "reset" | "verify";

function usage(message?: string): never {
  if (message) console.error(`Errore: ${message}\n`);
  console.error(
    "Uso: npm run recording-profile -- <reset|verify> <software|marketing|finance|design|--all> [--local-only]",
  );
  process.exit(64);
}

function isAlias(value: string): value is RecordingProfileAlias {
  return (RECORDING_PROFILE_ALIASES as readonly string[]).includes(value);
}

function parseArgs(): {
  command: Command;
  aliases: RecordingProfileAlias[];
  localOnly: boolean;
} {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (command !== "reset" && command !== "verify") usage();
  const localOnly = args.includes("--local-only");
  const targets = args.filter((a) => a !== "--local-only");
  if (targets.length !== 1) usage("indica un alias oppure --all");
  if (targets[0] === "--all") {
    return { command, aliases: [...RECORDING_PROFILE_ALIASES], localOnly };
  }
  if (!isAlias(targets[0])) usage(`alias sconosciuto: ${targets[0]}`);
  return { command, aliases: [targets[0]], localOnly };
}

function credentialPath(alias: RecordingProfileAlias): string {
  return path.join(CONFIG_ROOT, `${alias}.env`);
}

function profileRoot(alias: RecordingProfileAlias): string {
  return path.join(DATA_ROOT, alias);
}

function parseEnvFile(file: string): Credentials | null {
  if (!fs.existsSync(file)) return null;
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values.RECORDING_EMAIL && values.RECORDING_PASSWORD
    ? { email: values.RECORDING_EMAIL, password: values.RECORDING_PASSWORD }
    : null;
}

function atomicPrivateWrite(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

async function createPrivateAccount(
  alias: RecordingProfileAlias,
): Promise<Credentials> {
  const config = getSupabaseConfig();
  if (!config.configured) throw new Error("configurazione Supabase assente");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      `credenziali locali assenti per ${alias}; il primo reset richiede SUPABASE_SERVICE_ROLE_KEY`,
    );
  }
  const suffix = crypto.randomBytes(8).toString("hex");
  const credentials = {
    // Valore sintetico e mai stampato. L'account e' creato via admin con
    // conferma esplicita, quindi non viene inviata alcuna email.
    email: `recording-${alias}-${suffix}@jobhunterteam.ai`,
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const admin = createClient(config.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
    user_metadata: { purpose: "recording-profile", alias },
  });
  if (error) throw new Error(`creazione account ${alias} fallita: ${error.message}`);
  atomicPrivateWrite(
    credentialPath(alias),
    `RECORDING_EMAIL=${credentials.email}\nRECORDING_PASSWORD=${credentials.password}\n`,
  );
  return credentials;
}

async function credentialsFor(alias: RecordingProfileAlias) {
  return parseEnvFile(credentialPath(alias)) ?? createPrivateAccount(alias);
}

function localCandidateYaml(dataset: RecordingProfileDataset): string {
  const p = dataset.candidateProfile;
  const positioning = (p.positioning ?? {}) as Record<string, unknown>;
  const doc = {
    name: p.name,
    target_role: p.target_role,
    location: p.location,
    experience_years: p.experience_years,
    experience_months: p.experience_months,
    has_degree: p.has_degree,
    skills: p.skills,
    languages: p.languages,
    location_preferences: p.location_preferences,
    job_titles: p.job_titles,
    salary_target: p.salary_target,
    positioning,
    candidate: {
      name: p.name,
      target_role: p.target_role,
      contacts: {},
      experience: positioning.experience ?? [],
      education: positioning.education ?? [],
      certifications: positioning.certifications ?? [],
      strengths: positioning.strengths ?? [],
      career_goals: positioning.career_goals ?? {},
      aspirations: positioning.aspirations ?? {},
    },
  };
  return yaml.dump(doc, { noRefs: true, lineWidth: 100, sortKeys: false });
}

function insertRows(
  db: Database.Database,
  table: string,
  rows: Array<Record<string, unknown>>,
): void {
  if (rows.length === 0) return;
  const allowed = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  for (const row of rows) {
    const entries = Object.entries(row).filter(
      ([key, value]) => allowed.has(key) && value !== undefined,
    );
    const columns = entries.map(([key]) => `"${key}"`).join(", ");
    const params = entries.map(() => "?").join(", ");
    db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${params})`).run(
      ...entries.map(([, value]) =>
        typeof value === "boolean" ? (value ? 1 : 0) : value,
      ),
    );
  }
}

function materializeLocal(dataset: RecordingProfileDataset): void {
  const finalRoot = profileRoot(dataset.alias);
  const stage = `${finalRoot}.stage-${process.pid}`;
  const previous = `${finalRoot}.previous`;
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, "profile"), { recursive: true, mode: 0o700 });

  execFileSync("python3", [path.join(REPO, "shared/skills/db_init.py")], {
    env: { ...process.env, JHT_HOME: stage },
    stdio: "pipe",
  });

  const db = new Database(path.join(stage, "jobs.db"));
  db.pragma("foreign_keys = ON");
  const companyId = new Map<string, number>();
  const positionId = new Map<string, number>();
  const tx = db.transaction(() => {
    dataset.companies.forEach((company, index) => {
      const id = index + 1;
      companyId.set(String(company.name), id);
      insertRows(db, "companies", [
        {
          id,
          name: company.name,
          website: null,
          hq_country: company.hq,
          sector: company.sector,
          size: company.size,
          glassdoor_rating: company.glassdoor_rating,
          analyzed_by: company.analyzed_by,
          analyzed_at: company.analyzed_at,
          verdict: company.verdict,
        },
      ]);
    });
    dataset.positions.forEach((position) => {
      const localId = Number(position.legacy_id);
      positionId.set(String(position.id), localId);
      insertRows(db, "positions", [
        {
          ...position,
          id: localId,
          company_id: companyId.get(String(position.company)),
          deleted_at: undefined,
        },
      ]);
    });
    insertRows(
      db,
      "scores",
      dataset.scores.map((row, index) => ({
        ...row,
        id: index + 1,
        position_id: positionId.get(String(row.position_id)),
        deleted_at: undefined,
      })),
    );
    insertRows(
      db,
      "applications",
      dataset.applications.map((row, index) => ({
        ...row,
        id: index + 1,
        position_id: positionId.get(String(row.position_id)),
        deleted_at: undefined,
      })),
    );
    insertRows(
      db,
      "position_highlights",
      dataset.highlights.map((row, index) => ({
        ...row,
        id: index + 1,
        position_id: positionId.get(String(row.position_id)),
        deleted_at: undefined,
      })),
    );
    insertRows(
      db,
      "pending_user_messages",
      dataset.chatTurns.map((row) => ({
        ...row,
        id: row.legacy_id,
        related_position_id: row.related_position_id
          ? positionId.get(String(row.related_position_id))
          : null,
        cloud_synced_at: dataset.anchor,
      })),
    );
  });
  tx();
  const integrity = db.pragma("integrity_check", { simple: true });
  db.close();
  if (integrity !== "ok") throw new Error(`SQLite non integro per ${dataset.alias}`);

  fs.writeFileSync(
    path.join(stage, "profile", "candidate_profile.yml"),
    localCandidateYaml(dataset),
    { mode: 0o600 },
  );
  fs.writeFileSync(path.join(stage, "profile", "ready.flag"), "ready\n", {
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(stage, "preferences.json"),
    JSON.stringify(
      { theme: "dark", language: "en", ui_state: { tour_done: true } },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  fs.writeFileSync(path.join(stage, "host.env"), "JHT_HOST_TYPE=local\n", {
    mode: 0o600,
  });
  for (const agent of ["assistente", "mentor", "capitano"]) {
    const agentRoot = path.join(stage, "agents", agent);
    fs.mkdirSync(agentRoot, { recursive: true, mode: 0o700 });
    const lines = dataset.chatTurns
      .filter((turn) => turn.agent === agent)
      .map((turn) =>
        JSON.stringify({
          role: turn.author === "user" ? "user" : "assistant",
          text: turn.body,
          ts: turn.chat_ts,
          done: true,
        }),
      )
      .join("\n");
    fs.writeFileSync(path.join(agentRoot, "chat.jsonl"), `${lines}\n`, {
      mode: 0o600,
    });
  }

  fs.rmSync(previous, { recursive: true, force: true });
  if (fs.existsSync(finalRoot)) fs.renameSync(finalRoot, previous);
  fs.mkdirSync(path.dirname(finalRoot), { recursive: true, mode: 0o700 });
  fs.renameSync(stage, finalRoot);
}

function chunk<T>(rows: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function assertOk(
  operation: string,
  result: PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(`${operation}: ${error.message}`);
}

async function signIn(credentials: Credentials) {
  const config = getSupabaseConfig();
  if (!config.configured) throw new Error("configurazione Supabase assente");
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error || !data.session) throw new Error(`login account riprese fallito: ${error?.message}`);
  return { client, session: data.session, config };
}

async function materializeCloud(
  dataset: RecordingProfileDataset,
  credentials: Credentials,
): Promise<Session> {
  const { client, session, config } = await signIn(credentials);
  const userId = session.user.id;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "il reset completo e deterministico richiede SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  const admin = createClient(config.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Scope stretto: il client usa la sessione dell'account e RLS; nessuna
  // service-role partecipa al reset dei dati professionali. La chiave admin
  // serve solo per i thread agente→utente (RLS vieta correttamente di
  // impersonare un agente) e per lo stato onboarding.
  await assertOk(
    `${dataset.alias}: elimina thread`,
    admin.from("pending_user_messages").delete().eq("user_id", userId),
  );
  await assertOk(
    `${dataset.alias}: elimina transizioni`,
    client.from("position_transitions").delete().eq("user_id", userId),
  );
  for (const table of ["position_highlights", "applications", "scores"] as const) {
    await assertOk(
      `${dataset.alias}: elimina ${table}`,
      client.from(table).delete().eq("user_id", userId),
    );
  }
  await assertOk(
    `${dataset.alias}: elimina posizioni`,
    client.from("positions").delete().eq("user_id", userId),
  );
  await assertOk(
    `${dataset.alias}: elimina aziende`,
    client.from("companies").delete().eq("user_id", userId),
  );

  const companies = dataset.companies.map((row) => ({
    id: row.id,
    user_id: userId,
    name: row.name,
    website: null,
    hq: row.hq,
    sector: row.sector,
    size: row.size,
    glassdoor_rating: row.glassdoor_rating,
    red_flags: row.red_flags,
    culture_notes: row.culture_notes,
    analyzed_by: row.analyzed_by,
    analyzed_at: row.analyzed_at,
    verdict: row.verdict,
    logo: null,
    deleted_at: null,
  }));
  for (const rows of chunk(companies)) {
    await assertOk(`${dataset.alias}: inserisce aziende`, client.from("companies").insert(rows));
  }
  for (const rows of chunk(dataset.positions)) {
    await assertOk(
      `${dataset.alias}: inserisce posizioni`,
      client.from("positions").insert(rows.map((row) => ({ ...row, user_id: userId }))),
    );
  }
  for (const [table, rows] of [
    ["scores", dataset.scores],
    ["applications", dataset.applications],
    ["position_highlights", dataset.highlights],
  ] as const) {
    for (const part of chunk(rows)) {
      await assertOk(
        `${dataset.alias}: inserisce ${table}`,
        client.from(table).insert(part.map((row) => ({ ...row, user_id: userId }))),
      );
    }
  }

  const profile = { ...dataset.candidateProfile, user_id: userId };
  await assertOk(
    `${dataset.alias}: salva profilo`,
    client.from("candidate_profiles").upsert(profile, { onConflict: "user_id" }),
  );

  await assertOk(
    `${dataset.alias}: inserisce thread`,
    admin.from("pending_user_messages").insert(
      dataset.chatTurns.map((row) => ({ ...row, user_id: userId })),
    ),
  );
  await assertOk(
    `${dataset.alias}: chiude onboarding`,
    admin.from("user_onboarding_state").upsert(
      {
        user_id: userId,
        vps_setup_completed_at: dataset.anchor,
        profile_configured_at: dataset.anchor,
        first_team_run_at: dataset.anchor,
        tour_done_at: dataset.anchor,
        updated_at: dataset.anchor,
      },
      { onConflict: "user_id" },
    ),
  );
  return session;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function writeStorageState(alias: RecordingProfileAlias, session: Session): void {
  const config = getSupabaseConfig();
  if (!config.configured) throw new Error("configurazione Supabase assente");
  const ref = new URL(config.url).hostname.split(".")[0];
  const payload = JSON.stringify({
    access_token: session.access_token,
    token_type: session.token_type ?? "bearer",
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  });
  const encoded = `base64-${base64Url(payload)}`;
  const parts = encoded.match(/.{1,3180}/g) ?? [encoded];
  const base = `sb-${ref}-auth-token`;
  const cookies: Array<Record<string, unknown>> = [];
  for (const host of ["jobhunterteam.ai", "localhost", "127.0.0.1"]) {
    parts.forEach((value, index) => {
      cookies.push({
        name: parts.length === 1 ? base : `${base}.${index}`,
        value,
        domain: host,
        path: "/",
        expires: session.expires_at,
        httpOnly: false,
        secure: host === "jobhunterteam.ai",
        sameSite: "Lax",
      });
    });
    cookies.push({
      name: "jht_welcome_seen",
      value: "1",
      domain: host,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 86400 * 30,
      httpOnly: false,
      secure: host === "jobhunterteam.ai",
      sameSite: "Lax",
    });
    cookies.push({
      name: "NEXT_LOCALE",
      value: "en",
      domain: host,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 86400 * 30,
      httpOnly: false,
      secure: host === "jobhunterteam.ai",
      sameSite: "Lax",
    });
  }
  const origins = ["https://jobhunterteam.ai", "http://localhost:3008"].map(
    (origin) => ({
      origin,
      localStorage: [{ name: "jht-tour-done", value: "1" }],
    }),
  );
  atomicPrivateWrite(
    path.join(profileRoot(alias), "auth-state.json"),
    JSON.stringify({ cookies, origins }, null, 2) + "\n",
  );
}

function verifyLocal(dataset: RecordingProfileDataset): void {
  const root = profileRoot(dataset.alias);
  const dbPath = path.join(root, "jobs.db");
  const profilePath = path.join(root, "profile", "candidate_profile.yml");
  if (!fs.existsSync(dbPath) || !fs.existsSync(profilePath)) {
    throw new Error(`${dataset.alias}: profilo locale assente; esegui reset`);
  }
  const db = new Database(dbPath, { readonly: true });
  const count = (table: string) =>
    Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  if (db.pragma("integrity_check", { simple: true }) !== "ok") {
    throw new Error(`${dataset.alias}: integrity_check fallito`);
  }
  if (count("positions") !== dataset.positions.length) {
    throw new Error(`${dataset.alias}: conteggio posizioni locale inatteso`);
  }
  if (count("scores") !== dataset.scores.length) {
    throw new Error(`${dataset.alias}: conteggio score locale inatteso`);
  }
  if (count("pending_user_messages") !== dataset.chatTurns.length) {
    throw new Error(`${dataset.alias}: conteggio thread locale inatteso`);
  }
  db.close();
  for (const agent of ["assistente", "mentor", "capitano"]) {
    const chatPath = path.join(root, "agents", agent, "chat.jsonl");
    const expected = dataset.chatTurns.filter((turn) => turn.agent === agent).length;
    if (!fs.existsSync(chatPath)) {
      throw new Error(`${dataset.alias}: thread locale ${agent} assente`);
    }
    const actual = fs
      .readFileSync(chatPath, "utf8")
      .split("\n")
      .filter(Boolean).length;
    if (actual !== expected) {
      throw new Error(`${dataset.alias}: thread locale ${agent} incompleto`);
    }
  }
}

async function verifyCloud(
  dataset: RecordingProfileDataset,
  credentials: Credentials,
): Promise<void> {
  const { client } = await signIn(credentials);
  for (const [table, expected] of [
    ["positions", dataset.positions.length],
    ["scores", dataset.scores.length],
    ["applications", dataset.applications.length],
    ["position_highlights", dataset.highlights.length],
    ["pending_user_messages", dataset.chatTurns.length],
  ] as const) {
    const { count, error } = await client
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error || count !== expected) {
      throw new Error(`${dataset.alias}: verifica cloud ${table} fallita`);
    }
  }
  const state = JSON.parse(
    fs.readFileSync(path.join(profileRoot(dataset.alias), "auth-state.json"), "utf8"),
  ) as { cookies?: Array<{ name: string }> };
  if (state.cookies?.some((cookie) => cookie.name === "jht_demo_persona")) {
    throw new Error(`${dataset.alias}: auth-state contiene il cookie demo`);
  }
}

async function main() {
  const { command, aliases, localOnly } = parseArgs();
  for (const alias of aliases) {
    const dataset = buildRecordingProfileDataset(alias);
    if (command === "reset") {
      materializeLocal(dataset);
      if (!localOnly) {
        const credentials = await credentialsFor(alias);
        const session = await materializeCloud(dataset, credentials);
        writeStorageState(alias, session);
      }
    }
    verifyLocal(dataset);
    if (!localOnly) {
      const credentials = await credentialsFor(alias);
      await verifyCloud(dataset, credentials);
    }
    console.log(
      `OK ${alias}: ${dataset.positions.length} posizioni, ` +
        `${dataset.scores.length} score, ${dataset.applications.length} candidature`,
    );
  }
  console.log(localOnly ? "Profili locali pronti." : "Profili web + gioco pronti; auth-state locale, cookie demo assente.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // Gli errori delle API non devono riversare payload o identificativi.
  console.error(`ERRORE profili riprese: ${message.replace(/[\w.+-]+@[\w.-]+/g, "<redacted>")}`);
  process.exit(1);
});
