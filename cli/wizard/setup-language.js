/**
 * The language question of `jht setup`.
 *
 * The host setup (install) writes i18n-prefs.json even when nobody was asked (a server without a terminal gets the
 * default, English), so the file cannot tell a choice from a default: the setup asks, and the answer in force (the
 * saved language, else the system's) is the default one, so Enter keeps it. The answer is saved where every reader
 * looks first. A team set up from a script says it with `--language` instead (setup-noninteractive.js).
 */
import { LANGUAGES, hasLanguageChoice, saveLanguage, systemLanguage, currentLang } from './i18n.js';

// The question is asked in all the languages: before the answer there is no language to ask it in.
const QUESTION = 'Choose your language / Scegli la lingua / Válassz nyelvet / Elige tu idioma / Wähle deine Sprache / Choisis ta langue / Escolha seu idioma';

/** Asks and saves the language. Returns the language in force after the step. */
export async function askLanguage(prompter, { env = process.env, home } = {}) {
  const code = await prompter.select({
    message: QUESTION,
    options: LANGUAGES.map(({ value, label }) => ({ value, label })),
    initialValue: hasLanguageChoice(home) ? currentLang() : (systemLanguage(env) || currentLang()),
  });
  try {
    saveLanguage(code, home);
  } catch (err) {
    // Not being able to write the preference must not stop the setup: the team goes on in the default language.
    await prompter.note(`The language could not be saved (${err.message}). The team will write in English until it is.`, 'Language');
  }
  return code;
}
