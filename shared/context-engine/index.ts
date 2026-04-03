/**
 * JHT Context Engine — Modulo assemblaggio contesto AI
 */

// Tipi
export type {
  MessageRole,
  ContextMessage,
  SectionPriority,
  ContextSection,
  AssembleResult,
  CompactResult,
  ContextEngineInfo,
  ContextEngine,
  TokenEstimator,
} from './types.js';
export { estimateTokens, estimateMessageTokens, estimateSectionTokens } from './types.js';

// Assembler
export {
  assembleContext,
  systemSection,
  memorySection,
  toolsSection,
  historySection,
} from './assembler.js';

// Compactor
export { compactContext } from './compactor.js';
export type { SummarizeFn } from './compactor.js';

// Registry
export {
  DefaultContextEngine,
  registerContextEngine,
  getContextEngineFactory,
  listContextEngineIds,
  unregisterContextEngine,
  resolveContextEngine,
} from './registry.js';
export type { ContextEngineFactory } from './registry.js';
