/**
 * Configuration, read from the environment.
 *
 * The provider is configuration and never a prompt, and missing or invalid
 * configuration stops the launch rather than falling back to something
 * plausible. Every refusal below is deliberate: the default is the mock, and
 * reaching a paid provider takes several explicit, separate steps — the live
 * gate, a model with a known price, an explicit budget, the key, and a ledger
 * to record the spend in. The API budget is shared by the whole team and is
 * small: a live run that could not be capped, or whose cost would go
 * unrecorded, never starts.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { HarnessError } from "./core/errors.ts";
import { PERMISSION_MODES, type PermissionMode } from "./core/permissions.ts";
import { DEFAULT_LIMITS, type Limits } from "./core/guardrails.ts";
import { modelProfile } from "./core/provider/catalog.ts";
import { MOCK_PROFILE } from "./core/provider/mock.ts";
import type {
  ModelProfile,
  OpenAICompatibleSettings,
  OpenAISettings,
  ProviderId,
} from "./core/provider/port.ts";
import type { Pricing } from "./core/usage.ts";
import type { HubSettings } from "./hub/client.ts";
import { TOKEN } from "./hub/protocol.ts";
import { resolveUserPath } from "./tools/paths.ts";

const PROVIDER_IDS: ProviderId[] = ["mock", "anthropic", "openai", "openai-compatible"];

/**
 * A role name becomes a folder under `agents/` and `logs/`: lowercase letters,
 * digits and dashes only, so no role can climb out of either.
 */
const ROLE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

export interface Config {
  live: boolean;
  profile: ModelProfile;
  limits: Limits;
  auditDir: string;
  /** The role this run plays: `scout`, `analyst`… Names its home and its logs. */
  role: string;
  /**
   * The candidate's profile folder. The agent reads inside it without asking.
   * Absolute.
   */
  profileDir?: string;
  /**
   * Root of the runtime's persistent state: `~/.jht-api` on the host. Each
   * agent's home is `agents/<role>/` below it, each trace `logs/<role>/`.
   * Absolute.
   */
  apiHome: string;
  /** The role's home: the folder a real spawn starts it in. Absolute. */
  agentHome: string;
  /**
   * What the team makes for the person — CVs, cover letters, reviews — which
   * the TUI calls `$JHT_USER_DIR` and puts in their Documents folder (T11).
   * Here it is the runtime's own (`JHT_API_USER_DIR`, default
   * `<apiHome>/user`): every role may write there, none may write the
   * profile. Absolute.
   */
  userDir: string;
  /**
   * The person's own documents (`JHT_API_USER_HISTORY_DIR`): the CVs and
   * letters they wrote or collected, which the team reads and never changes.
   * Absent where a box has none. Absolute.
   */
  userHistoryDir?: string;
  /** Where commands start and relative paths resolve. Absolute. */
  workdir: string;
  permissionMode: PermissionMode;
  /** JSON file listing MCP servers to connect. Absolute. Absent means none. */
  mcpConfig?: string;
  /**
   * The spend ledger every live run appends a line to (`JHT_API_LEDGER`).
   * Absolute. Always set on a live run; absent on the mock, which spends nothing.
   */
  ledger?: string;
  openAICompatible?: OpenAICompatibleSettings;
  /** Set when OpenAI requests go through a proxy instead of api.openai.com. */
  openAI?: OpenAISettings;
  /**
   * `jht-hub` (T18): with it, the team's database and channels are the hub's,
   * and this runtime opens neither. `JHT_HUB_URL` + `JHT_HUB_TOKEN`.
   */
  hub?: HubSettings;
}

export type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env, role = "agent"): Config {
  if (!ROLE_NAME.test(role)) {
    throw new HarnessError(
      "config_invalid",
      `Role '${role}' is not a valid role name: lowercase letters, digits and dashes, starting with a letter.`,
    );
  }
  const providerId = readProviderId(env);
  const budgetUsd = readBudget(env);
  const limits: Limits = {
    ...DEFAULT_LIMITS,
    budgetUsd: budgetUsd ?? DEFAULT_LIMITS.budgetUsd,
    maxWebSearches: readMaxWebSearches(env) ?? DEFAULT_LIMITS.maxWebSearches,
  };

  const local = { ...readLocal(env, role), ...readHub(env) };
  const rawAudit = env["JHT_API_AUDIT_DIR"]?.trim();
  const auditDir = rawAudit ? resolveUserPath(rawAudit, process.cwd(), homedir()) : join(local.apiHome, "audit");

  if (providerId === "mock") {
    return { live: false, profile: MOCK_PROFILE, limits, auditDir, ...local };
  }

  // Everything past this point can spend money.
  if (env["JHT_API_LIVE"]?.trim() !== "1") {
    throw new HarnessError(
      "live_gate_closed",
      `Provider '${providerId}' reaches a paid endpoint. Set JHT_API_LIVE=1 to allow it, or use JHT_API_PROVIDER=mock.`,
    );
  }

  const modelId = env["JHT_API_MODEL"]?.trim();
  if (!modelId) {
    throw new HarnessError("config_invalid", `JHT_API_MODEL is required for provider '${providerId}'.`);
  }

  const profile = modelProfile({
    providerId,
    modelId,
    pricingOverride: readPricingOverride(env),
  });

  if (profile.pricing === null) {
    throw new HarnessError(
      "pricing_unknown",
      `No price is known for '${modelId}'. A run that cannot be costed cannot be capped: ` +
        "add it to the catalog, or set JHT_API_PRICE_INPUT_PER_MTOK and JHT_API_PRICE_OUTPUT_PER_MTOK.",
    );
  }
  // A live run states its own cap. The default cap exists for the mock; a paid
  // run that inherits it silently is a run nobody decided to pay for.
  if (budgetUsd === undefined || budgetUsd <= 0) {
    throw new HarnessError(
      "config_invalid",
      "JHT_API_BUDGET_USD must be set, and greater than zero, for a live run.",
    );
  }

  const rawLedger = env["JHT_API_LEDGER"]?.trim();
  if (!rawLedger) {
    throw new HarnessError(
      "config_invalid",
      "JHT_API_LEDGER is not set. Every live run appends its spend to the ledger; a run that could not be recorded does not start.",
    );
  }
  const ledger = resolveUserPath(rawLedger, process.cwd(), homedir());

  requireCredentials(providerId, env);

  const config: Config = { live: true, profile, limits, auditDir, ledger, ...local };
  if (providerId === "openai-compatible") {
    config.openAICompatible = readOpenAICompatible(env);
  }
  if (providerId === "openai") {
    // On a VPS the key stays with a proxy on the host (`http://127.0.0.1:8787/v1`)
    // and the agent holds a placeholder: the key is never checked for shape.
    const baseURL = env["JHT_API_OPENAI_BASE_URL"]?.trim() || env["OPENAI_BASE_URL"]?.trim();
    if (baseURL) {
      if (!URL.canParse(baseURL)) {
        throw new HarnessError("config_invalid", `The OpenAI base URL '${baseURL}' is not a URL.`);
      }
      config.openAI = { baseURL };
    }
  }
  return config;
}

/** Where the agent stands on this machine and what it may do there without asking. */
function readLocal(
  env: Env,
  role: string,
): Pick<Config, "role" | "profileDir" | "apiHome" | "agentHome" | "userDir" | "userHistoryDir" | "workdir" | "permissionMode" | "mcpConfig"> {
  const cwd = process.cwd();
  const rawProfile = env["JHT_API_PROFILE_DIR"]?.trim();
  const profileDir = rawProfile ? resolveUserPath(rawProfile, cwd, homedir()) : undefined;
  const apiHome = resolveUserPath(env["JHT_API_HOME"]?.trim() || "~/.jht-api", cwd, homedir());
  const agentHome = join(apiHome, "agents", role);
  const rawUserDir = env["JHT_API_USER_DIR"]?.trim();
  const userDir = rawUserDir ? resolveUserPath(rawUserDir, cwd, homedir()) : join(apiHome, "user");
  const rawHistory = env["JHT_API_USER_HISTORY_DIR"]?.trim();
  const userHistoryDir = rawHistory ? resolveUserPath(rawHistory, cwd, homedir()) : undefined;
  // The two folders are siblings, never nested (SICUREZZA, 21/09). The person's documents
  // are a read-only root, and that rule wins over every own root whatever the mode: with the
  // deliverables inside them, every CV the SCRITTORE writes would be refused — safely, but
  // with "this is the person's profile" as the reason and a whole live turn spent for
  // nothing. A configuration that contradicts itself says so here, before the first write.
  if (userHistoryDir && (userDir === userHistoryDir || userDir.startsWith(`${userHistoryDir}/`))) {
    throw new HarnessError(
      "config_invalid",
      `JHT_API_USER_DIR (${userDir}) is inside JHT_API_USER_HISTORY_DIR (${userHistoryDir}). ` +
        "The person's documents are read-only for every role, so nothing could be written there: " +
        "mount the two as siblings — the deliverables in a folder of their own, the history beside it.",
    );
  }
  // The agent starts in its own home, as a spawn would. JHT_API_WORKDIR is for
  // pointing it somewhere else on purpose, not the default.
  const rawWorkdir = env["JHT_API_WORKDIR"]?.trim();
  const workdir = rawWorkdir ? resolveUserPath(rawWorkdir, cwd, homedir()) : agentHome;

  const rawMode = env["JHT_API_PERMISSION_MODE"]?.trim() || "auto";
  const permissionMode = PERMISSION_MODES.find((m) => m === rawMode);
  if (!permissionMode) {
    throw new HarnessError(
      "config_invalid",
      `JHT_API_PERMISSION_MODE is '${rawMode}'; expected one of ${PERMISSION_MODES.join(", ")}.`,
    );
  }
  const rawMcp = env["JHT_API_MCP_CONFIG"]?.trim();
  const mcpConfig = rawMcp ? resolveUserPath(rawMcp, cwd, homedir()) : undefined;
  return { role, apiHome, agentHome, userDir, ...(userHistoryDir ? { userHistoryDir } : {}), workdir, permissionMode, ...(profileDir ? { profileDir } : {}), ...(mcpConfig ? { mcpConfig } : {}) };
}

/**
 * The hub is on the pod's loopback: the token travels in clear, so any other
 * address is refused rather than trusted.
 */
function readHub(env: Env): Pick<Config, "hub"> {
  const url = env["JHT_HUB_URL"]?.trim();
  const token = env["JHT_HUB_TOKEN"]?.trim();
  if (!url && !token) return {};
  if (!url || !token) throw new HarnessError("config_invalid", "JHT_HUB_URL and JHT_HUB_TOKEN go together.");
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/?$/.test(url)) {
    throw new HarnessError("config_invalid", `JHT_HUB_URL is '${url}'; the hub is reached on the loopback only (http://127.0.0.1:<port>).`);
  }
  if (!TOKEN.test(token)) throw new HarnessError("config_invalid", "JHT_HUB_TOKEN must be 32 to 256 characters of [A-Za-z0-9_-].");
  return { hub: { url, token } };
}

function readProviderId(env: Env): ProviderId {
  const raw = env["JHT_API_PROVIDER"]?.trim() || "mock";
  const found = PROVIDER_IDS.find((id) => id === raw);
  if (!found) {
    throw new HarnessError(
      "config_invalid",
      `JHT_API_PROVIDER is '${raw}'; expected one of ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  return found;
}

/** The configured budget, or undefined when none is set. */
function readBudget(env: Env): number | undefined {
  const raw = env["JHT_API_BUDGET_USD"]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new HarnessError("config_invalid", `JHT_API_BUDGET_USD is '${raw}'; expected a positive number.`);
  }
  return value;
}

/** `JHT_API_MAX_WEB_SEARCHES`: a whole number, zero included (a run that may not search). */
function readMaxWebSearches(env: Env): number | undefined {
  const raw = env["JHT_API_MAX_WEB_SEARCHES"]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new HarnessError("config_invalid", `JHT_API_MAX_WEB_SEARCHES is '${raw}'; expected a whole number, 0 or more.`);
  }
  return value;
}

function readPricingOverride(env: Env): Pricing | undefined {
  const input = env["JHT_API_PRICE_INPUT_PER_MTOK"]?.trim();
  const output = env["JHT_API_PRICE_OUTPUT_PER_MTOK"]?.trim();
  if (!input && !output) return undefined;

  const inputPerMTokUsd = Number(input);
  const outputPerMTokUsd = Number(output);
  if (!Number.isFinite(inputPerMTokUsd) || !Number.isFinite(outputPerMTokUsd)) {
    throw new HarnessError(
      "config_invalid",
      "JHT_API_PRICE_INPUT_PER_MTOK and JHT_API_PRICE_OUTPUT_PER_MTOK must both be numbers.",
    );
  }
  return { inputPerMTokUsd, outputPerMTokUsd };
}

function requireCredentials(providerId: ProviderId, env: Env): void {
  const required: Partial<Record<ProviderId, string>> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    "openai-compatible": "JHT_API_OPENAI_COMPATIBLE_API_KEY",
  };
  const name = required[providerId];
  if (name && !env[name]?.trim()) {
    throw new HarnessError("config_invalid", `${name} is not set, and provider '${providerId}' needs it.`);
  }
}

function readOpenAICompatible(env: Env): OpenAICompatibleSettings {
  const baseURL = env["JHT_API_OPENAI_COMPATIBLE_BASE_URL"]?.trim();
  const apiKey = env["JHT_API_OPENAI_COMPATIBLE_API_KEY"]?.trim();
  if (!baseURL || !apiKey) {
    throw new HarnessError(
      "config_invalid",
      "JHT_API_OPENAI_COMPATIBLE_BASE_URL and JHT_API_OPENAI_COMPATIBLE_API_KEY are both required.",
    );
  }
  return { name: "openai-compatible", baseURL, apiKey };
}
