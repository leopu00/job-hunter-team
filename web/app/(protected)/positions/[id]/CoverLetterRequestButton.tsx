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
import { ActionRow, IconCoverLetter } from "./ActionRow";

interface Props {
  legacyId: number;
  initialRequested: boolean;
  disabled?: boolean;
}

const KIND = "cover_letter";
export const COVER_LETTER_REQUEST_TEXT: Record<
  Locale,
  {
    title: string;
    desc: string;
    requestedDesc: string;
    sending: string;
    unavailable: string;
    invalidResponse: string;
  }
> = {
  it: {
    title: "Richiedi una cover letter",
    desc: "Il team prepara una lettera su misura senza modificare il CV",
    requestedDesc: "Cover letter richiesta al team — tocca per annullare",
    sending: "Un momento…",
    unavailable: "Disponibile dopo la creazione del CV",
    invalidResponse: "Il team non ha confermato la richiesta",
  },
  en: {
    title: "Request a cover letter",
    desc: "The team prepares a tailored letter without changing the CV",
    requestedDesc: "Cover letter requested — tap to cancel",
    sending: "One moment…",
    unavailable: "Available after the CV is created",
    invalidResponse: "The team did not confirm the request",
  },
  hu: {
    title: "Motivációs levél kérése",
    desc: "A csapat személyre szabott levelet készít a CV módosítása nélkül",
    requestedDesc: "Motivációs levél kérve — koppints a visszavonáshoz",
    sending: "Egy pillanat…",
    unavailable: "A CV elkészítése után érhető el",
    invalidResponse: "A csapat nem erősítette meg a kérést",
  },
  es: {
    title: "Solicitar una carta de presentación",
    desc: "El equipo prepara una carta a medida sin modificar el CV",
    requestedDesc: "Carta solicitada — toca para cancelar",
    sending: "Un momento…",
    unavailable: "Disponible después de crear el CV",
    invalidResponse: "El equipo no confirmó la solicitud",
  },
  de: {
    title: "Anschreiben anfordern",
    desc: "Das Team erstellt ein passendes Anschreiben, ohne den Lebenslauf zu ändern",
    requestedDesc: "Anschreiben angefordert — zum Abbrechen tippen",
    sending: "Einen Moment…",
    unavailable: "Verfügbar, nachdem der Lebenslauf erstellt wurde",
    invalidResponse: "Das Team hat die Anfrage nicht bestätigt",
  },
  fr: {
    title: "Demander une lettre de motivation",
    desc: "L'équipe prépare une lettre sur mesure sans modifier le CV",
    requestedDesc: "Lettre demandée — touchez pour annuler",
    sending: "Un instant…",
    unavailable: "Disponible après la création du CV",
    invalidResponse: "L'équipe n'a pas confirmé la demande",
  },
  pt: {
    title: "Pedir uma carta de apresentação",
    desc: "A equipa prepara uma carta à medida sem alterar o CV",
    requestedDesc: "Carta pedida — toca para cancelar",
    sending: "Um momento…",
    unavailable: "Disponível depois de criar o CV",
    invalidResponse: "A equipa não confirmou o pedido",
  },
};

export function CoverLetterRequestButton({
  legacyId,
  initialRequested,
  disabled = false,
}: Props) {
  const locale = useLocale();
  const t = COVER_LETTER_REQUEST_TEXT[locale];
  const [requested, setRequested] = useState(initialRequested);
  const [sending, setSending] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Stato cambiato solo quando la route conferma proprio la lettera.
  const toggle = async () => {
    setError(null);
    const next = !requested;
    setSending(true);
    const acknowledged = (body: Record<string, unknown>) => {
      const position = body.position as
        | { write_requested?: unknown; write_request_kind?: unknown }
        | undefined;
      return (
        position?.write_requested === next &&
        (next
          ? position.write_request_kind === KIND
          : position.write_request_kind == null)
      );
    };
    const outcome = await sendPositionRequest(
      `/api/positions/${legacyId}/write-request`,
      {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: KIND }),
      },
      acknowledged,
    );
    setSending(false);
    if (!outcome.ok) {
      // Un 2xx che non conferma la lettera, e il 409 della lettera senza
      // candidatura, hanno la loro frase; il resto viene dallo status.
      const reason =
        outcome.code === "cover_letter_requires_application"
          ? t.unavailable
          : outcome.unconfirmed
            ? t.invalidResponse
            : requestFailureReason(locale, outcome.status);
      setError(
        requestFailureMessage(locale, next ? "request" : "cancel", reason),
      );
      return;
    }
    setRequested(next);
    startTransition(() => router.refresh());
  };

  return (
    <ActionRow
      icon={<IconCoverLetter />}
      title={t.title}
      description={
        disabled
          ? t.unavailable
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
