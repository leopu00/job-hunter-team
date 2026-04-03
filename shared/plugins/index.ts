/**
 * Sistema plugin extensibile per JHT.
 *
 * Uso:
 *   import { loadPlugins, getActiveRegistry, emitHook } from "./shared/plugins/index.js";
 *
 *   const registry = await loadPlugins({ activate: true });
 *   console.log(`${registry.size} plugin caricati`);
 *
 *   await emitHook("beforeAgentStart", { pluginId: "core", timestamp: Date.now(), agentId: "scout", task: "cerca lavoro" });
 */

export {
  loadPlugins,
  discoverPlugins,
  type PluginCandidate,
  type PluginLoadOptions,
} from "./loader.js";

export {
  createRegistry,
  createEmptyRegistry,
  RegistryBuilder,
  setActiveRegistry,
  getActiveRegistry,
  requireActiveRegistry,
  resetActiveRegistry,
  type PluginRegistry,
} from "./registry.js";

export {
  HookRunner,
  createHookRunner,
  setActiveHookRunner,
  getActiveHookRunner,
  emitHook,
  createHookEvent,
  resetActiveHookRunner,
} from "./hooks.js";

export type {
  PluginManifest,
  PluginKind,
  PluginDefinition,
  PluginModule,
  PluginContext,
  PluginCleanup,
  PluginLogger,
  PluginHookName,
  PluginHookEvent,
  PluginHookHandlerMap,
  PluginHookRegistration,
  BeforeAgentStartEvent,
  AfterAgentEndEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  PluginService,
  PluginToolFactory,
  PluginToolDefinition,
  PluginStatus,
  PluginRecord,
  PluginsConfig,
} from "./types.js";

export { DEFAULT_PLUGINS_CONFIG } from "./types.js";
