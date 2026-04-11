/**
 * Plugin loader JHT — discovery, caricamento e attivazione plugin.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { JHT_HOME } from "../paths.js";
import type { PluginManifest, PluginModule, PluginContext, PluginLogger, PluginsConfig } from "./types.js";
import { DEFAULT_PLUGINS_CONFIG } from "./types.js";
import { RegistryBuilder, setActiveRegistry, type PluginRegistry } from "./registry.js";

const MANIFEST_FILENAME = "jht.plugin.json";
const STATE_DIR = JHT_HOME;
const DEFAULT_PLUGIN_DIRS = [join(STATE_DIR, "plugins")];

export interface PluginCandidate {
  manifest: PluginManifest;
  rootDir: string;
  entryFile?: string;
}

export function discoverPlugins(
  config: PluginsConfig = DEFAULT_PLUGINS_CONFIG,
  logger?: PluginLogger,
): PluginCandidate[] {
  const searchPaths = [
    ...DEFAULT_PLUGIN_DIRS,
    ...(config.searchPaths ?? []),
  ];

  const candidates: PluginCandidate[] = [];

  for (const dir of searchPaths) {
    const resolved = resolve(dir);
    if (!existsSync(resolved)) continue;

    try {
      const entries = readdirSync(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = join(resolved, entry.name);
        const candidate = loadPluginCandidate(pluginDir, logger);
        if (candidate) candidates.push(candidate);
      }
    } catch (err) {
      logger?.warn(`Errore scansione directory plugin ${resolved}: ${String(err)}`);
    }
  }

  return candidates;
}

function loadPluginCandidate(dir: string, logger?: PluginLogger): PluginCandidate | null {
  const manifestPath = join(dir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = validateManifest(JSON.parse(raw));
    if (!manifest) {
      logger?.warn(`Manifest non valido in ${dir}`);
      return null;
    }

    const entryFile = resolveEntryFile(dir);
    return { manifest, rootDir: dir, entryFile };
  } catch (err) {
    logger?.error(`Errore lettura manifest ${manifestPath}: ${String(err)}`);
    return null;
  }
}

function resolveEntryFile(dir: string): string | undefined {
  const candidates = ["index.ts", "index.js", "plugin.ts", "plugin.js"];
  for (const name of candidates) {
    const filePath = join(dir, name);
    if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  }
  return undefined;
}

function validateManifest(raw: unknown): PluginManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const version = typeof obj.version === "string" ? obj.version.trim() : "0.0.0";

  if (!id || !name) return null;

  return {
    id,
    name,
    version,
    description: typeof obj.description === "string" ? obj.description : undefined,
    kind: normalizeKind(obj.kind),
    enabledByDefault: typeof obj.enabledByDefault === "boolean" ? obj.enabledByDefault : true,
    envVars: Array.isArray(obj.envVars) ? obj.envVars.filter((v): v is string => typeof v === "string") : undefined,
    dependencies: Array.isArray(obj.dependencies) ? obj.dependencies.filter((v): v is string => typeof v === "string") : undefined,
    configSchema: typeof obj.configSchema === "object" && obj.configSchema ? obj.configSchema as Record<string, unknown> : undefined,
  };
}

function normalizeKind(raw: unknown): PluginManifest["kind"] {
  if (typeof raw === "string") return raw as never;
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string") as never;
  return undefined;
}

export interface PluginLoadOptions {
  config?: PluginsConfig;
  logger?: PluginLogger;
  activate?: boolean;
}

export async function loadPlugins(options: PluginLoadOptions = {}): Promise<PluginRegistry> {
  const config = options.config ?? DEFAULT_PLUGINS_CONFIG;
  const logger = options.logger;
  const builder = new RegistryBuilder();

  const candidates = discoverPlugins(config, logger);
  logger?.info(`Trovati ${candidates.length} plugin candidati`);

  for (const candidate of candidates) {
    builder.addDiscovered(candidate.manifest, candidate.rootDir);

    if (!builder.isPluginEnabled(candidate.manifest.id, config)) {
      builder.setDisabled(candidate.manifest.id);
      continue;
    }

    if (candidate.entryFile) {
      try {
        const mod = await import(candidate.entryFile) as PluginModule;
        const definition = mod.default ?? mod.plugin;
        if (definition) builder.setLoaded(candidate.manifest.id, definition);
      } catch (err) {
        builder.setError(candidate.manifest.id, String(err));
        logger?.error(`Errore caricamento plugin ${candidate.manifest.id}: ${String(err)}`);
      }
    }
  }

  if (options.activate) {
    for (const record of builder.build().getByStatus("loaded")) {
      const definition = record.definition;
      if (!definition?.setup) { builder.setActive(record.id); continue; }

      const ctx: PluginContext = {
        pluginId: record.id,
        config: config.pluginConfig?.[record.id] ?? {},
        logger: logger ?? createSilentLogger(),
        rootDir: record.rootDir,
        stateDir: STATE_DIR,
      };

      try {
        await definition.setup(ctx);
        builder.setActive(record.id);
      } catch (err) {
        builder.setError(record.id, String(err));
        logger?.error(`Errore attivazione plugin ${record.id}: ${String(err)}`);
      }
    }
  }

  const registry = builder.build();
  setActiveRegistry(registry);
  logger?.info(`Registry: ${registry.size} totali, ${registry.getActive().length} attivi`);
  return registry;
}

function createSilentLogger(): PluginLogger {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}
