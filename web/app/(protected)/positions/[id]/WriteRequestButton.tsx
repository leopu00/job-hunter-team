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
import { ActionRow, IconFileText } from "./ActionRow";

interface Props {
  legacyId: number;
  initialRequested: boolean;
  // Disabilita il button se la posizione non e' nello stato giusto:
  //   - status !== 'scored' -> non puoi richiedere CV prima dello Scorer
  //   - applicationExists  -> CV gia' scritto / in coda con applications
  disabled?: boolean;
  disabledReason?: string;
}

const T: Record<
  Locale,
  {
    title: string;
    desc: string;
    requestedDesc: string;
    sending: string;
    unavailable: string;
  }
> = {
  it: {
    title: "Richiedi il CV su misura",
    desc: "Il team scrive un CV su misura per questa offerta",
    requestedDesc: "CV richiesto al team — tocca per annullare",
    sending: "Un momento…",
    unavailable: "Non disponibile",
  },
  en: {
    title: "Request a tailored CV",
    desc: "The team writes a tailored CV for this position",
    requestedDesc: "CV requested from the team — tap to cancel",
    sending: "One moment…",
    unavailable: "Not available",
  },
  es: {
    title: "Solicita un CV a medida",
    desc: "El equipo redacta un CV a medida para esta oferta",
    requestedDesc: "CV solicitado al equipo — toca para cancelar",
    sending: "Un momento…",
    unavailable: "No disponible",
  },
  fr: {
    title: "Demander un CV sur mesure",
    desc: "L'équipe rédige un CV sur mesure pour ce poste",
    requestedDesc: "CV demandé à l'équipe — touchez pour annuler",
    sending: "Un instant…",
    unavailable: "Non disponible",
  },
  de: {
    title: "Maßgeschneiderten Lebenslauf anfordern",
    desc: "Das Team schreibt einen passenden Lebenslauf für diese Stelle",
    requestedDesc: "Lebenslauf angefordert — zum Abbrechen tippen",
    sending: "Einen Moment…",
    unavailable: "Nicht verfügbar",
  },
  hu: {
    title: "Kérj testreszabott önéletrajzot",
    desc: "A csapat személyre szabott önéletrajzot ír ehhez az álláshoz",
    requestedDesc: "Önéletrajz kérve a csapattól — koppints a visszavonáshoz",
    sending: "Egy pillanat…",
    unavailable: "Nem elérhető",
  },
  pt: {
    title: "Pede um CV à medida",
    desc: "A equipa escreve um CV à medida para esta vaga",
    requestedDesc: "CV solicitado à equipa — toca para cancelar",
    sending: "Um momento…",
    unavailable: "Não disponível",
  },
};

export function WriteRequestButton({
  legacyId,
  initialRequested,
  disabled = false,
  disabledReason,
}: Props) {
  const locale = useLocale();
  const t = T[locale];
  const [requested, setRequested] = useState(initialRequested);
  const [sending, setSending] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Lo stato cambia solo quando la route conferma: niente più update
  // ottimistico, che per un attimo diceva «richiesto» anche a una richiesta
  // che non sarebbe mai arrivata al team.
  const toggle = async () => {
    setError(null);
    const next = !requested;
    setSending(true);
    const outcome = await sendPositionRequest(
      `/api/positions/${legacyId}/write-request`,
      { method: next ? "POST" : "DELETE" },
      (body) =>
        (body.position as { write_requested?: unknown } | undefined)
          ?.write_requested === next,
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
    // Hard refresh dei dati server-side per allineare anche
    // applications/status post-spawn Scrittore (futuro).
    startTransition(() => router.refresh());
  };

  return (
    <ActionRow
      icon={<IconFileText />}
      title={t.title}
      description={
        disabled
          ? (disabledReason ?? t.unavailable)
          : sending || isPending
            ? t.sending
            : requested
              ? t.requestedDesc
              : t.desc
      }
      accent="var(--color-purple)"
      active={requested}
      busy={sending || isPending}
      disabled={disabled}
      onClick={toggle}
      error={error}
    />
  );
}
