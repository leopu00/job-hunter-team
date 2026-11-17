/**
 * The language question of `jht setup`.
 *
 * The host setup (install) writes i18n-prefs.json even when nobody was asked (a server without a terminal gets the
 * default, English); then it leaves `.host-setup-unconfirmed` beside it, until a host setup with a person at the terminal
 * asks. With that mark, or with no language saved, the setup asks, and the answer in force (the saved language, else the
 * system's) is the default one, so Enter keeps it. A language saved with no such mark is the person's (an update): kept. The answer is saved where every reader
 * looks first. A team set up from a script says it with `--language` instead (setup-noninteractive.js).
 * When the host setup has just ASKED (it writes `asked_at`, seconds since the epoch, only when a person answered its
 * picker), the question is not asked a second time: the language in force is kept.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, hasLanguageChoice, saveLanguage, systemLanguage, currentLang, tfIn } from './i18n.js';

/** A language saved that no run without a person left unconfirmed: the person's, from an earlier setup. */
export function languageAlreadyChosen(home) {
  const dir = home || process.env.JHT_HOME || '/jht_home';
  if (!hasLanguageChoice(home)) return false;
  try { fs.lstatSync(path.join(dir, '.host-setup-unconfirmed')); return false; } catch { return true; }
}

/** The host setup asked the language less than an hour ago (the same `jht setup`, or one stopped and started again). */
export function askedByHostSetup(home, now = Date.now()) {
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(home || process.env.JHT_HOME || '/jht_home', 'i18n-prefs.json'), 'utf8'));
    const at = Number(prefs?.asked_at);
    return hasLanguageChoice(home) && Number.isFinite(at) && now / 1000 - at >= 0 && now / 1000 - at < 3600;
  } catch { return false; }
}

// The question is asked in all the languages: before the answer there is no language to ask it in.
const QUESTION = 'Choose your language / Scegli la lingua / Válassz nyelvet / Elige tu idioma / Wähle deine Sprache / Choisis ta langue / Escolha seu idioma';

/** Asks and saves the language. Returns the language in force after the step. */
export async function askLanguage(prompter, { env = process.env, home, now } = {}) {
  if (askedByHostSetup(home, now) || languageAlreadyChosen(home)) return currentLang();
  const code = await prompter.select({
    message: QUESTION,
    options: LANGUAGES.map(({ value, label }) => ({ value, label })),
    initialValue: hasLanguageChoice(home) ? currentLang() : (systemLanguage(env) || currentLang()),
  });
  try {
    saveLanguage(code, home);
  } catch (err) {
    // Not being able to write the preference must not stop the setup: the team goes on in the default language.
    // Said in the language just chosen: the person reads it now.
    await prompter.note(tfIn(code, 'wizard.language.save_failed', err.message), tfIn(code, 'wizard.language.title'));
  }
  return code;
}
