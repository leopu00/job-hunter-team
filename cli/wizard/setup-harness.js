/**
 * The harness question of `jht setup`: which program runs the agents, Codex or Pi.
 *
 * The answer is `harness` in jht.config.json (shared/runtime/agent-harness.js, read by the launcher at
 * every agent start). It is asked right after the provider because it decides the program to install and
 * the login to wait for: Codex is installed by `providers update codex` and signs in with its device flow;
 * Pi by `providers update pi` and signs in with its own /login.
 */
import { AGENT_HARNESSES, DEFAULT_HARNESS, harnessProblem } from '../../shared/runtime/agent-harness.js';

export const HARNESS_LABEL_KEY = {
  codex: 'wizard.provider.harness_codex',
  pi: 'wizard.provider.harness_pi',
};

/**
 * OPEN PRODUCT DECISIONS, not taken here. Both end at this one function, so the
 * answer is a change of this function and its texts, and nowhere else:
 *   1. A person on ChatGPT Go or Free: Pi accepts only Plus and Pro. Today the note below says so and the
 *      person decides; whether the setup must offer a key, Copilot or Grok instead, or send them back to
 *      Codex, is open.
 *   2. Claude with Pi: the Claude subscription used from Pi is billed apart, as extra usage. The launcher
 *      refuses it (spawn-lib.sh: jht_pi_provider_check) and the wizard offers only OpenAI, so for now there
 *      is nothing to say; whether it is offered, and how it is said, is open.
 */
export function harnessNote(harness, t) {
  return harness === 'pi' ? t('wizard.provider.harness_pi_note') : null;
}

/** The provider the person chose cannot run this harness: the reason, or null. */
export function harnessRefusal(harness, provider, authMethod) {
  return harnessProblem(harness, provider, authMethod);
}

/** The id `jht providers update` takes for the program of this choice. */
export function updateIdFor(harness, provider, updateIds) {
  return harness === 'pi' ? 'pi' : updateIds[provider];
}

/** The program whose login the wizard waits for. */
export function loginCmdFor(harness, provider, loginCmds) {
  return harness === 'pi' ? 'pi' : loginCmds[provider];
}

/**
 * Asks the harness. `current` is the one the config already has (the question starts there). Returns the
 * harness chosen; a provider that cannot run the one chosen is told and Codex is kept.
 */
export async function promptHarness(prompter, { t, provider, authMethod, current }) {
  const initial = AGENT_HARNESSES.includes(current) ? current : DEFAULT_HARNESS;
  const choice = await prompter.select({
    message: t('wizard.provider.harness_prompt'),
    options: AGENT_HARNESSES.map((value) => ({ value, label: t(HARNESS_LABEL_KEY[value]) })),
    initialValue: initial,
  });
  const refusal = harnessRefusal(choice, provider, authMethod);
  if (refusal) {
    await prompter.note(`${refusal}.`, t('wizard.provider.harness_prompt'));
    return DEFAULT_HARNESS;
  }
  const note = harnessNote(choice, t);
  if (note) await prompter.note(note, t('wizard.provider.harness_prompt'));
  return choice;
}
