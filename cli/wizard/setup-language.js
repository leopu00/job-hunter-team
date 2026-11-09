/**
 * The language question of `jht setup`: asked once, when nobody has chosen a language yet.
 *
 * The host setup (install) already asks it on a terminal and writes i18n-prefs.json; a team set up from a script, a
 * VPS without a terminal or the app has no such file, and every agent then writes in English whatever the person
 * speaks. Here the person is asked (the system's language, if it is one of the seven, is the default answer) and the
 * answer is saved where every reader looks first. A person who has already chosen is not asked again.
 */
import { LANGUAGES, hasLanguageChoice, saveLanguage, systemLanguage, currentLang } from './i18n.js';

// The question is asked in all the languages: before the answer there is no language to ask it in.
const QUESTION = 'Choose your language / Scegli la lingua / Válassz nyelvet / Elige tu idioma / Wähle deine Sprache / Choisis ta langue / Escolha seu idioma';

/** Asks (when needed) and saves the language. Returns the language in force after the step. */
export async function askLanguage(prompter, { env = process.env, home } = {}) {
  if (hasLanguageChoice(home)) return currentLang();
  const code = await prompter.select({
    message: QUESTION,
    options: LANGUAGES.map(({ value, label }) => ({ value, label })),
    initialValue: systemLanguage(env) || 'en',
  });
  try {
    saveLanguage(code, home);
  } catch (err) {
    // Not being able to write the preference must not stop the setup: the team goes on in the default language.
    await prompter.note(`The language could not be saved (${err.message}). The team will write in English until it is.`, 'Language');
  }
  return code;
}
