import { appLocale } from "./app-locale";
import { describeError } from "./error-catalog";
import type { PageDataFailure } from "./page-data-store";

const TEXT = {
  en: "Updated at", it: "Aggiornato alle", es: "Actualizado a las", fr: "Mis à jour à",
  de: "Aktualisiert um", pt: "Atualizado às", hu: "Frissítve",
};

export function PageDataNotice({ at, error }: { at: number | null; error: PageDataFailure | null }) {
  const locale = appLocale();
  const failure = error ? describeError(error.code, { locale, fallback: "existing_team_unavailable" }) : null;
  return <div className="text-[11px] text-[var(--color-muted)]" data-testid="page-data-notice">
    {at !== null && <p>{TEXT[locale]} {new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</p>}
    {failure && <p role="alert" style={{ color: "var(--color-red)" }}>{failure.text} {failure.action} <code>{error!.code}</code></p>}
  </div>;
}
