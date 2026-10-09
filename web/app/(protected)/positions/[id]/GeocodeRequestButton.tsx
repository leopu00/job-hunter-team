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
import { ActionRow, IconMapPin } from "./ActionRow";

interface Props {
  legacyId: number;
  initialRequested: boolean;
  // Quando il geocoding è gia' fatto mostriamo "Ricalcola" invece di
  // "Trova": l'utente puo' richiedere un refresh anche su posizioni già
  // geocodate (city-level → precise).
  alreadyGeocoded?: boolean;
}

const T: Record<
  Locale,
  {
    title: string;
    titleRecompute: string;
    desc: string;
    requestedDesc: string;
    sending: string;
  }
> = {
  it: {
    title: "Trova l'ufficio sulla mappa",
    titleRecompute: "Ricalcola la posizione dell'ufficio",
    desc: "Il team cerca l'indirizzo esatto della sede e mette il pin preciso sulla mappa",
    requestedDesc: "Richiesta inviata al team — tocca per annullare",
    sending: "Un momento…",
  },
  en: {
    title: "Locate the office on the map",
    titleRecompute: "Recompute the office location",
    desc: "The team looks up the exact office address and pins it on the map",
    requestedDesc: "Request sent to the team — tap to cancel",
    sending: "One moment…",
  },
  es: {
    title: "Ubicar la oficina en el mapa",
    titleRecompute: "Recalcular la ubicación de la oficina",
    desc: "El equipo busca la dirección exacta de la sede y la marca en el mapa",
    requestedDesc: "Solicitud enviada al equipo — toca para cancelar",
    sending: "Un momento…",
  },
  fr: {
    title: "Localiser le bureau sur la carte",
    titleRecompute: "Recalculer la position du bureau",
    desc: "L'équipe recherche l'adresse exacte du bureau et la place sur la carte",
    requestedDesc: "Demande envoyée à l'équipe — touchez pour annuler",
    sending: "Un instant…",
  },
  de: {
    title: "Büro auf der Karte finden",
    titleRecompute: "Bürostandort neu berechnen",
    desc: "Das Team ermittelt die genaue Büroadresse und setzt den Pin auf die Karte",
    requestedDesc: "Anfrage ans Team gesendet — zum Abbrechen tippen",
    sending: "Einen Moment…",
  },
  hu: {
    title: "Iroda megkeresése a térképen",
    titleRecompute: "Irodahely újraszámítása",
    desc: "A csapat megkeresi az iroda pontos címét és kiteszi a térképre",
    requestedDesc: "Kérés elküldve a csapatnak — koppints a visszavonáshoz",
    sending: "Egy pillanat…",
  },
  pt: {
    title: "Localizar o escritório no mapa",
    titleRecompute: "Recalcular a localização do escritório",
    desc: "A equipa procura o endereço exato da sede e coloca o pin no mapa",
    requestedDesc: "Pedido enviado à equipa — toca para cancelar",
    sending: "Um momento…",
  },
};

export function GeocodeRequestButton({
  legacyId,
  initialRequested,
  alreadyGeocoded = false,
}: Props) {
  const locale = useLocale();
  const t = T[locale];
  const [requested, setRequested] = useState(initialRequested);
  const [sending, setSending] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Stato cambiato solo dalla conferma della route (`geocode_requested`).
  const toggle = async () => {
    setError(null);
    const next = !requested;
    setSending(true);
    const outcome = await sendPositionRequest(
      `/api/positions/${legacyId}/geocode-request`,
      { method: next ? "POST" : "DELETE" },
      (body) =>
        (body.position as { geocode_requested?: unknown } | undefined)
          ?.geocode_requested === next,
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

  return (
    <ActionRow
      icon={<IconMapPin />}
      title={alreadyGeocoded ? t.titleRecompute : t.title}
      description={
        sending || isPending ? t.sending : requested ? t.requestedDesc : t.desc
      }
      accent="var(--color-purple)"
      active={requested}
      busy={sending || isPending}
      onClick={toggle}
      error={error}
    />
  );
}
