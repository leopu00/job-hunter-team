import type { Locale } from "@/i18n/config";
import { appLocale } from "../../lib/app-locale";
import { navigate } from "../../shell/router";

/**
 * In the Team page's status card, where the web has its emergency stop: the
 * desktop's team commands (pause and stop) live in one place, the agents'
 * panel, and the card links there (operator's decision, 21/10).
 */
const TEXT: Record<Locale, { link: string; note: string }> = {
  it: { link: "Pausa e stop della squadra →", note: "Si comandano dal Pannello Agenti." },
  en: { link: "Pause and stop the team →", note: "They are in the Agents panel." },
  de: { link: "Team pausieren und stoppen →", note: "Das geht im Agenten-Bereich." },
  es: { link: "Pausa y parada del equipo →", note: "Se gestionan desde el panel de Agentes." },
  fr: { link: "Pause et arrêt de l’équipe →", note: "Ils se trouvent dans le panneau Agents." },
  hu: { link: "A csapat szüneteltetése és leállítása →", note: "Az Ügynökök panelen érhető el." },
  pt: { link: "Pausa e paragem da equipa →", note: "Estão no painel de Agentes." },
};

export function teamControlsText(locale: Locale = appLocale()) {
  return TEXT[locale] ?? TEXT.en;
}

export default function TeamControlsLink() {
  const t = teamControlsText();
  return (
    <div data-testid="team-controls-link" className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => navigate("/agents")}
        className="min-h-11 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 text-[13px] font-bold text-[var(--color-bright)] hover:border-[var(--color-border-glow)]"
      >
        {t.link}
      </button>
      <p className="m-0 text-center text-[11px] text-[var(--color-muted)]">{t.note}</p>
    </div>
  );
}
