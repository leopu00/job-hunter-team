/**
 * JHT Setup Wizard — Clack prompter
 *
 * Wrapper su @clack/prompts + picocolors per UI terminale.
 */

import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  spinner,
  text,
  note,
} from '@clack/prompts';
import pc from 'picocolors';
import { WizardCancelledError } from './prompts.js';

function guardCancel(value) {
  if (isCancel(value)) {
    cancel(pc.red('Setup annullato.'));
    throw new WizardCancelledError();
  }
  return value;
}

/**
 * Crea un WizardPrompter basato su @clack/prompts.
 *
 * @returns {import('./prompts.js').WizardPrompter}
 */
export function createClackPrompter() {
  return {
    intro: async (title) => {
      intro(pc.bgCyan(pc.black(` ${title} `)));
    },

    outro: async (message) => {
      outro(pc.green(message));
    },

    note: async (message, title) => {
      note(message, title);
    },

    select: async (params) =>
      guardCancel(
        await select({
          message: pc.bold(params.message),
          options: params.options.map((opt) => {
            const base = { value: opt.value, label: opt.label };
            return opt.hint === undefined ? base : { ...base, hint: pc.dim(opt.hint) };
          }),
          initialValue: params.initialValue,
        }),
      ),

    multiselect: async (params) => {
      const options = params.options.map((opt) => {
        const base = { value: opt.value, label: opt.label };
        return opt.hint === undefined ? base : { ...base, hint: pc.dim(opt.hint) };
      });

      return guardCancel(
        await multiselect({
          message: pc.bold(params.message),
          options,
          initialValues: params.initialValues,
          required: false,
        }),
      );
    },

    text: async (params) => {
      const validate = params.validate;
      return guardCancel(
        await text({
          message: pc.bold(params.message),
          initialValue: params.initialValue,
          placeholder: params.placeholder,
          validate: validate ? (value) => validate(value ?? '') : undefined,
        }),
      );
    },

    confirm: async (params) =>
      guardCancel(
        await confirm({
          message: pc.bold(params.message),
          initialValue: params.initialValue,
        }),
      ),

    progress: (label) => {
      const spin = spinner();
      spin.start(pc.cyan(label));
      return {
        update: (message) => {
          spin.message(pc.cyan(message));
        },
        stop: (message) => {
          spin.stop(message ? pc.green(message) : undefined);
        },
      };
    },
  };
}
