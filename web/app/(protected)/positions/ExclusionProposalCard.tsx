"use client";

// La proposta di escludere un tipo di posizioni dal profilo (JHT-T05, JHT-T24).
//
// Compare quando l'utente ha bocciato, con lo stesso motivo, almeno tre
// posizioni DIVERSE (la regola è `exclusionProposals`, la stessa di Python).
// Decide l'utente, e solo dall'app desktop: «Escludi questo tipo» o «Non ora».
// Sul sito la proposta si vede ma non si decide. Il testo dice in chiaro cosa
// succede: per i quattro motivi che agiscono (azienda, località, stipendio,
// stack) il team ABBASSA il punteggio di quelle posizioni (non le nasconde);
// per la seniority la preferenza si salva e per ora non cambia niente.

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { isActingReason } from "@/lib/feedback-reasons";
import { useDesktopWrite } from "@/lib/desktop-write";
import {
  visibleProposals,
  type ExclusionDecision,
} from "@/lib/exclusion-proposals";
import type {
  ExclusionProposal,
  FeedbackEventLike,
} from "@/lib/feedback-reasons";
import { REASON_LABELS } from "./[id]/exclusion-reasons";

const T: Record<
  string,
  {
    title: string;
    question: string;
    acts: string;
    notYet: string;
    desktopOnly: string;
    save: string;
    later: string;
    saved: string;
  }
> = {
  it: {
    title: "{n} posizioni scartate come «{reason}»",
    question: "Vuoi escludere questo tipo di posizioni dal tuo profilo?",
    acts: "Se accetti, il team abbassa il punteggio delle posizioni di questo tipo (−15, −30 per un'azienda): non le nasconde e non smette di cercarle. Puoi ritirare la scelta quando vuoi.",
    notYet:
      "Per ora salviamo solo la tua preferenza: per la seniority non cambia ancora quello che il team cerca né come valuta le posizioni.",
    desktopOnly: "Questa scelta si fa nell'app desktop.",
    save: "Escludi questo tipo",
    later: "Non ora",
    saved: "Esclusione salvata.",
  },
  en: {
    title: "{n} positions rejected as “{reason}”",
    question: "Do you want to exclude this kind of position from your profile?",
    acts: "If you accept, the team lowers the score of positions like these (−15, −30 for a company): it does not hide them or stop finding them. You can withdraw the choice at any time.",
    notYet:
      "For now we only save your preference: for seniority it does not yet change what the team looks for or how it scores positions.",
    desktopOnly: "You make this choice in the desktop app.",
    save: "Exclude this kind",
    later: "Not now",
    saved: "Exclusion saved.",
  },
  es: {
    title: "{n} posiciones descartadas como «{reason}»",
    question: "¿Quieres excluir este tipo de posiciones de tu perfil?",
    acts: "Si aceptas, el equipo baja la puntuación de las posiciones de este tipo (−15, −30 para una empresa): no las oculta ni deja de buscarlas. Puedes retirar la elección cuando quieras.",
    notYet:
      "Por ahora solo guardamos tu preferencia: para la seniority todavía no cambia lo que busca el equipo ni cómo valora las posiciones.",
    desktopOnly: "Esta elección se hace en la aplicación de escritorio.",
    save: "Excluir este tipo",
    later: "Ahora no",
    saved: "Exclusión guardada.",
  },
  fr: {
    title: "{n} postes écartés comme « {reason} »",
    question: "Voulez-vous exclure ce type de postes de votre profil ?",
    acts: "Si vous acceptez, l'équipe baisse la note des postes de ce type (−15, −30 pour une entreprise) : elle ne les cache pas et continue de les trouver. Vous pouvez retirer ce choix à tout moment.",
    notYet:
      "Pour l'instant nous enregistrons seulement votre préférence : pour la séniorité elle ne change pas encore ce que l'équipe cherche ni comment elle note les postes.",
    desktopOnly: "Ce choix se fait dans l'application de bureau.",
    save: "Exclure ce type",
    later: "Pas maintenant",
    saved: "Exclusion enregistrée.",
  },
  de: {
    title: "{n} Stellen als „{reason}“ abgelehnt",
    question:
      "Möchtest du diese Art von Stellen aus deinem Profil ausschließen?",
    acts: "Wenn du zustimmst, senkt das Team die Bewertung solcher Stellen (−15, −30 bei einem Unternehmen): Es blendet sie nicht aus und sucht weiter. Du kannst die Entscheidung jederzeit zurücknehmen.",
    notYet:
      "Vorerst speichern wir nur deine Präferenz: Bei der Seniorität ändert sie noch nicht, wonach das Team sucht oder wie es Stellen bewertet.",
    desktopOnly: "Diese Entscheidung triffst du in der Desktop-App.",
    save: "Diesen Typ ausschließen",
    later: "Nicht jetzt",
    saved: "Ausschluss gespeichert.",
  },
  hu: {
    title: "{n} pozíció elutasítva ezzel az okkal: „{reason}”",
    question: "Ki szeretnéd zárni ezt a fajta pozíciót a profilodból?",
    acts: "Ha elfogadod, a csapat csökkenti az ilyen pozíciók pontszámát (−15, cég esetén −30): nem rejti el őket, és tovább keresi őket. A döntést bármikor visszavonhatod.",
    notYet:
      "Egyelőre csak a preferenciádat mentjük: a szenioritásnál ez még nem változtatja meg, mit keres a csapat, és hogyan értékeli a pozíciókat.",
    desktopOnly: "Ezt a döntést az asztali alkalmazásban hozhatod meg.",
    save: "Ezt a típust kizárom",
    later: "Most nem",
    saved: "Kizárás elmentve.",
  },
  pt: {
    title: "{n} vagas rejeitadas como «{reason}»",
    question: "Quer excluir este tipo de vaga do seu perfil?",
    acts: "Se aceitar, a equipa baixa a pontuação das vagas deste tipo (−15, −30 para uma empresa): não as esconde nem deixa de as encontrar. Pode retirar a escolha quando quiser.",
    notYet:
      "Por agora só guardamos a sua preferência: para a senioridade ainda não muda o que a equipa procura nem como avalia as vagas.",
    desktopOnly: "Esta escolha faz-se na aplicação de ambiente de trabalho.",
    save: "Excluir este tipo",
    later: "Agora não",
    saved: "Exclusão guardada.",
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
  const { canChange } = useDesktopWrite();
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
        const rows =
          ((await feedback.json()) as { feedback?: FeedbackRow[] }).feedback ??
          [];
        const decided =
          ((await decisions.json()) as { exclusions?: ExclusionDecision[] })
            .exclusions ?? [];
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
      <p
        role="status"
        className="text-[12px] mb-3"
        style={{ color: "var(--color-muted)" }}
      >
        {t.saved}
      </p>
    );
  }
  if (!proposal) return null;

  const decide = async (status: "accepted" | "dismissed") => {
    if (busy || !canChange) return;
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
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-row)",
      }}
    >
      <p
        className="text-[12px] font-semibold"
        style={{ color: "var(--color-text)" }}
      >
        {title}
      </p>
      <p className="text-[12px] mt-1" style={{ color: "var(--color-text)" }}>
        {t.question}
      </p>
      <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>
        {isActingReason(proposal.reason) ? t.acts : t.notYet}
      </p>
      {!canChange && (
        <p
          className="text-[11px] mt-1 font-semibold"
          style={{ color: "var(--color-muted)" }}
        >
          {t.desktopOnly}
        </p>
      )}
      {canChange && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("accepted")}
            className="px-3 py-1.5 rounded-lg border text-[11px] font-semibold disabled:opacity-60"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            {t.save}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide("dismissed")}
            className="px-3 py-1.5 rounded-lg border text-[11px] disabled:opacity-60"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-muted)",
            }}
          >
            {t.later}
          </button>
        </div>
      )}
    </section>
  );
}
