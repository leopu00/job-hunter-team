// Riga «scadenza» di un token nella lista dei token cloud-sync. Un token
// scaduto scollega il box senza che nessuno se ne accorga: da
// TOKEN_EXPIRY_WARNING_DAYS giorni in giù, e dopo la scadenza, la riga
// diventa un avviso (role="alert") con cosa fare.

import type { Locale } from "@/i18n/config";
import {
  tokenExpiry,
  TOKEN_EXPIRY_WARNING_DAYS,
} from "@/lib/cloud-sync/token-expiry";

interface Copy {
  label: string;
  none: string;
  unknown: string;
  /** {date} {days} */
  active: string;
  /** {date} {days} */
  warning: string;
  /** {date} */
  expired: string;
}

const T: Record<Locale, Copy> = {
  it: {
    label: "Scadenza",
    none: "nessuna scadenza",
    unknown: "scadenza non leggibile",
    active: "{date} · giorni rimasti: {days}",
    warning:
      "Scade il {date} (giorni rimasti: {days}). Genera un token nuovo e lancia sul box `jht cloud enable --token …` prima di allora, altrimenti si scollega.",
    expired:
      "Scaduto il {date}: il box è scollegato. Genera un token nuovo e lancia sul box `jht cloud enable --token …`.",
  },
  en: {
    label: "Expires",
    none: "no expiry",
    unknown: "expiry unreadable",
    active: "{date} · days left: {days}",
    warning:
      "Expires on {date} (days left: {days}). Generate a new token and run `jht cloud enable --token …` on the box before then, or it will disconnect.",
    expired:
      "Expired on {date}: the box is disconnected. Generate a new token and run `jht cloud enable --token …` on the box.",
  },
  hu: {
    label: "Lejárat",
    none: "nincs lejárat",
    unknown: "a lejárat nem olvasható",
    active: "{date} · hátralévő napok: {days}",
    warning:
      "Lejár: {date} (hátralévő napok: {days}). Addig generálj új tokent, és futtasd a gépen: `jht cloud enable --token …`, különben a kapcsolat megszakad.",
    expired:
      "Lejárt: {date}, a gép nincs csatlakoztatva. Generálj új tokent, és futtasd a gépen: `jht cloud enable --token …`.",
  },
  es: {
    label: "Caducidad",
    none: "sin caducidad",
    unknown: "caducidad ilegible",
    active: "{date} · días restantes: {days}",
    warning:
      "Caduca el {date} (días restantes: {days}). Genera un token nuevo y ejecuta `jht cloud enable --token …` en el equipo antes de esa fecha, o se desconectará.",
    expired:
      "Caducó el {date}: el equipo está desconectado. Genera un token nuevo y ejecuta `jht cloud enable --token …` en el equipo.",
  },
  de: {
    label: "Ablauf",
    none: "kein Ablaufdatum",
    unknown: "Ablaufdatum nicht lesbar",
    active: "{date} · verbleibende Tage: {days}",
    warning:
      "Läuft am {date} ab (verbleibende Tage: {days}). Erzeuge vorher ein neues Token und führe auf dem Gerät `jht cloud enable --token …` aus, sonst wird die Verbindung getrennt.",
    expired:
      "Am {date} abgelaufen: das Gerät ist getrennt. Erzeuge ein neues Token und führe auf dem Gerät `jht cloud enable --token …` aus.",
  },
  fr: {
    label: "Expiration",
    none: "aucune expiration",
    unknown: "expiration illisible",
    active: "{date} · jours restants : {days}",
    warning:
      "Expire le {date} (jours restants : {days}). Générez un nouveau jeton et lancez `jht cloud enable --token …` sur la machine avant cette date, sinon elle sera déconnectée.",
    expired:
      "Expiré le {date} : la machine est déconnectée. Générez un nouveau jeton et lancez `jht cloud enable --token …` sur la machine.",
  },
  pt: {
    label: "Validade",
    none: "sem validade",
    unknown: "validade ilegível",
    active: "{date} · dias restantes: {days}",
    warning:
      "Expira a {date} (dias restantes: {days}). Gere um novo token e execute `jht cloud enable --token …` na máquina antes dessa data, ou ela será desligada.",
    expired:
      "Expirou a {date}: a máquina está desligada. Gere um novo token e execute `jht cloud enable --token …` na máquina.",
  },
};

function fill(template: string, date: string, days?: number): string {
  return template
    .replace("{date}", date)
    .replace("{days}", days === undefined ? "" : String(days));
}

export function TokenExpiryNotice({
  locale,
  expiresAt,
  now,
}: {
  locale: Locale;
  expiresAt: string | null | undefined;
  now?: number;
}) {
  const t = T[locale] ?? T.en;
  const expiry = tokenExpiry(expiresAt, now);

  if (
    expiry.kind === "expired" ||
    (expiry.kind === "active" && expiry.warning)
  ) {
    const expired = expiry.kind === "expired";
    const date = expiry.expiresAt.slice(0, 10);
    return (
      <div
        role="alert"
        data-token-expiry={expired ? "expired" : "warning"}
        data-token-expiry-warning-days={TOKEN_EXPIRY_WARNING_DAYS}
        className="text-[11px] mt-1.5 px-2 py-1 border"
        style={{
          color: expired ? "var(--color-red)" : "var(--color-yellow)",
          borderColor: expired ? "var(--color-red)" : "var(--color-yellow)",
        }}
      >
        {expired
          ? fill(t.expired, date)
          : fill(
              t.warning,
              date,
              expiry.kind === "active" ? expiry.daysLeft : undefined,
            )}
      </div>
    );
  }

  const text =
    expiry.kind === "none"
      ? t.none
      : expiry.kind === "unknown"
        ? t.unknown
        : fill(t.active, expiry.expiresAt.slice(0, 10), expiry.daysLeft);
  return (
    <div
      data-token-expiry={expiry.kind}
      className="text-[10px] text-[var(--color-dim)] mt-0.5"
    >
      {t.label}: {text}
    </div>
  );
}
