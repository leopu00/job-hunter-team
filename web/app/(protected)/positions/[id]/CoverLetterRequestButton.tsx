"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
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
    networkError: string;
    invalidResponse: string;
  }
> = {
  it: {
    title: "Richiedi una cover letter",
    desc: "Il team prepara una lettera su misura senza modificare il CV",
    requestedDesc: "Cover letter richiesta al team — tocca per annullare",
    sending: "Un momento…",
    unavailable: "Disponibile dopo la creazione del CV",
    networkError: "Errore di rete",
    invalidResponse: "Il team non ha confermato la richiesta",
  },
  en: {
    title: "Request a cover letter",
    desc: "The team prepares a tailored letter without changing the CV",
    requestedDesc: "Cover letter requested — tap to cancel",
    sending: "One moment…",
    unavailable: "Available after the CV is created",
    networkError: "Network error",
    invalidResponse: "The team did not confirm the request",
  },
  hu: {
    title: "Motivációs levél kérése",
    desc: "A csapat személyre szabott levelet készít a CV módosítása nélkül",
    requestedDesc: "Motivációs levél kérve — koppints a visszavonáshoz",
    sending: "Egy pillanat…",
    unavailable: "A CV elkészítése után érhető el",
    networkError: "Hálózati hiba",
    invalidResponse: "A csapat nem erősítette meg a kérést",
  },
  es: {
    title: "Solicitar una carta de presentación",
    desc: "El equipo prepara una carta a medida sin modificar el CV",
    requestedDesc: "Carta solicitada — toca para cancelar",
    sending: "Un momento…",
    unavailable: "Disponible después de crear el CV",
    networkError: "Error de red",
    invalidResponse: "El equipo no confirmó la solicitud",
  },
  de: {
    title: "Anschreiben anfordern",
    desc: "Das Team erstellt ein passendes Anschreiben, ohne den Lebenslauf zu ändern",
    requestedDesc: "Anschreiben angefordert — zum Abbrechen tippen",
    sending: "Einen Moment…",
    unavailable: "Verfügbar, nachdem der Lebenslauf erstellt wurde",
    networkError: "Netzwerkfehler",
    invalidResponse: "Das Team hat die Anfrage nicht bestätigt",
  },
  fr: {
    title: "Demander une lettre de motivation",
    desc: "L'équipe prépare une lettre sur mesure sans modifier le CV",
    requestedDesc: "Lettre demandée — touchez pour annuler",
    sending: "Un instant…",
    unavailable: "Disponible après la création du CV",
    networkError: "Erreur réseau",
    invalidResponse: "L'équipe n'a pas confirmé la demande",
  },
  pt: {
    title: "Pedir uma carta de apresentação",
    desc: "A equipa prepara uma carta à medida sem alterar o CV",
    requestedDesc: "Carta pedida — toca para cancelar",
    sending: "Um momento…",
    unavailable: "Disponível depois de criar o CV",
    networkError: "Erro de rede",
    invalidResponse: "A equipa não confirmou o pedido",
  },
};

export function CoverLetterRequestButton({
  legacyId,
  initialRequested,
  disabled = false,
}: Props) {
  const t = COVER_LETTER_REQUEST_TEXT[useLocale()];
  const [requested, setRequested] = useState(initialRequested);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const toggle = async () => {
    setError(null);
    const next = !requested;
    setRequested(next);
    try {
      const res = await fetch(`/api/positions/${legacyId}/write-request`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: KIND }),
      });
      const body = await res.json().catch(() => null);
      const acknowledged =
        body?.position?.write_requested === next &&
        (next
          ? body.position.write_request_kind === KIND
          : body.position.write_request_kind == null);
      if (!res.ok || !acknowledged) {
        setRequested(!next);
        setError(
          res.ok ? t.invalidResponse : (body?.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      startTransition(() => router.refresh());
    } catch (error) {
      setRequested(!next);
      setError(error instanceof Error ? error.message : t.networkError);
    }
  };

  return (
    <ActionRow
      icon={<IconCoverLetter />}
      title={t.title}
      description={
        disabled
          ? t.unavailable
          : isPending
            ? t.sending
            : requested
              ? t.requestedDesc
              : t.desc
      }
      accent="var(--color-purple)"
      active={requested}
      busy={isPending}
      disabled={disabled}
      onClick={toggle}
      error={error}
    />
  );
}
