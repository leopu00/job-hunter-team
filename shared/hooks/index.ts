/**
 * Hook System — Barrel exports
 */

export type {
  HookEventType,
  HookEvent,
  HookHandler,
  HookSource,
  Hook,
  HookMetadata,
  HookRequirements,
  HookEntry,
  HookConfig,
  HooksConfig,
  MessageReceivedContext,
  MessageSentContext,
} from "./types.js";

export { HOOK_SOURCE_PRECEDENCE } from "./types.js";

export {
  registerHook,
  unregisterHook,
  clearAllHooks,
  hasListeners,
  getRegisteredEvents,
  getHandlerCount,
  triggerHook,
  createHookEvent,
  resolveHookEntries,
  filterEligibleHooks,
} from "./registry.js";

export {
  discoverHooksInDir,
  loadHooks,
  loadHooksFromWorkspace,
} from "./loader.js";
