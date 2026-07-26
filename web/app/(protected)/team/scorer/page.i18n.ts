// Dizionario di `page.tsx`.
//
// Le chiavi sono LOCALI a questo file: lo stesso nome può valere
// tutt'altro altrove (`empty` è "nessun backup" in una pagina e
// "nessun canale" in un'altra), quindi non vanno accorpate in un
// dizionario comune. `satisfies Dictionary` fa pretendere al
// compilatore tutte e sette le lingue: una voce a cui ne manca una
// non compila, invece di mostrare l'inglese all'utente sbagliato.
import type { Dictionary } from "@/lib/i18n-dict";

export const T = {
  dashboard: {
    it: "Dashboard",
    en: "Dashboard",
    es: "Panel",
    fr: "Tableau de bord",
    de: "Dashboard",
    hu: "Irányítópult",
    pt: "Painel",
  },
  team: {
    it: "Team",
    en: "Team",
    es: "Equipo",
    fr: "Équipe",
    de: "Team",
    hu: "Csapat",
    pt: "Equipe",
  },
  scorer: {
    it: "Scorer",
    en: "Scorer",
    es: "Evaluador",
    fr: "Évaluateur",
    de: "Bewerter",
    hu: "Pontozó",
    pt: "Avaliador",
  },
  scorerSubtitle: {
    it: "Score per agente · {total} totali · avg globale {avg}",
    en: "Score per agent · {total} total · global avg {avg}",
    es: "Score por agente · {total} totales · media global {avg}",
    fr: "Score par agent · {total} au total · moyenne globale {avg}",
    de: "Score pro Agent · {total} insgesamt · globaler Durchschnitt {avg}",
    hu: "Score ügynökönként · {total} összesen · globális átlag {avg}",
    pt: "Score por agente · {total} no total · média global {avg}",
  },
  scoredPositions: {
    it: "Posizioni scored",
    en: "Scored positions",
    es: "Posiciones scored",
    fr: "Postes scored",
    de: "Bewertete Positionen",
    hu: "Pontozott pozíciók",
    pt: "Vagas scored",
  },
  avgScore: {
    it: "Score medio",
    en: "Average score",
    es: "Score medio",
    fr: "Score moyen",
    de: "Durchschnittsscore",
    hu: "Átlagos score",
    pt: "Score médio",
  },
  highTier: {
    it: "Alta (≥70)",
    en: "High (≥70)",
    es: "Alta (≥70)",
    fr: "Haute (≥70)",
    de: "Hoch (≥70)",
    hu: "Magas (≥70)",
    pt: "Alta (≥70)",
  },
  lowTier: {
    it: "Bassa (<40)",
    en: "Low (<40)",
    es: "Baja (<40)",
    fr: "Basse (<40)",
    de: "Niedrig (<40)",
    hu: "Alacsony (<40)",
    pt: "Baixa (<40)",
  },
  activityPerScorer: {
    it: "Attività per Scorer",
    en: "Activity per Scorer",
    es: "Actividad por Evaluador",
    fr: "Activité par Évaluateur",
    de: "Aktivität pro Bewerter",
    hu: "Tevékenység Pontozónként",
    pt: "Atividade por Avaliador",
  },
  noActivity: {
    it: "Nessuna attività registrata.",
    en: "No activity recorded.",
    es: "Ninguna actividad registrada.",
    fr: "Aucune activité enregistrée.",
    de: "Keine Aktivität erfasst.",
    hu: "Nincs rögzített tevékenység.",
    pt: "Nenhuma atividade registrada.",
  },
  highLabel: {
    it: "Alta ≥70",
    en: "High ≥70",
    es: "Alta ≥70",
    fr: "Haute ≥70",
    de: "Hoch ≥70",
    hu: "Magas ≥70",
    pt: "Alta ≥70",
  },
  midLabel: {
    it: "Media 40-69",
    en: "Mid 40-69",
    es: "Media 40-69",
    fr: "Moyenne 40-69",
    de: "Mittel 40-69",
    hu: "Közepes 40-69",
    pt: "Média 40-69",
  },
  lowLabel: {
    it: "Bassa <40",
    en: "Low <40",
    es: "Baja <40",
    fr: "Basse <40",
    de: "Niedrig <40",
    hu: "Alacsony <40",
    pt: "Baixa <40",
  },
} satisfies Dictionary;
