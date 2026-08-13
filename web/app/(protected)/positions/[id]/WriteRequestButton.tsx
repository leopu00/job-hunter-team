"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
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
    networkError: string;
  }
> = {
  it: {
    title: "Richiedi il CV su misura",
    desc: "Il team scrive un CV su misura per questa offerta",
    requestedDesc: "CV richiesto al team — tocca per annullare",
    sending: "Un momento…",
    unavailable: "Non disponibile",
    networkError: "Errore di rete",
  },
  en: {
    title: "Request a tailored CV",
    desc: "The team writes a tailored CV for this position",
    requestedDesc: "CV requested from the team — tap to cancel",
    sending: "One moment…",
    unavailable: "Not available",
    networkError: "Network error",
  },
  es: {
    title: "Solicita un CV a medida",
    desc: "El equipo redacta un CV a medida para esta oferta",
    requestedDesc: "CV solicitado al equipo — toca para cancelar",
    sending: "Un momento…",
    unavailable: "No disponible",
    networkError: "Error de red",
  },
  fr: {
    title: "Demander un CV sur mesure",
    desc: "L'équipe rédige un CV sur mesure pour ce poste",
    requestedDesc: "CV demandé à l'équipe — touchez pour annuler",
    sending: "Un instant…",
    unavailable: "Non disponible",
    networkError: "Erreur réseau",
  },
  de: {
    title: "Maßgeschneiderten Lebenslauf anfordern",
    desc: "Das Team schreibt einen passenden Lebenslauf für diese Stelle",
    requestedDesc: "Lebenslauf angefordert — zum Abbrechen tippen",
    sending: "Einen Moment…",
    unavailable: "Nicht verfügbar",
    networkError: "Netzwerkfehler",
  },
  hu: {
    title: "Kérj testreszabott önéletrajzot",
    desc: "A csapat személyre szabott önéletrajzot ír ehhez az álláshoz",
    requestedDesc: "Önéletrajz kérve a csapattól — koppints a visszavonáshoz",
    sending: "Egy pillanat…",
    unavailable: "Nem elérhető",
    networkError: "Hálózati hiba",
  },
  pt: {
    title: "Pede um CV à medida",
    desc: "A equipa escreve um CV à medida para esta vaga",
    requestedDesc: "CV solicitado à equipa — toca para cancelar",
    sending: "Um momento…",
    unavailable: "Não disponível",
    networkError: "Erro de rede",
  },
};

export function WriteRequestButton({
  legacyId,
  initialRequested,
  disabled = false,
  disabledReason,
}: Props) {
  const t = T[useLocale()];
  const [requested, setRequested] = useState(initialRequested);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const toggle = async () => {
    setError(null);
    const next = !requested;
    // Optimistic update: il Capitano vede comunque la verita' di SQLite,
    // qui ottimizziamo per la UX percepita. Se POST/DELETE fallisce
    // riportiamo lo stato indietro.
    setRequested(next);
    try {
      const res = await fetch(`/api/positions/${legacyId}/write-request`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRequested(!next);
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      // Hard refresh dei dati server-side per allineare anche
      // applications/status post-spawn Scrittore (futuro).
      startTransition(() => router.refresh());
    } catch (e) {
      setRequested(!next);
      setError(e instanceof Error ? e.message : t.networkError);
    }
  };

  return (
    <ActionRow
      icon={<IconFileText />}
      title={t.title}
      description={
        disabled
          ? (disabledReason ?? t.unavailable)
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
