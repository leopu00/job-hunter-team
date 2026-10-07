// Avviso «inattivo da N giorni» su un token cloud-sync. Senza scadenza, la
// revoca a mano è l'unica difesa contro un token dimenticato: l'avviso dice
// quale revocare. Il pulsante di revoca è nella stessa riga.

import type { Locale } from "@/i18n/config";
import {
  tokenInactivity,
  TOKEN_INACTIVITY_WARNING_DAYS,
  type TokenActivityFields,
} from "@/lib/cloud-sync/token-inactivity";

interface Copy {
  /** {days} {date} */
  idle: string;
  /** {days} */
  neverUsed: string;
}

const T: Record<Locale, Copy> = {
  it: {
    idle: "Inattivo da {days} giorni (ultimo uso: {date}). Se il box non esiste più, revoca il token.",
    neverUsed:
      "Inattivo da {days} giorni: mai usato dalla creazione. Se il box non esiste più, revoca il token.",
  },
  en: {
    idle: "Inactive for {days} days (last used: {date}). If the box no longer exists, revoke the token.",
    neverUsed:
      "Inactive for {days} days: never used since it was created. If the box no longer exists, revoke the token.",
  },
  hu: {
    idle: "{days} napja inaktív (utolsó használat: {date}). Ha a gép már nem létezik, vond vissza a tokent.",
    neverUsed:
      "{days} napja inaktív: létrehozása óta soha nem használták. Ha a gép már nem létezik, vond vissza a tokent.",
  },
  es: {
    idle: "Inactivo desde hace {days} días (último uso: {date}). Si el equipo ya no existe, revoca el token.",
    neverUsed:
      "Inactivo desde hace {days} días: nunca usado desde su creación. Si el equipo ya no existe, revoca el token.",
  },
  de: {
    idle: "Seit {days} Tagen inaktiv (zuletzt verwendet: {date}). Wenn das Gerät nicht mehr existiert, widerrufe das Token.",
    neverUsed:
      "Seit {days} Tagen inaktiv: seit der Erstellung nie verwendet. Wenn das Gerät nicht mehr existiert, widerrufe das Token.",
  },
  fr: {
    idle: "Inactif depuis {days} jours (dernière utilisation : {date}). Si la machine n'existe plus, révoquez le jeton.",
    neverUsed:
      "Inactif depuis {days} jours : jamais utilisé depuis sa création. Si la machine n'existe plus, révoquez le jeton.",
  },
  pt: {
    idle: "Inativo há {days} dias (último uso: {date}). Se a máquina já não existir, revogue o token.",
    neverUsed:
      "Inativo há {days} dias: nunca usado desde a criação. Se a máquina já não existir, revogue o token.",
  },
};

export function TokenInactivityNotice({
  locale,
  token,
  now,
}: {
  locale: Locale;
  token: TokenActivityFields;
  now?: number;
}) {
  const inactivity = tokenInactivity(token, now);
  if (!inactivity.inactive) return null;
  const t = T[locale] ?? T.en;
  const text = (inactivity.neverUsed ? t.neverUsed : t.idle)
    .replace("{days}", String(inactivity.days))
    .replace("{date}", (token.last_used_at ?? "").slice(0, 10));
  return (
    <div
      role="alert"
      data-token-inactive={inactivity.neverUsed ? "never-used" : "idle"}
      data-token-inactivity-warning-days={TOKEN_INACTIVITY_WARNING_DAYS}
      className="text-[11px] mt-1.5 px-2 py-1 border"
      style={{
        color: "var(--color-yellow)",
        borderColor: "var(--color-yellow)",
      }}
    >
      {text}
    </div>
  );
}
