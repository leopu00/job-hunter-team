import { useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { setUpdateCheckEnabled, updateCheckEnabled, UPDATE_CHECK_TEXT } from "../../lib/app-update";

/** The switch of the «new version» check (lib/app-update), kept on this computer: on by default. */
export default function UpdateCheckCard() {
  const t = UPDATE_CHECK_TEXT[appLocale()];
  const [enabled, setEnabled] = useState(updateCheckEnabled);
  const choose = (value: boolean) => {
    setUpdateCheckEnabled(value);
    setEnabled(value);
  };
  return (
    <section
      data-testid="settings-update-check"
      aria-labelledby="settings-update-check-title"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2"
    >
      <h2 id="settings-update-check-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.title}</h2>
      <p className="text-[12px] text-[var(--color-muted)]">{t.text}</p>
      <div className="flex gap-2" role="group" aria-labelledby="settings-update-check-title">
        {[true, false].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={enabled === value}
            onClick={() => choose(value)}
            className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] aria-pressed:text-[var(--color-bright)] aria-pressed:border-[var(--color-border-glow)]"
          >
            {value ? t.on : t.off}
          </button>
        ))}
      </div>
    </section>
  );
}
