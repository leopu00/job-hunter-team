/**
 * Modulo templates — sistema template per prompt AI
 *
 * Caricamento .md, variabili {var}, composizione sezioni, budget.
 */

// Tipi
export type {
  TemplateFrontmatter,
  PromptTemplate,
  ContextFile,
  TemplateVariables,
  PromptSection,
  PromptMode,
  ComposeOptions,
  ComposedPrompt,
  BootstrapFileName,
} from "./types.js";

export {
  BOOTSTRAP_FILENAMES,
  MAX_CONTEXT_FILE_CHARS,
  MAX_TOTAL_CONTEXT_CHARS,
  MIN_FILE_BUDGET_CHARS,
} from "./types.js";

// Loader
export {
  parseFrontmatter,
  loadTemplate,
  loadTemplateCached,
  loadTemplatesFromDir,
  loadBootstrapTemplates,
  isBootstrapFile,
  templateToContextFile,
  templatesToContextFiles,
  truncateContent,
  clearTemplateCache,
} from "./template-loader.js";

// Engine
export {
  hasVariables,
  substituteVariables,
  extractVariableNames,
  createSection,
  formatContextFile,
  formatContextFiles,
  composePrompt,
  renderTemplate,
} from "./template-engine.js";
