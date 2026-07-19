"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
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
    networkError: string;
  }
> = {
  it: {
    title: "Trova l'ufficio sulla mappa",
    titleRecompute: "Ricalcola la posizione dell'ufficio",
    desc: "Il team cerca l'indirizzo esatto della sede e mette il pin preciso sulla mappa",
    requestedDesc: "Richiesta inviata al team — tocca per annullare",
    sending: "Un momento…",
    networkError: "Errore di rete",
  },
  en: {
    title: "Locate the office on the map",
    titleRecompute: "Recompute the office location",
    desc: "The team looks up the exact office address and pins it on the map",
    requestedDesc: "Request sent to the team — tap to cancel",
    sending: "One moment…",
    networkError: "Network error",
  },
  es: {
    title: "Ubicar la oficina en el mapa",
    titleRecompute: "Recalcular la ubicación de la oficina",
    desc: "El equipo busca la dirección exacta de la sede y la marca en el mapa",
    requestedDesc: "Solicitud enviada al equipo — toca para cancelar",
    sending: "Un momento…",
    networkError: "Error de red",
  },
  fr: {
    title: "Localiser le bureau sur la carte",
    titleRecompute: "Recalculer la position du bureau",
    desc: "L'équipe recherche l'adresse exacte du bureau et la place sur la carte",
    requestedDesc: "Demande envoyée à l'équipe — touchez pour annuler",
    sending: "Un instant…",
    networkError: "Erreur réseau",
  },
  de: {
    title: "Büro auf der Karte finden",
    titleRecompute: "Bürostandort neu berechnen",
    desc: "Das Team ermittelt die genaue Büroadresse und setzt den Pin auf die Karte",
    requestedDesc: "Anfrage ans Team gesendet — zum Abbrechen tippen",
    sending: "Einen Moment…",
    networkError: "Netzwerkfehler",
  },
  hu: {
    title: "Iroda megkeresése a térképen",
    titleRecompute: "Irodahely újraszámítása",
    desc: "A csapat megkeresi az iroda pontos címét és kiteszi a térképre",
    requestedDesc: "Kérés elküldve a csapatnak — koppints a visszavonáshoz",
    sending: "Egy pillanat…",
    networkError: "Hálózati hiba",
  },
  pt: {
    title: "Localizar o escritório no mapa",
    titleRecompute: "Recalcular a localização do escritório",
    desc: "A equipa procura o endereço exato da sede e coloca o pin no mapa",
    requestedDesc: "Pedido enviado à equipa — toca para cancelar",
    sending: "Um momento…",
    networkError: "Erro de rede",
  },
};

export function GeocodeRequestButton({
  legacyId,
  initialRequested,
  alreadyGeocoded = false,
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
      const res = await fetch(`/api/positions/${legacyId}/geocode-request`, {
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

  return (
    <ActionRow
      icon={<IconMapPin />}
      title={alreadyGeocoded ? t.titleRecompute : t.title}
      description={isPending ? t.sending : requested ? t.requestedDesc : t.desc}
      accent="var(--color-purple)"
      active={requested}
      busy={isPending}
      onClick={toggle}
      error={error}
    />
  );
}
