/**
 * Tipi per il sistema plugin JHT.
 *
 * Definisce manifest, definizioni plugin, hook lifecycle,
 * servizi background e configurazione registry.
 */

// ── MANIFEST ───────────────────────────────────────────────

/** Metadati statici di un plugin letti dal manifest */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Tipo di plugin: skill agente, canale comunicazione, storage, ecc. */
  kind?: PluginKind | PluginKind[];
  /** Plugin abilitato di default */
  enabledByDefault?: boolean;
  /** Variabili d'ambiente richieste */
  envVars?: string[];
  /** Dipendenze da altri plugin (per ID) */
  dependencies?: string[];
  /** Schema configurazione JSON opzionale */
  configSchema?: Record<string, unknown>;
}

export type PluginKind =
  | "skill"
  | "channel"
  | "storage"
  | "provider"
  | "tool"
  | "integration";

// ── PLUGIN DEFINITION ──────────────────────────────────────

/** Definizione completa di un plugin: manifest + implementazione */
export interface PluginDefinition {
  manifest: PluginManifest;
  /** Factory di setup: riceve context, ritorna cleanup opzionale */
  setup?: (ctx: PluginContext) => Promise<PluginCleanup | void>;
  /** Hook registrati dal plugin */
  hooks?: Partial<PluginHookHandlerMap>;
  /** Servizio background opzionale */
  service?: PluginService;
  /** Tool agente registrati dal plugin */
  tools?: PluginToolFactory[];
}

/** Modulo plugin esportato da un file .ts/.js */
export interface PluginModule {
  default?: PluginDefinition;
  plugin?: PluginDefinition;
}

// ── CONTEXT & LIFECYCLE ────────────────────────────────────

export interface PluginContext {
  pluginId: string;
  config: Record<string, unknown>;
  logger: PluginLogger;
  /** Directory radice del plugin */
  rootDir: string;
  /** Directory stato JHT (~/.jht) */
  stateDir: string;
}

export type PluginCleanup = () => void | Promise<void>;

export interface PluginLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

// ── HOOKS ──────────────────────────────────────────────────

/** Nomi degli hook lifecycle disponibili */
export type PluginHookName =
  | "beforeAgentStart"
  | "afterAgentEnd"
  | "beforeToolCall"
  | "afterToolCall"
  | "beforeMessageSend"
  | "afterMessageReceived"
  | "onError";

/** Evento base passato a tutti gli hook */
export interface PluginHookEvent {
  pluginId: string;
  timestamp: number;
}

/** Evento pre-esecuzione agente */
export interface BeforeAgentStartEvent extends PluginHookEvent {
  agentId: string;
  task: string;
}

/** Evento post-esecuzione agente */
export interface AfterAgentEndEvent extends PluginHookEvent {
  agentId: string;
  result?: unknown;
  error?: string;
}

/** Evento pre-chiamata tool */
export interface BeforeToolCallEvent extends PluginHookEvent {
  toolName: string;
  args: Record<string, unknown>;
}

/** Evento post-chiamata tool */
export interface AfterToolCallEvent extends PluginHookEvent {
  toolName: string;
  result?: unknown;
  error?: string;
}

/** Mappa completa hook → handler */
export type PluginHookHandlerMap = {
  beforeAgentStart: (event: BeforeAgentStartEvent) => void | Promise<void>;
  afterAgentEnd: (event: AfterAgentEndEvent) => void | Promise<void>;
  beforeToolCall: (event: BeforeToolCallEvent) => void | Promise<void>;
  afterToolCall: (event: AfterToolCallEvent) => void | Promise<void>;
  beforeMessageSend: (event: PluginHookEvent & { message: string }) => void | Promise<void>;
  afterMessageReceived: (event: PluginHookEvent & { message: string }) => void | Promise<void>;
  onError: (event: PluginHookEvent & { error: string }) => void | Promise<void>;
};

/** Registrazione hook con priorità e plugin di provenienza */
export interface PluginHookRegistration<K extends PluginHookName = PluginHookName> {
  pluginId: string;
  hook: K;
  handler: PluginHookHandlerMap[K];
  priority?: number;
}

// ── SERVICES ───────────────────────────────────────────────

export interface PluginService {
  id: string;
  start: (ctx: PluginContext) => Promise<void>;
  stop?: (ctx: PluginContext) => Promise<void>;
}

export type PluginToolFactory = (ctx: PluginContext) => PluginToolDefinition;

export interface PluginToolDefinition {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

// ── REGISTRY STATE ─────────────────────────────────────────

export type PluginStatus = "discovered" | "loaded" | "active" | "error" | "disabled";

export interface PluginRecord {
  id: string;
  manifest: PluginManifest;
  definition?: PluginDefinition;
  status: PluginStatus;
  error?: string;
  rootDir: string;
  loadedAt?: number;
}

// ── CONFIG ─────────────────────────────────────────────────

export interface PluginsConfig {
  /** Abilita/disabilita il sistema plugin globalmente */
  enabled: boolean;
  /** Directory aggiuntive dove cercare plugin */
  searchPaths?: string[];
  /** Lista plugin esplicitamente abilitati (per ID) */
  allow?: string[];
  /** Lista plugin esplicitamente bloccati (per ID) */
  deny?: string[];
  /** Configurazione per-plugin */
  pluginConfig?: Record<string, Record<string, unknown>>;
}

export const DEFAULT_PLUGINS_CONFIG: PluginsConfig = {
  enabled: true,
  searchPaths: [],
  allow: [],
  deny: [],
  pluginConfig: {},
};
