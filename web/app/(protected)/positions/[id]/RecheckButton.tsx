"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
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
    networkError: string;
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
    networkError: "Errore di rete",
  },
  en: {
    title: "Check it's still open",
    desc: "The team re-checks that the listing is still online",
    lastCheck: (age) => ` · last check: ${age}`,
    requestedDesc: "Request sent to the team — tap to cancel",
    sending: "One moment…",
    today: "today",
    daysAgo: (n) => (n === 1 ? "1 day ago" : `${n} days ago`),
    networkError: "Network error",
  },
  es: {
    title: "Comprueba que siga abierta",
    desc: "El equipo vuelve a comprobar que el anuncio siga en línea",
    lastCheck: (age) => ` · última comprobación: ${age}`,
    requestedDesc: "Solicitud enviada al equipo — toca para cancelar",
    sending: "Un momento…",
    today: "hoy",
    daysAgo: (n) => (n === 1 ? "hace 1 día" : `hace ${n} días`),
    networkError: "Error de red",
  },
  fr: {
    title: "Vérifier qu'elle est toujours ouverte",
    desc: "L'équipe revérifie que l'annonce est toujours en ligne",
    lastCheck: (age) => ` · dernière vérification : ${age}`,
    requestedDesc: "Demande envoyée à l'équipe — touchez pour annuler",
    sending: "Un instant…",
    today: "aujourd'hui",
    daysAgo: (n) => (n === 1 ? "il y a 1 jour" : `il y a ${n} jours`),
    networkError: "Erreur réseau",
  },
  de: {
    title: "Prüfen, ob sie noch offen ist",
    desc: "Das Team prüft erneut, ob die Anzeige noch online ist",
    lastCheck: (age) => ` · letzte Prüfung: ${age}`,
    requestedDesc: "Anfrage ans Team gesendet — zum Abbrechen tippen",
    sending: "Einen Moment…",
    today: "heute",
    daysAgo: (n) => (n === 1 ? "vor 1 Tag" : `vor ${n} Tagen`),
    networkError: "Netzwerkfehler",
  },
  hu: {
    title: "Ellenőrzés: még nyitott?",
    desc: "A csapat újra ellenőrzi, hogy a hirdetés még elérhető-e",
    lastCheck: (age) => ` · utolsó ellenőrzés: ${age}`,
    requestedDesc: "Kérés elküldve a csapatnak — koppints a visszavonáshoz",
    sending: "Egy pillanat…",
    today: "ma",
    daysAgo: (n) => `${n} napja`,
    networkError: "Hálózati hiba",
  },
  pt: {
    title: "Verifica se ainda está aberta",
    desc: "A equipa verifica novamente se o anúncio ainda está online",
    lastCheck: (age) => ` · última verificação: ${age}`,
    requestedDesc: "Pedido enviado à equipa — toca para cancelar",
    sending: "Um momento…",
    today: "hoje",
    daysAgo: (n) => (n === 1 ? "há 1 dia" : `há ${n} dias`),
    networkError: "Erro de rede",
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
  const t = T[useLocale()];
  const [requested, setRequested] = useState(initialRequested);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const toggle = async () => {
    setError(null);
    const next = !requested;
    setRequested(next);
    try {
      const res = await fetch(`/api/positions/${legacyId}/recheck-request`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRequested(!next);
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setRequested(!next);
      setError(e instanceof Error ? e.message : t.networkError);
    }
  };

  const checked = ageLabel(lastOpenCheck, t);
  const description = isPending
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
      busy={isPending}
      onClick={toggle}
      error={error}
    />
  );
}
