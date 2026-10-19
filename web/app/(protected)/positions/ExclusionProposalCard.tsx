"use client";

// La proposta di escludere un tipo di posizioni dal profilo (JHT-T05).
//
// Compare quando l'utente ha bocciato, con lo stesso motivo, almeno tre
// posizioni DIVERSE (la regola è `exclusionProposals`, la stessa di Python).
// Decide l'utente: «Salva la preferenza» o «Non ora». E il testo dice in
// chiaro cosa NON succede: per ora la preferenza viene solo salvata, non
// cambia ciò che il team cerca né come valuta. Niente promesse che non
// manteniamo.

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { visibleProposals, type ExclusionDecision } from "@/lib/exclusion-proposals";
import type { ExclusionProposal, FeedbackEventLike } from "@/lib/feedback-reasons";
import { REASON_LABELS } from "./[id]/exclusion-reasons";

const T: Record<
  string,
  { title: string; question: string; honest: string; save: string; later: string; saved: string }
> = {
  it: {
    title: "{n} posizioni scartate come «{reason}»",
    question: "Vuoi escludere questo tipo di posizioni dal tuo profilo?",
    honest:
      "Per ora salviamo solo la tua preferenza: non cambia ancora quello che il team cerca né come valuta le posizioni.",
    save: "Salva la preferenza",
    later: "Non ora",
    saved: "Preferenza salvata.",
  },
  en: {
    title: "{n} positions rejected as “{reason}”",
    question: "Do you want to exclude this kind of position from your profile?",
    honest:
      "For now we only save your preference: it does not yet change what the team looks for or how it scores positions.",
    save: "Save the preference",
    later: "Not now",
    saved: "Preference saved.",
  },
  es: {
    title: "{n} posiciones descartadas como «{reason}»",
    question: "¿Quieres excluir este tipo de posiciones de tu perfil?",
    honest:
      "Por ahora solo guardamos tu preferencia: todavía no cambia lo que busca el equipo ni cómo valora las posiciones.",
    save: "Guardar la preferencia",
    later: "Ahora no",
    saved: "Preferencia guardada.",
  },
  fr: {
    title: "{n} postes écartés comme « {reason} »",
    question: "Voulez-vous exclure ce type de postes de votre profil ?",
    honest:
      "Pour l'instant nous enregistrons seulement votre préférence : elle ne change pas encore ce que l'équipe cherche ni comment elle note les postes.",
    save: "Enregistrer la préférence",
    later: "Pas maintenant",
    saved: "Préférence enregistrée.",
  },
  de: {
    title: "{n} Stellen als „{reason}“ abgelehnt",
    question: "Möchtest du diese Art von Stellen aus deinem Profil ausschließen?",
    honest:
      "Vorerst speichern wir nur deine Präferenz: Sie ändert noch nicht, wonach das Team sucht oder wie es Stellen bewertet.",
    save: "Präferenz speichern",
    later: "Nicht jetzt",
    saved: "Präferenz gespeichert.",
  },
  hu: {
    title: "{n} pozíció elutasítva ezzel az okkal: „{reason}”",
    question: "Ki szeretnéd zárni ezt a fajta pozíciót a profilodból?",
    honest:
      "Egyelőre csak a preferenciádat mentjük: ez még nem változtatja meg, mit keres a csapat, és hogyan értékeli a pozíciókat.",
    save: "Preferencia mentése",
    later: "Most nem",
    saved: "Preferencia elmentve.",
  },
  pt: {
    title: "{n} vagas rejeitadas como «{reason}»",
    question: "Quer excluir este tipo de vaga do seu perfil?",
    honest:
      "Por agora só guardamos a sua preferência: ainda não muda o que a equipa procura nem como avalia as vagas.",
    save: "Guardar a preferência",
    later: "Agora não",
    saved: "Preferência guardada.",
  },
};

type FeedbackRow = {
  position_legacy_id: string | number;
  action: string;
  reason: string | null;
  created_at: string | null;
};

export default function ExclusionProposalCard() {
  const locale = useLocale();
  const t = T[locale] ?? T.en;
  const labels = REASON_LABELS[locale] ?? REASON_LABELS.en;
  const [proposals, setProposals] = useState<ExclusionProposal[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [feedback, decisions] = await Promise.all([
          fetch("/api/positions/feedback?days=0&limit=2000"),
          fetch("/api/profile-exclusions"),
        ]);
        if (!feedback.ok || !decisions.ok) return;
        const rows = ((await feedback.json()) as { feedback?: FeedbackRow[] }).feedback ?? [];
        const decided =
          ((await decisions.json()) as { exclusions?: ExclusionDecision[] }).exclusions ?? [];
        const events: FeedbackEventLike[] = rows.map((r) => ({
          legacy_id: r.position_legacy_id,
          action: r.action,
          reason: r.reason,
          created_at: r.created_at,
        }));
        if (alive) setProposals(visibleProposals(events, decided));
      } catch {
        // Senza rete o fuori dal cloud la scheda semplicemente non c'è.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const proposal = proposals[0];
  if (saved) {
    return (
      <p role="status" className="text-[12px] mb-3" style={{ color: "var(--color-muted)" }}>
        {t.saved}
      </p>
    );
  }
  if (!proposal) return null;

  const decide = async (status: "accepted" | "dismissed") => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/profile-exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: proposal.reason,
          status,
          positions: proposal.positions,
        }),
      });
      if (res.ok) {
        if (status === "accepted") setSaved(true);
        setProposals((all) => all.filter((p) => p.reason !== proposal.reason));
      }
    } catch {
      // Resta la scheda: l'utente può riprovare.
    }
    setBusy(false);
  };

  const title = t.title
    .replace("{n}", String(proposal.positions))
    .replace("{reason}", labels[proposal.reason]);
  return (
    <section
      aria-label={title}
      data-exclusion-proposal={proposal.reason}
      className="rounded-lg border p-3 mb-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-row)" }}
    >
      <p className="text-[12px] font-semibold" style={{ color: "var(--color-text)" }}>
        {title}
      </p>
      <p className="text-[12px] mt-1" style={{ color: "var(--color-text)" }}>
        {t.question}
      </p>
      <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>
        {t.honest}
      </p>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("accepted")}
          className="px-3 py-1.5 rounded-lg border text-[11px] font-semibold disabled:opacity-60"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
        >
          {t.save}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide("dismissed")}
          className="px-3 py-1.5 rounded-lg border text-[11px] disabled:opacity-60"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
        >
          {t.later}
        </button>
      </div>
    </section>
  );
}
