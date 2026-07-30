/**
 * JHT Setup Wizard — Prompt types and interfaces
 */

/**
 * @typedef {Object} WizardSelectOption
 * @property {*} value
 * @property {string} label
 * @property {string} [hint]
 */

/**
 * @typedef {Object} WizardSelectParams
 * @property {string} message
 * @property {WizardSelectOption[]} options
 * @property {*} [initialValue]
 */

/**
 * @typedef {Object} WizardMultiSelectParams
 * @property {string} message
 * @property {WizardSelectOption[]} options
 * @property {*[]} [initialValues]
 * @property {boolean} [searchable]
 */

/**
 * @typedef {Object} WizardTextParams
 * @property {string} message
 * @property {string} [initialValue]
 * @property {string} [placeholder]
 * @property {function(string): string|undefined} [validate]
 */

/**
 * @typedef {Object} WizardConfirmParams
 * @property {string} message
 * @property {boolean} [initialValue]
 */

/**
 * @typedef {Object} WizardProgress
 * @property {function(string): void} update
 * @property {function(string=): void} stop
 */

/**
 * @typedef {Object} WizardPrompter
 * @property {function(string): Promise<void>} intro
 * @property {function(string): Promise<void>} outro
 * @property {function(string, string=): Promise<void>} note
 * @property {function(WizardSelectParams): Promise<*>} select
 * @property {function(WizardMultiSelectParams): Promise<*[]>} multiselect
 * @property {function(WizardTextParams): Promise<string>} text
 * @property {function(WizardConfirmParams): Promise<boolean>} confirm
 * @property {function(string): WizardProgress} progress
 */

export class WizardCancelledError extends Error {
  constructor(message = 'wizard cancelled') {
    super(message);
    this.name = 'WizardCancelledError';
  }
}
