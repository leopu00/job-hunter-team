"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import {
  requestFailureMessage,
  requestFailureReason,
  sendPositionRequest,
} from "@/lib/position-request";
import { ActionRow, IconOpenCheck } from "./ActionRow";

// Recheck/liveness ON-DEMAND. Il recheck NON è più autonomo: l'utente clicca
// qui per chiedere all'Analista di ri-verificare se l'offerta è ancora attiva
// (flag recheck_requested). Toggle come Geocodifica / Scrivi CV.
interface Props {
  legacyId: number;
  initialRequested: boolean;
  lastOpenCheck?: string | null;
}

const T: Record<
  Locale,
  {
    title: string;
    desc: string;
    lastCheck: (age: string) => string;
    requestedDesc: string;
    sending: string;
    today: string;
    daysAgo: (n: number) => string;
  }
> = {
  it: {
    title: "Verifica che sia ancora aperta",
    desc: "Il team ricontrolla che l'annuncio sia ancora online",
    lastCheck: (age) => ` · ultima verifica: ${age}`,
    requestedDesc: "Richiesta inviata al team — tocca per annullare",
    sending: "Un momento…",
    today: "oggi",
    daysAgo: (n) => (n === 1 ? "1 giorno fa" : `${n} giorni fa`),
  },
  en: {
    title: "Check it's still open",
    desc: "The team re-checks that the listing is still online",
    lastCheck: (age) => ` · last check: ${age}`,
    requestedDesc: "Request sent to the team — tap to cancel",
    sending: "One moment…",
    today: "today",
    daysAgo: (n) => (n === 1 ? "1 day ago" : `${n} days ago`),
  },
  es: {
    title: "Comprueba que siga abierta",
    desc: "El equipo vuelve a comprobar que el anuncio siga en línea",
    lastCheck: (age) => ` · última comprobación: ${age}`,
    requestedDesc: "Solicitud enviada al equipo — toca para cancelar",
    sending: "Un momento…",
    today: "hoy",
    daysAgo: (n) => (n === 1 ? "hace 1 día" : `hace ${n} días`),
  },
  fr: {
    title: "Vérifier qu'elle est toujours ouverte",
    desc: "L'équipe revérifie que l'annonce est toujours en ligne",
    lastCheck: (age) => ` · dernière vérification : ${age}`,
    requestedDesc: "Demande envoyée à l'équipe — touchez pour annuler",
    sending: "Un instant…",
    today: "aujourd'hui",
    daysAgo: (n) => (n === 1 ? "il y a 1 jour" : `il y a ${n} jours`),
  },
  de: {
    title: "Prüfen, ob sie noch offen ist",
    desc: "Das Team prüft erneut, ob die Anzeige noch online ist",
    lastCheck: (age) => ` · letzte Prüfung: ${age}`,
    requestedDesc: "Anfrage ans Team gesendet — zum Abbrechen tippen",
    sending: "Einen Moment…",
    today: "heute",
    daysAgo: (n) => (n === 1 ? "vor 1 Tag" : `vor ${n} Tagen`),
  },
  hu: {
    title: "Ellenőrzés: még nyitott?",
    desc: "A csapat újra ellenőrzi, hogy a hirdetés még elérhető-e",
    lastCheck: (age) => ` · utolsó ellenőrzés: ${age}`,
    requestedDesc: "Kérés elküldve a csapatnak — koppints a visszavonáshoz",
    sending: "Egy pillanat…",
    today: "ma",
    daysAgo: (n) => `${n} napja`,
  },
  pt: {
    title: "Verifica se ainda está aberta",
    desc: "A equipa verifica novamente se o anúncio ainda está online",
    lastCheck: (age) => ` · última verificação: ${age}`,
    requestedDesc: "Pedido enviado à equipa — toca para cancelar",
    sending: "Um momento…",
    today: "hoje",
    daysAgo: (n) => (n === 1 ? "há 1 dia" : `há ${n} dias`),
  },
};

function ageLabel(
  iso: string | null | undefined,
  t: (typeof T)[Locale],
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso.replace(" ", "T"));
  if (Number.isNaN(ms)) return null;
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return t.today;
  return t.daysAgo(days);
}

export function RecheckButton({
  legacyId,
  initialRequested,
  lastOpenCheck,
}: Props) {
  const locale = useLocale();
  const t = T[locale];
  const [requested, setRequested] = useState(initialRequested);
  const [sending, setSending] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Stato cambiato solo dalla conferma della route (`recheck_requested`).
  const toggle = async () => {
    setError(null);
    const next = !requested;
    setSending(true);
    const outcome = await sendPositionRequest(
      `/api/positions/${legacyId}/recheck-request`,
      { method: next ? "POST" : "DELETE" },
      (body) => body.recheck_requested === next,
    );
    setSending(false);
    if (!outcome.ok) {
      setError(
        requestFailureMessage(
          locale,
          next ? "request" : "cancel",
          requestFailureReason(locale, outcome.status),
        ),
      );
      return;
    }
    setRequested(next);
    startTransition(() => router.refresh());
  };

  const checked = ageLabel(lastOpenCheck, t);
  const description =
    sending || isPending
      ? t.sending
      : requested
        ? t.requestedDesc
        : t.desc + (checked ? t.lastCheck(checked) : "");

  return (
    <ActionRow
      icon={<IconOpenCheck />}
      title={t.title}
      description={description}
      accent="var(--color-purple)"
      active={requested}
      busy={sending || isPending}
      onClick={toggle}
      error={error}
    />
  );
}
