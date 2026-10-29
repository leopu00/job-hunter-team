import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { localeLabels, locales, type Locale } from "@/i18n/config";
import { chooseAppLocale, systemLocale } from "../lib/app-locale";
import { fill } from "../lib/text-slots";
import { LANGUAGE_SCREEN_TEXT } from "./language-screen.i18n";
import "./language-screen.css";

/**
 * The first screen of the app, before any other text: the seven languages, the one of the system highlighted,
 * and every word on the screen in the language that is highlighted, so it answers the choice as it is made.
 * Arrows (or a click) choose, Enter (or the button) continues. The choice is kept as the app's language and
 * the team follows it (see TeamLanguagePrompt). If it cannot be kept the screen says so, and goes on at the
 * next press: the app works in that language for this start, and asks again at the next.
 */
export function LanguageScreen({ onChosen, initial }: { onChosen: (locale: Locale) => void; initial?: Locale }) {
  const [highlighted, setHighlighted] = useState<Locale>(() => initial ?? systemLocale());
  const [notKept, setNotKept] = useState(false);
  const refs = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});
  const t = LANGUAGE_SCREEN_TEXT[highlighted];

  useEffect(() => {
    refs.current[highlighted]?.focus();
    document.documentElement.lang = highlighted;
  }, [highlighted]);

  function move(step: number) {
    const at = locales.indexOf(highlighted);
    setHighlighted(locales[(at + step + locales.length) % locales.length]);
    setNotKept(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    else if (event.key === "Home") { event.preventDefault(); setHighlighted(locales[0]); }
    else if (event.key === "End") { event.preventDefault(); setHighlighted(locales[locales.length - 1]); }
    else if (event.key === "Enter") { event.preventDefault(); carryOn(); }
  }

  function carryOn() {
    if (!chooseAppLocale(highlighted) && !notKept) {
      setNotKept(true);
      return;
    }
    onChosen(highlighted);
  }

  return (
    <main className="language-screen" lang={highlighted} data-testid="language-screen">
      <section className="language-screen__card" aria-labelledby="language-title">
        <p className="language-screen__eyebrow">{t.eyebrow}</p>
        <h1 id="language-title">{t.title}</h1>
        <p className="language-screen__subtitle">{t.subtitle}</p>
        <div className="language-screen__list" role="radiogroup" aria-label={t.listAria} onKeyDown={onKeyDown}>
          {locales.map((locale) => {
            const on = locale === highlighted;
            return (
              <button
                key={locale}
                ref={(node) => { refs.current[locale] = node; }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={on ? `${localeLabels[locale].label}, ${t.selected}` : localeLabels[locale].label}
                tabIndex={on ? 0 : -1}
                lang={locale}
                data-locale={locale}
                className={`language-screen__option${on ? " is-selected" : ""}`}
                onClick={() => { setHighlighted(locale); setNotKept(false); }}
              >
                <span className="language-screen__flag" aria-hidden="true">{localeLabels[locale].flag}</span>
                <span>{localeLabels[locale].label}</span>
              </button>
            );
          })}
        </div>
        <p className="language-screen__hint">{t.keyboardHint}</p>
        {notKept && <p className="language-screen__warning" role="alert">{t.notKept}</p>}
        <button type="button" className="language-screen__continue" data-testid="language-continue" onClick={carryOn}>
          {fill(t.continueIn, { language: localeLabels[highlighted].label })}
        </button>
      </section>
    </main>
  );
}
