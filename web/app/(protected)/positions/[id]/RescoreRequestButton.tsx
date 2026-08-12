"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import {
  RESCORE_TICKET_KIND,
  type ActiveRescoreStatus,
} from "@/lib/rescore-ticket";
import { ActionRow, IconRefresh } from "./ActionRow";

interface Props {
  legacyId: number;
  initialStatus: ActiveRescoreStatus | null;
  disabled?: boolean;
}

const T: Record<
  Locale,
  {
    title: string;
    desc: string;
    requestText: string;
    openDesc: string;
    assignedDesc: string;
    sending: string;
    unavailable: string;
    networkError: string;
    invalidResponse: string;
  }
> = {
  it: {
    title: "Rivaluta questa posizione",
    desc: "Lo Scorer ricalcola il punteggio usando il profilo e i dati attuali",
    requestText:
      "Rivaluta questa posizione con lo Scorer e aggiorna il punteggio.",
    openDesc: "Rivalutazione richiesta — in attesa dello Scorer",
    assignedDesc: "Lo Scorer sta rivalutando questa posizione",
    sending: "Invio della richiesta…",
    unavailable: "La posizione non ha ancora uno score da rivalutare",
    networkError: "Errore di rete",
    invalidResponse: "Il team non ha confermato la richiesta",
  },
  en: {
    title: "Re-evaluate this position",
    desc: "The Scorer recalculates the score using the current profile and data",
    requestText:
      "Re-evaluate this position with the Scorer and update its score.",
    openDesc: "Re-evaluation requested — waiting for the Scorer",
    assignedDesc: "The Scorer is re-evaluating this position",
    sending: "Sending request…",
    unavailable: "This position does not have a score to re-evaluate yet",
    networkError: "Network error",
    invalidResponse: "The team did not confirm the request",
  },
  hu: {
    title: "Pozíció újraértékelése",
    desc: "A Scorer újraszámítja a pontszámot az aktuális profil és adatok alapján",
    requestText:
      "Értékeld újra ezt a pozíciót a Scorerrel, és frissítsd a pontszámot.",
    openDesc: "Újraértékelés kérve — várakozás a Scorerre",
    assignedDesc: "A Scorer újraértékeli ezt a pozíciót",
    sending: "Kérés küldése…",
    unavailable: "Ehhez a pozícióhoz még nincs újraértékelhető pontszám",
    networkError: "Hálózati hiba",
    invalidResponse: "A csapat nem erősítette meg a kérést",
  },
  es: {
    title: "Reevaluar esta posición",
    desc: "El Scorer recalcula la puntuación con el perfil y los datos actuales",
    requestText:
      "Reevalúa esta posición con el Scorer y actualiza su puntuación.",
    openDesc: "Reevaluación solicitada — esperando al Scorer",
    assignedDesc: "El Scorer está reevaluando esta posición",
    sending: "Enviando solicitud…",
    unavailable: "Esta posición aún no tiene una puntuación que reevaluar",
    networkError: "Error de red",
    invalidResponse: "El equipo no confirmó la solicitud",
  },
  de: {
    title: "Position neu bewerten",
    desc: "Der Scorer berechnet die Bewertung mit aktuellem Profil und Daten neu",
    requestText:
      "Bewerte diese Position mit dem Scorer neu und aktualisiere die Punktzahl.",
    openDesc: "Neubewertung angefordert — wartet auf den Scorer",
    assignedDesc: "Der Scorer bewertet diese Position neu",
    sending: "Anfrage wird gesendet…",
    unavailable: "Diese Position hat noch keine Bewertung zur Neubewertung",
    networkError: "Netzwerkfehler",
    invalidResponse: "Das Team hat die Anfrage nicht bestätigt",
  },
  fr: {
    title: "Réévaluer ce poste",
    desc: "Le Scorer recalcule le score avec le profil et les données actuels",
    requestText: "Réévalue ce poste avec le Scorer et mets à jour son score.",
    openDesc: "Réévaluation demandée — en attente du Scorer",
    assignedDesc: "Le Scorer réévalue ce poste",
    sending: "Envoi de la demande…",
    unavailable: "Ce poste n'a pas encore de score à réévaluer",
    networkError: "Erreur réseau",
    invalidResponse: "L'équipe n'a pas confirmé la demande",
  },
  pt: {
    title: "Reavaliar esta vaga",
    desc: "O Scorer recalcula a pontuação com o perfil e os dados atuais",
    requestText: "Reavalia esta vaga com o Scorer e atualiza a sua pontuação.",
    openDesc: "Reavaliação pedida — à espera do Scorer",
    assignedDesc: "O Scorer está a reavaliar esta vaga",
    sending: "A enviar pedido…",
    unavailable: "Esta vaga ainda não tem uma pontuação para reavaliar",
    networkError: "Erro de rede",
    invalidResponse: "A equipa não confirmou o pedido",
  },
};

export function RescoreRequestButton({
  legacyId,
  initialStatus,
  disabled = false,
}: Props) {
  const t = T[useLocale()];
  const [status, setStatus] = useState<ActiveRescoreStatus | null>(
    initialStatus,
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const requestRescore = async () => {
    if (status || disabled) return;
    setError(null);
    try {
      const res = await fetch(`/api/positions/${legacyId}/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: RESCORE_TICKET_KIND,
          request_text: t.requestText,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      // Un 2xx senza identità e stato del ticket non prova che la richiesta
      // sia entrata nella pipeline: leggiamo la conferma, poi aggiorniamo la UI.
      if (!body?.id || (body.status !== "open" && body.status !== "assigned")) {
        setError(t.invalidResponse);
        return;
      }
      setStatus(body.status);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : t.networkError);
    }
  };

  return (
    <ActionRow
      icon={<IconRefresh />}
      title={t.title}
      description={
        disabled
          ? t.unavailable
          : isPending
            ? t.sending
            : status === "assigned"
              ? t.assignedDesc
              : status === "open"
                ? t.openDesc
                : t.desc
      }
      accent="var(--color-purple)"
      active={status != null}
      busy={isPending}
      disabled={disabled || status != null}
      onClick={requestRescore}
      error={error}
    />
  );
}
