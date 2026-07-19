import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getPositionById } from "@/lib/queries";
import type { PositionHighlight } from "@/lib/types";
import { parseAnalysisNotes, tagColor } from "@/lib/parse-analysis";
import { MarkdownLite } from "@/lib/markdown-lite";
import { locales, defaultLocale, type Locale } from "@/i18n/config";
import { WriteRequestButton } from "./WriteRequestButton";
import { ExcludeButton } from "./ExcludeButton";
import { RecheckButton } from "./RecheckButton";
import { TicketPanel } from "./TicketPanel";
import { GeocodeRequestButton } from "./GeocodeRequestButton";
import { TeamActionsSheet } from "./TeamActionsSheet";
import { CvDownloadButton } from "./CvDownloadButton";
import MarkSeenAfterView from "@/app/components/MarkSeenAfterView";
import { Avatar } from "@/app/components/Avatar";
import { isLocalRequest } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/workspace";

/* ── i18n inline ─────────────────────────────────────────────────── */

const T: Record<string, Record<string, string>> = {
  bc_dashboard: {
    it: "Dashboard",
    en: "Dashboard",
    hu: "Irányítópult",
    es: "Panel",
    de: "Dashboard",
    fr: "Tableau de bord",
    pt: "Painel",
  },
  bc_positions: {
    it: "Posizioni",
    en: "Positions",
    hu: "Pozíciók",
    es: "Posiciones",
    de: "Stellen",
    fr: "Postes",
    pt: "Vagas",
  },
  original_listing: {
    it: "Annuncio originale",
    en: "Original listing",
    hu: "Eredeti hirdetés",
    es: "Anuncio original",
    de: "Originalanzeige",
    fr: "Annonce originale",
    pt: "Anúncio original",
  },
  cv_in_progress: {
    it: "CV gia' in lavorazione o consegnato",
    en: "CV already in progress or delivered",
    hu: "Az önéletrajz már folyamatban van vagy elkészült",
    es: "CV ya en proceso o entregado",
    de: "Lebenslauf bereits in Bearbeitung oder geliefert",
    fr: "CV déjà en cours ou livré",
    pt: "CV já em andamento ou entregue",
  },
  cv_only_from_scored: {
    it: "Posizione in stato '{status}': la richiesta CV e' ammessa solo da 'scored'",
    en: "Position in status '{status}': CV request is only allowed from 'scored'",
    hu: "A pozíció '{status}' állapotban van: önéletrajz csak 'scored' állapotból kérhető",
    es: "Posición en estado '{status}': la solicitud de CV solo se permite desde 'scored'",
    de: "Stelle im Status '{status}': Lebenslauf-Anfrage ist nur ab 'scored' erlaubt",
    fr: "Poste au statut '{status}' : la demande de CV n'est autorisée qu'à partir de 'scored'",
    pt: "Vaga no estado '{status}': o pedido de CV só é permitido a partir de 'scored'",
  },
  pro: {
    it: "Pro",
    en: "Pros",
    hu: "Előnyök",
    es: "Pros",
    de: "Vorteile",
    fr: "Avantages",
    pt: "Prós",
  },
  con: {
    it: "Contro",
    en: "Cons",
    hu: "Hátrányok",
    es: "Contras",
    de: "Nachteile",
    fr: "Inconvénients",
    pt: "Contras",
  },
  score_breakdown: {
    it: "Dettaglio punteggio",
    en: "Score breakdown",
    hu: "Pontszám részletei",
    es: "Desglose de puntuación",
    de: "Punkteaufschlüsselung",
    fr: "Détail du score",
    pt: "Detalhe da pontuação",
  },
  sb_stack_match: {
    it: "Competenze",
    en: "Stack match",
    hu: "Stack egyezés",
    es: "Coincidencia de stack",
    de: "Stack-Übereinstimmung",
    fr: "Correspondance stack",
    pt: "Correspondência de stack",
  },
  sb_remote_fit: {
    it: "Da remoto",
    en: "Remote fit",
    hu: "Távmunka illeszkedés",
    es: "Ajuste remoto",
    de: "Remote-Eignung",
    fr: "Adéquation à distance",
    pt: "Ajuste remoto",
  },
  sb_salary_fit: {
    it: "Stipendio",
    en: "Salary fit",
    hu: "Fizetés illeszkedés",
    es: "Ajuste salarial",
    de: "Gehaltseignung",
    fr: "Adéquation salariale",
    pt: "Ajuste salarial",
  },
  sb_experience_fit: {
    it: "Esperienza",
    en: "Experience fit",
    hu: "Tapasztalat illeszkedés",
    es: "Ajuste de experiencia",
    de: "Erfahrungseignung",
    fr: "Adéquation d'expérience",
    pt: "Ajuste de experiência",
  },
  sb_strategic_fit: {
    it: "Strategia",
    en: "Strategic fit",
    hu: "Stratégiai illeszkedés",
    es: "Ajuste estratégico",
    de: "Strategische Eignung",
    fr: "Adéquation stratégique",
    pt: "Ajuste estratégico",
  },
  application: {
    it: "Candidatura",
    en: "Application",
    hu: "Jelentkezés",
    es: "Candidatura",
    de: "Bewerbung",
    fr: "Candidature",
    pt: "Candidatura",
  },
  a_status: {
    it: "Stato",
    en: "Status",
    hu: "Állapot",
    es: "Estado",
    de: "Status",
    fr: "Statut",
    pt: "Estado",
  },
  a_critic: {
    it: "Critico",
    en: "Critic",
    hu: "Kritikus",
    es: "Crítico",
    de: "Kritiker",
    fr: "Critique",
    pt: "Crítico",
  },
  a_written: {
    it: "Scritta",
    en: "Written",
    hu: "Megírva",
    es: "Redactada",
    de: "Verfasst",
    fr: "Rédigée",
    pt: "Redigida",
  },
  a_sent: {
    it: "Inviata",
    en: "Sent",
    hu: "Elküldve",
    es: "Enviada",
    de: "Gesendet",
    fr: "Envoyée",
    pt: "Enviada",
  },
  a_via: {
    it: "Via",
    en: "Via",
    hu: "Csatorna",
    es: "Vía",
    de: "Über",
    fr: "Via",
    pt: "Via",
  },
  a_interview_round: {
    it: "Round colloquio",
    en: "Interview round",
    hu: "Interjúforduló",
    es: "Ronda de entrevista",
    de: "Interviewrunde",
    fr: "Tour d'entretien",
    pt: "Ronda de entrevista",
  },
  a_score: {
    it: "Voto",
    en: "Score",
    hu: "Pontszám",
    es: "Puntuación",
    de: "Bewertung",
    fr: "Note",
    pt: "Pontuação",
  },
  a_critic_feedback: {
    it: "Feedback del Critico",
    en: "Critic feedback",
    hu: "Kritikus visszajelzése",
    es: "Comentarios del Crítico",
    de: "Kritiker-Feedback",
    fr: "Retour du Critique",
    pt: "Feedback do Crítico",
  },
  as_draft: {
    it: "Bozza",
    en: "Draft",
    hu: "Piszkozat",
    es: "Borrador",
    de: "Entwurf",
    fr: "Brouillon",
    pt: "Rascunho",
  },
  as_review: {
    it: "In revisione",
    en: "In review",
    hu: "Ellenőrzés alatt",
    es: "En revisión",
    de: "In Prüfung",
    fr: "En révision",
    pt: "Em revisão",
  },
  as_ready: {
    it: "CV pronto",
    en: "CV ready",
    hu: "Önéletrajz kész",
    es: "CV listo",
    de: "Lebenslauf bereit",
    fr: "CV prêt",
    pt: "CV pronto",
  },
  as_approved: {
    it: "Approvata",
    en: "Approved",
    hu: "Jóváhagyva",
    es: "Aprobada",
    de: "Genehmigt",
    fr: "Approuvée",
    pt: "Aprovada",
  },
  as_applied: {
    it: "Inviata",
    en: "Applied",
    hu: "Elküldve",
    es: "Enviada",
    de: "Beworben",
    fr: "Envoyée",
    pt: "Enviada",
  },
  as_response: {
    it: "Risposta",
    en: "Response",
    hu: "Válasz",
    es: "Respuesta",
    de: "Antwort",
    fr: "Réponse",
    pt: "Resposta",
  },
  cv_drive: {
    it: "CV (Drive)",
    en: "CV (Drive)",
    hu: "Önéletrajz (Drive)",
    es: "CV (Drive)",
    de: "Lebenslauf (Drive)",
    fr: "CV (Drive)",
    pt: "CV (Drive)",
  },
  cover_letter_drive: {
    it: "Cover Letter (Drive)",
    en: "Cover Letter (Drive)",
    hu: "Motivációs levél (Drive)",
    es: "Carta de presentación (Drive)",
    de: "Anschreiben (Drive)",
    fr: "Lettre de motivation (Drive)",
    pt: "Carta de apresentação (Drive)",
  },
  download_cv: {
    it: "Scarica CV (PDF)",
    en: "Download CV (PDF)",
    hu: "Önéletrajz letöltése (PDF)",
    es: "Descargar CV (PDF)",
    de: "Lebenslauf herunterladen (PDF)",
    fr: "Télécharger le CV (PDF)",
    pt: "Baixar CV (PDF)",
  },
  download_cl: {
    it: "Scarica Cover Letter (PDF)",
    en: "Download Cover Letter (PDF)",
    hu: "Motivációs levél letöltése (PDF)",
    es: "Descargar carta de presentación (PDF)",
    de: "Anschreiben herunterladen (PDF)",
    fr: "Télécharger la lettre de motivation (PDF)",
    pt: "Baixar carta de apresentação (PDF)",
  },
  cv_preparing: {
    it: "Preparazione…",
    en: "Preparing…",
    hu: "Előkészítés…",
    es: "Preparando…",
    de: "Wird vorbereitet…",
    fr: "Préparation…",
    pt: "Preparando…",
  },
  cv_dl_error: {
    it: "Errore — riprova",
    en: "Error — retry",
    hu: "Hiba — újra",
    es: "Error — reintentar",
    de: "Fehler — erneut",
    fr: "Erreur — réessayer",
    pt: "Erro — repetir",
  },
  cv_bridge_hint: {
    it: "Il PDF arriva dal dispositivo dove gira il team tramite un ponte temporaneo: non viene salvato nel cloud.",
    en: "The PDF is fetched from the device running your team through a temporary bridge — it isn't stored in the cloud.",
    hu: "A PDF a csapatot futtató eszközről érkezik egy ideiglenes hídon keresztül — nem tárolódik a felhőben.",
    es: "El PDF se obtiene del dispositivo donde se ejecuta tu equipo mediante un puente temporal: no se guarda en la nube.",
    de: "Das PDF wird über eine temporäre Brücke von dem Gerät geholt, auf dem dein Team läuft — es wird nicht in der Cloud gespeichert.",
    fr: "Le PDF est récupéré depuis l'appareil qui exécute votre équipe via un pont temporaire — il n'est pas stocké dans le cloud.",
    pt: "O PDF é obtido do dispositivo onde a equipa é executada através de uma ponte temporária — não é guardado na nuvem.",
  },
  response_received: {
    it: "Risposta ricevuta",
    en: "Response received",
    hu: "Beérkezett válasz",
    es: "Respuesta recibida",
    de: "Antwort erhalten",
    fr: "Réponse reçue",
    pt: "Resposta recebida",
  },
  job_description: {
    it: "Job Description",
    en: "Job Description",
    hu: "Munkaköri leírás",
    es: "Descripción del puesto",
    de: "Stellenbeschreibung",
    fr: "Description du poste",
    pt: "Descrição da vaga",
  },
  requirements: {
    it: "Requisiti",
    en: "Requirements",
    hu: "Követelmények",
    es: "Requisitos",
    de: "Anforderungen",
    fr: "Exigences",
    pt: "Requisitos",
  },
  full_description: {
    it: "Descrizione completa",
    en: "Full description",
    hu: "Teljes leírás",
    es: "Descripción completa",
    de: "Vollständige Beschreibung",
    fr: "Description complète",
    pt: "Descrição completa",
  },
  details: {
    it: "Dettagli",
    en: "Details",
    hu: "Részletek",
    es: "Detalles",
    de: "Details",
    fr: "Détails",
    pt: "Detalhes",
  },
  d_source: {
    it: "Fonte",
    en: "Source",
    hu: "Forrás",
    es: "Fuente",
    de: "Quelle",
    fr: "Source",
    pt: "Fonte",
  },
  d_found: {
    it: "Trovata",
    en: "Found",
    hu: "Megtalálva",
    es: "Encontrada",
    de: "Gefunden",
    fr: "Trouvée",
    pt: "Encontrada",
  },
  d_deadline: {
    it: "Scadenza",
    en: "Deadline",
    hu: "Határidő",
    es: "Fecha límite",
    de: "Frist",
    fr: "Échéance",
    pt: "Prazo",
  },
  d_found_by: {
    it: "Trovata da",
    en: "Found by",
    hu: "Megtalálta",
    es: "Encontrada por",
    de: "Gefunden von",
    fr: "Trouvée par",
    pt: "Encontrada por",
  },
  d_salary_declared: {
    it: "Stipendio dichiarato",
    en: "Declared salary",
    hu: "Megadott fizetés",
    es: "Salario declarado",
    de: "Angegebenes Gehalt",
    fr: "Salaire déclaré",
    pt: "Salário declarado",
  },
  d_salary_estimated: {
    it: "Stipendio stimato",
    en: "Estimated salary",
    hu: "Becsült fizetés",
    es: "Salario estimado",
    de: "Geschätztes Gehalt",
    fr: "Salaire estimé",
    pt: "Salário estimado",
  },
  view_original_offer: {
    it: "Vedi offerta originale",
    en: "View original offer",
    hu: "Eredeti ajánlat megtekintése",
    es: "Ver oferta original",
    de: "Originalangebot ansehen",
    fr: "Voir l'offre originale",
    pt: "Ver oferta original",
  },
  company: {
    it: "Azienda",
    en: "Company",
    hu: "Vállalat",
    es: "Empresa",
    de: "Unternehmen",
    fr: "Entreprise",
    pt: "Empresa",
  },
  c_hq: {
    it: "HQ",
    en: "HQ",
    hu: "Központ",
    es: "Sede",
    de: "Hauptsitz",
    fr: "Siège",
    pt: "Sede",
  },
  c_sector: {
    it: "Settore",
    en: "Sector",
    hu: "Ágazat",
    es: "Sector",
    de: "Branche",
    fr: "Secteur",
    pt: "Setor",
  },
  c_size: {
    it: "Dimensione",
    en: "Size",
    hu: "Méret",
    es: "Tamaño",
    de: "Größe",
    fr: "Taille",
    pt: "Dimensão",
  },
  company_website: {
    it: "Sito aziendale",
    en: "Company website",
    hu: "Vállalati weboldal",
    es: "Sitio web de la empresa",
    de: "Unternehmenswebsite",
    fr: "Site de l'entreprise",
    pt: "Site da empresa",
  },
  notes: {
    it: "Note",
    en: "Notes",
    hu: "Megjegyzések",
    es: "Notas",
    de: "Notizen",
    fr: "Notes",
    pt: "Notas",
  },
  team_analysis: {
    it: "Analisi del team",
    en: "Team analysis",
    hu: "Csapat elemzése",
    es: "Análisis del equipo",
    de: "Team-Analyse",
    fr: "Analyse de l'équipe",
    pt: "Análise da equipa",
  },
  an_requirements: {
    it: "Requisiti chiave",
    en: "Key requirements",
    hu: "Fő követelmények",
    es: "Requisitos clave",
    de: "Kernanforderungen",
    fr: "Exigences clés",
    pt: "Requisitos-chave",
  },
  an_mismatches: {
    it: "Disallineamenti",
    en: "Mismatches",
    hu: "Eltérések",
    es: "Desajustes",
    de: "Abweichungen",
    fr: "Écarts",
    pt: "Desalinhamentos",
  },
  an_excluded: {
    it: "Motivo esclusione",
    en: "Exclusion reason",
    hu: "Kizárás oka",
    es: "Motivo de exclusión",
    de: "Ausschlussgrund",
    fr: "Motif d'exclusion",
    pt: "Motivo de exclusão",
  },
  an_notes: {
    it: "Note del team",
    en: "Team notes",
    hu: "Csapat jegyzetei",
    es: "Notas del equipo",
    de: "Team-Notizen",
    fr: "Notes de l'équipe",
    pt: "Notas da equipa",
  },
  meta_seniority_jd: {
    it: "Seniority",
    en: "Seniority",
    hu: "Szint",
    es: "Seniority",
    de: "Seniorität",
    fr: "Séniorité",
    pt: "Senioridade",
  },
  meta_experience_required: {
    it: "Esperienza richiesta",
    en: "Experience required",
    hu: "Szükséges tapasztalat",
    es: "Experiencia requerida",
    de: "Erforderliche Erfahrung",
    fr: "Expérience requise",
    pt: "Experiência exigida",
  },
  meta_experience_type: {
    it: "Tipo esperienza",
    en: "Experience type",
    hu: "Tapasztalat típusa",
    es: "Tipo de experiencia",
    de: "Erfahrungstyp",
    fr: "Type d'expérience",
    pt: "Tipo de experiência",
  },
  meta_degree: {
    it: "Laurea",
    en: "Degree",
    hu: "Diploma",
    es: "Titulación",
    de: "Abschluss",
    fr: "Diplôme",
    pt: "Diploma",
  },
  meta_language_required: {
    it: "Lingua",
    en: "Language",
    hu: "Nyelv",
    es: "Idioma",
    de: "Sprache",
    fr: "Langue",
    pt: "Idioma",
  },
};

// Normalizzazione dei valori a vocabolario chiuso che l'Analista scrive in
// inglese (es. "not specified", "mandatory"): per le altre stringhe aperte
// (anni, nomi lingua, livelli seniority) si rende il valore grezzo.
const VAL: Record<string, Record<string, string>> = {
  "not specified": {
    it: "non specificato",
    en: "not specified",
    hu: "nincs megadva",
    es: "no especificado",
    de: "nicht angegeben",
    fr: "non spécifié",
    pt: "não especificado",
  },
  "not required": {
    it: "non richiesta",
    en: "not required",
    hu: "nem szükséges",
    es: "no requerida",
    de: "nicht erforderlich",
    fr: "non requise",
    pt: "não exigida",
  },
  "not mentioned": {
    it: "non indicato",
    en: "not mentioned",
    hu: "nincs említve",
    es: "no mencionado",
    de: "nicht erwähnt",
    fr: "non mentionné",
    pt: "não mencionado",
  },
  mandatory: {
    it: "obbligatoria",
    en: "mandatory",
    hu: "kötelező",
    es: "obligatoria",
    de: "obligatorisch",
    fr: "obligatoire",
    pt: "obrigatória",
  },
  required: {
    it: "richiesta",
    en: "required",
    hu: "szükséges",
    es: "requerida",
    de: "erforderlich",
    fr: "requise",
    pt: "exigida",
  },
  preferred: {
    it: "preferita",
    en: "preferred",
    hu: "előnyben",
    es: "preferida",
    de: "bevorzugt",
    fr: "souhaitée",
    pt: "preferida",
  },
};

// Colori dello stato della CANDIDATURA (applications.status), distinto dallo
// stato della posizione. 'ready' = CV finito e approvato dal Critico.
const APP_STATUS_COLORS: Record<string, string> = {
  draft: "var(--color-yellow)",
  review: "var(--color-orange)",
  ready: "var(--color-ready)",
  approved: "var(--color-green)",
  applied: "var(--color-green)",
  response: "#58a6ff",
};

const VERDICT_COLORS: Record<string, string> = {
  PASS: "var(--color-green)",
  NEEDS_WORK: "var(--color-yellow)",
  REJECT: "var(--color-red)",
};

function scoreColor(s: number | null) {
  if (!s) return "var(--color-dim)";
  if (s >= 75) return "var(--color-green)";
  if (s >= 55) return "var(--color-yellow)";
  return "var(--color-red)";
}

// Colore di un sotto-punteggio relativo al SUO massimo (stack /40, remote
// /25, …): un 26/40 (65%) è "buono", non "rosso". Il colore precedente
// usava soglie assolute → tutte le barre apparivano rosse anche con fit ok.
function ratioColor(value: number | null, max: number) {
  if (value == null || max <= 0) return "var(--color-dim)";
  const pct = (value / max) * 100;
  if (pct >= 70) return "var(--color-green)";
  if (pct >= 45) return "var(--color-yellow)";
  return "var(--color-red)";
}

function ScoreBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number | null;
  max: number;
}) {
  const pct = value ? Math.round((value / max) * 100) : 0;
  const color = ratioColor(value, max);
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-[var(--color-dim)] w-28 shrink-0">
        {label}
      </span>
      <div
        className="flex-1 h-1 rounded-full overflow-hidden"
        style={{ background: "var(--color-border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        className="text-[11px] font-semibold w-12 text-right tabular-nums"
        style={{ color }}
      >
        {value ?? "—"}
        <span className="text-[var(--color-dim)] font-normal">/{max}</span>
      </span>
    </div>
  );
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PositionDetailPage({ params }: PageProps) {
  const { id } = await params;

  // Locale corrente dalla fonte unica (cookie NEXT_LOCALE), come next-intl.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale =
    cookieLocale && (locales as string[]).includes(cookieLocale)
      ? (cookieLocale as Locale)
      : defaultLocale;
  const t = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  const data = await getPositionById(id);

  if (!data) notFound();

  const { position, score, highlights, company, application, tickets } = data;
  const pros = highlights.filter((h: PositionHighlight) => h.type === "pro");
  const cons = highlights.filter((h: PositionHighlight) => h.type === "con");

  // Analisi semi-strutturata dell'Analista (campo notes) → metadati,
  // motivo esclusione, disallineamenti, prosa. Vedi lib/parse-analysis.
  const analysis = parseAnalysisNotes(position.notes);
  const vt = (v: string) => {
    const k = v.trim().toLowerCase();
    return VAL[k]?.[locale] ?? VAL[k]?.en ?? v;
  };

  // Modalità di accesso ai file: cloud (web pubblico → bridge on-demand) vs
  // local (desktop → link diretto). Stesso criterio di /api/profile/files.
  const cloudMode = isSupabaseConfigured && !(await isLocalRequest());
  // basename dei PDF: i path nel DB sono assoluti sul container VPS, ma il
  // bridge e il file-serving locale risolvono per basename.
  const cvFileName = application?.cv_pdf_path?.split("/").pop() || null;
  const clFileName = application?.cl_pdf_path?.split("/").pop() || null;

  function formatSalary(
    min: number | null,
    max: number | null,
    currency?: string | null,
  ) {
    if (!min && !max) return null;
    const c = currency ?? "EUR";
    if (min && max)
      return `${c} ${min.toLocaleString()} – ${max.toLocaleString()}`;
    if (min) return `${c} ${min.toLocaleString()}+`;
    return null;
  }

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* Dopo 2s di permanenza la posizione perde il marker "nuova"
          (stato client-side, vedi lib/seen-positions). Si usa position.id
          perché è lo stesso id dei link riga nelle tabelle. */}
      <MarkSeenAfterView id={position.id} />
      {/* ── Breadcrumb ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 text-[10px]">
        <Link
          href="/dashboard"
          className="text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          {t("bc_dashboard")}
        </Link>
        <span className="text-[var(--color-border)]">/</span>
        <Link
          href="/positions"
          className="text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          {t("bc_positions")}
        </Link>
        <span className="text-[var(--color-border)]">/</span>
        <span className="text-[var(--color-muted)]">
          {position.legacy_id
            ? `JHT-${String(position.legacy_id).padStart(3, "0")}`
            : position.id.slice(0, 8)}
        </span>
      </div>

      {/* ── Header ──────────────────────────────────────────────── */}
      {/* Ridisegnato mobile-first (19/07): niente pillola di stato (l'utente
          non ragiona per status interni), score allineato al titolo, e tutte
          le azioni utente→team raccolte in un unico popup (TeamActionsSheet)
          invece del muro di bottoni impilati. */}
      <div className="mb-6 md:mb-8 pb-5 md:pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-start gap-3 md:gap-4">
          {/* Logo aziendale (mig 056, skill logo-extraction): data-URI dal
              record companies; senza logo l'Avatar ripiega sulle iniziali
              colorate del nome azienda. object-contain: mai croppare. */}
          <Avatar
            name={position.company}
            src={company?.logo ?? undefined}
            size="lg"
            square
            imgFit="contain"
            className="mt-1"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-[var(--color-white)] mb-1">
              {position.title}
            </h1>
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="text-[var(--color-base)] font-medium">
                {position.company}
              </span>
              {position.location && (
                <span className="text-[11px] text-[var(--color-muted)]">
                  · {position.location}
                </span>
              )}
              {position.remote_type && (
                <span
                  className="text-[10px]"
                  style={{
                    color:
                      position.remote_type === "full_remote"
                        ? "var(--color-green)"
                        : position.remote_type === "hybrid"
                          ? "var(--color-yellow)"
                          : "var(--color-red)",
                  }}
                >
                  {position.remote_type.replace("_", " ")}
                </span>
              )}
            </div>
          </div>
          {score && (
            <div
              className="w-12 h-12 rounded-full border-2 flex items-center justify-center font-bold text-lg shrink-0 mt-0.5"
              style={{
                borderColor: scoreColor(score.total_score),
                color: scoreColor(score.total_score),
              }}
            >
              {score.total_score}
            </div>
          )}
        </div>
        {position.legacy_id != null && (
          <div className="mt-4 flex items-center gap-3">
            <TeamActionsSheet
              active={
                position.geocode_requested === true ||
                position.recheck_requested === true ||
                position.write_requested === true ||
                !!position.user_excluded_reason ||
                tickets.some((tk) => tk.status !== "resolved")
              }
              actions={
                <>
                  {/* Geocoding-on-demand (V8): l'utente richiede coordinate
                      ufficio precise. Sempre attivo: l'Analista skippa
                      autonomamente quando non ha materiale geografico utile
                      (vedi BACKLOG [Cloud Sync — Geocoding opt-in/out]). */}
                  <GeocodeRequestButton
                    legacyId={position.legacy_id}
                    initialRequested={position.geocode_requested === true}
                    alreadyGeocoded={position.office_geocoded === true}
                  />
                  {/* Recheck ON-DEMAND (mig 042): il recheck non è più
                      automatico, l'utente lo richiede qui → l'Analista
                      ri-verifica la liveness. */}
                  <RecheckButton
                    legacyId={position.legacy_id}
                    initialRequested={position.recheck_requested === true}
                    lastOpenCheck={position.last_open_check}
                  />
                  {(() => {
                    // Writer-on-demand (V6): il button e' visibile solo se la
                    // posizione e' nello stato giusto. Il Capitano spawna lo
                    // Scrittore quando il flag e' acceso (vedi BACKLOG
                    // [JHT-WRITER-ON-DEMAND]).
                    const wrongStatus = position.status !== "scored";
                    const alreadyWriting = application != null;
                    const isDisabled = wrongStatus || alreadyWriting;
                    const reason = alreadyWriting
                      ? t("cv_in_progress")
                      : wrongStatus
                        ? t("cv_only_from_scored").replace(
                            "{status}",
                            position.status,
                          )
                        : undefined;
                    return (
                      <WriteRequestButton
                        legacyId={position.legacy_id}
                        initialRequested={position.write_requested === true}
                        disabled={isDisabled}
                        disabledReason={reason}
                      />
                    );
                  })()}
                  {/* Esclusione manuale utente (mig 041): l'utente esclude
                      l'offerta con una causa → status 'excluded', gli agenti
                      smettono di ri-verificarne la liveness. */}
                  <ExcludeButton
                    legacyId={position.legacy_id}
                    status={position.status}
                    initialReason={position.user_excluded_reason ?? null}
                  />
                </>
              }
              tickets={
                <TicketPanel
                  legacyId={position.legacy_id}
                  tickets={tickets}
                  hideTitle
                />
              }
            />
            {position.url && (
              <a
                href={position.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                style={{
                  borderColor: "var(--color-blue)",
                  color: "var(--color-blue)",
                }}
              >
                {t("original_listing")} ↗
              </a>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column ─────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Job description — sintesi ottimizzata dell'Analista (jd_summary,
              markdown, lingua utente). Prima card: è la cosa che l'utente
              apre la pagina per leggere. Fallback al testo grezzo per le
              posizioni legacy non ancora ri-analizzate. */}
          {(position.jd_summary ||
            position.jd_text ||
            position.requirements) && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-3">{t("job_description")}</div>
              {position.jd_summary ? (
                <>
                  <MarkdownLite
                    text={position.jd_summary}
                    className="text-[12px] text-[var(--color-base)] leading-relaxed"
                  />
                  {position.url && (
                    <a
                      href={position.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                    >
                      {t("original_listing")} ↗
                    </a>
                  )}
                </>
              ) : (
                <>
                  {position.requirements && (
                    <div className="mb-4">
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("requirements")}
                      </div>
                      <pre className="text-[11px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap font-sans">
                        {position.requirements.slice(0, 2000)}
                        {position.requirements.length > 2000 ? "…" : ""}
                      </pre>
                    </div>
                  )}
                  {position.jd_text && (
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("full_description")}
                      </div>
                      <pre className="text-[11px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap font-sans">
                        {position.jd_text.slice(0, 3000)}
                        {position.jd_text.length > 3000 ? "…" : ""}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Pro/Con highlights */}
          {(pros.length > 0 || cons.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {pros.length > 0 && (
                <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
                  <div
                    className="text-[9.5px] font-semibold tracking-[0.14em] uppercase mb-3"
                    style={{ color: "var(--color-green)" }}
                  >
                    {t("pro")}
                  </div>
                  <ul className="space-y-2">
                    {pros.map((h: PositionHighlight) => (
                      <li
                        key={h.id}
                        className="flex gap-2 text-[11px] text-[var(--color-base)] leading-relaxed"
                      >
                        <span
                          style={{ color: "var(--color-green)" }}
                          className="shrink-0 mt-0.5"
                        >
                          +
                        </span>
                        {h.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cons.length > 0 && (
                <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
                  <div
                    className="text-[9.5px] font-semibold tracking-[0.14em] uppercase mb-3"
                    style={{ color: "var(--color-red)" }}
                  >
                    {t("con")}
                  </div>
                  <ul className="space-y-2">
                    {cons.map((h: PositionHighlight) => (
                      <li
                        key={h.id}
                        className="flex gap-2 text-[11px] text-[var(--color-base)] leading-relaxed"
                      >
                        <span
                          style={{ color: "var(--color-red)" }}
                          className="shrink-0 mt-0.5"
                        >
                          −
                        </span>
                        {h.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Score breakdown */}
          {score && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-4">{t("score_breakdown")}</div>
              <div className="space-y-3">
                <ScoreBar
                  label={t("sb_stack_match")}
                  value={score.stack_match}
                  max={40}
                />
                <ScoreBar
                  label={t("sb_remote_fit")}
                  value={score.remote_fit}
                  max={25}
                />
                <ScoreBar
                  label={t("sb_salary_fit")}
                  value={score.salary_fit}
                  max={20}
                />
                <ScoreBar
                  label={t("sb_experience_fit")}
                  value={score.experience_fit}
                  max={10}
                />
                <ScoreBar
                  label={t("sb_strategic_fit")}
                  value={score.strategic_fit}
                  max={15}
                />
              </div>
              {score.notes && (
                <MarkdownLite
                  text={score.notes}
                  className="mt-4 text-[11px] text-[var(--color-muted)] leading-relaxed border-t border-[var(--color-border)] pt-3"
                />
              )}
            </div>
          )}

          {/* Application */}
          {application && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-4">{t("application")}</div>

              {/* Stato candidatura + verdetto + voto del Critico in evidenza */}
              <div className="flex items-center gap-2.5 flex-wrap mb-4">
                {(() => {
                  const c =
                    APP_STATUS_COLORS[application.status] ?? "var(--color-dim)";
                  return (
                    <span
                      className="text-[10px] font-semibold px-3 py-1 rounded-full border"
                      style={{
                        color: c,
                        borderColor: c,
                        background: `${c}18`,
                      }}
                    >
                      {T[`as_${application.status}`]
                        ? t(`as_${application.status}`)
                        : application.status}
                    </span>
                  );
                })()}
                {application.critic_verdict &&
                  (() => {
                    const c =
                      VERDICT_COLORS[application.critic_verdict] ??
                      "var(--color-dim)";
                    return (
                      <span
                        className="text-[10px] font-semibold px-3 py-1 rounded-full border"
                        style={{
                          color: c,
                          borderColor: c,
                          background: `${c}14`,
                        }}
                      >
                        {t("a_critic")}: {application.critic_verdict}
                      </span>
                    );
                  })()}
                {application.critic_score != null && (
                  <span className="text-[11px] text-[var(--color-muted)]">
                    {t("a_score")}:{" "}
                    <span className="font-semibold text-[var(--color-base)] tabular-nums">
                      {application.critic_score}/10
                    </span>
                  </span>
                )}
              </div>

              {/* Date + canale + round colloquio */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <InfoRow
                  label={t("a_written")}
                  value={
                    application.written_at
                      ? application.written_at.slice(0, 10)
                      : "—"
                  }
                />
                <InfoRow
                  label={t("a_sent")}
                  value={
                    application.applied_at
                      ? application.applied_at.slice(0, 10)
                      : "—"
                  }
                />
                {application.applied_via && (
                  <InfoRow label={t("a_via")} value={application.applied_via} />
                )}
                {application.interview_round && (
                  <InfoRow
                    label={t("a_interview_round")}
                    value={`#${application.interview_round}`}
                  />
                )}
              </div>

              {/* Feedback completo del Critico (prima si vedeva solo il verdetto) */}
              {application.critic_notes && (
                <div className="mb-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
                  <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                    {t("a_critic_feedback")}
                  </div>
                  <MarkdownLite
                    text={application.critic_notes}
                    className="text-[11px] text-[var(--color-muted)] leading-relaxed"
                  />
                </div>
              )}

              {/* Download PDF via bridge on-demand + link Drive (legacy) */}
              <div className="flex gap-3 flex-wrap">
                {cvFileName && (
                  <CvDownloadButton
                    fileName={cvFileName}
                    cloudMode={cloudMode}
                    color="var(--color-green)"
                    labels={{
                      idle: t("download_cv"),
                      preparing: t("cv_preparing"),
                      error: t("cv_dl_error"),
                    }}
                  />
                )}
                {clFileName && (
                  <CvDownloadButton
                    fileName={clFileName}
                    cloudMode={cloudMode}
                    color="var(--color-blue)"
                    labels={{
                      idle: t("download_cl"),
                      preparing: t("cv_preparing"),
                      error: t("cv_dl_error"),
                    }}
                  />
                )}
                {application.cv_drive_id && (
                  <a
                    href={`https://drive.google.com/file/d/${application.cv_drive_id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                    style={{
                      borderColor: "var(--color-green)",
                      color: "var(--color-green)",
                    }}
                  >
                    {t("cv_drive")} ↗
                  </a>
                )}
                {application.cl_drive_id && (
                  <a
                    href={`https://drive.google.com/file/d/${application.cl_drive_id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                    style={{
                      borderColor: "var(--color-blue)",
                      color: "var(--color-blue)",
                    }}
                  >
                    {t("cover_letter_drive")} ↗
                  </a>
                )}
              </div>
              {(cvFileName || clFileName) && cloudMode && (
                <p className="mt-2.5 text-[10px] text-[var(--color-dim)] leading-relaxed">
                  {t("cv_bridge_hint")}
                </p>
              )}

              {application.response && (
                <div className="mt-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
                  <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-1">
                    {t("response_received")}
                  </div>
                  <p className="text-[11px] text-[var(--color-base)]">
                    {application.response}
                  </p>
                  {application.response_at && (
                    <span className="text-[10px] text-[var(--color-dim)]">
                      {application.response_at.slice(0, 10)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right column ────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Details */}
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
            <div className="section-label mb-3">{t("details")}</div>
            <div className="space-y-2">
              {position.source && (
                <InfoRow label={t("d_source")} value={position.source} />
              )}
              <InfoRow
                label={t("d_found")}
                value={position.found_at.slice(0, 10)}
              />
              {position.deadline && (
                <InfoRow label={t("d_deadline")} value={position.deadline} />
              )}
              {position.found_by && (
                <InfoRow label={t("d_found_by")} value={position.found_by} />
              )}
              {formatSalary(
                position.salary_declared_min,
                position.salary_declared_max,
                position.salary_declared_currency,
              ) && (
                <InfoRow
                  label={t("d_salary_declared")}
                  value={formatSalary(
                    position.salary_declared_min,
                    position.salary_declared_max,
                    position.salary_declared_currency,
                  )!}
                />
              )}
              {formatSalary(
                position.salary_estimated_min,
                position.salary_estimated_max,
                position.salary_estimated_currency,
              ) && (
                <InfoRow
                  label={t("d_salary_estimated")}
                  value={formatSalary(
                    position.salary_estimated_min,
                    position.salary_estimated_max,
                    position.salary_estimated_currency,
                  )!}
                />
              )}
            </div>
            {position.url && (
              <a
                href={position.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center gap-1 text-[10px] font-semibold text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
              >
                {t("view_original_offer")} ↗
              </a>
            )}
          </div>

          {/* Company */}
          {company && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="section-label">{t("company")}</div>
                {company.logo && (
                  <Avatar
                    name={company.name}
                    src={company.logo}
                    size="sm"
                    square
                    imgFit="contain"
                  />
                )}
              </div>
              <div className="space-y-2">
                {company.verdict && (
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded border"
                      style={{
                        color:
                          company.verdict === "GO"
                            ? "var(--color-green)"
                            : company.verdict === "CAUTIOUS"
                              ? "var(--color-yellow)"
                              : "var(--color-red)",
                        borderColor:
                          company.verdict === "GO"
                            ? "var(--color-green)"
                            : company.verdict === "CAUTIOUS"
                              ? "var(--color-yellow)"
                              : "var(--color-red)",
                      }}
                    >
                      {company.verdict}
                    </span>
                    {company.glassdoor_rating && (
                      <span className="text-[10px] text-[var(--color-muted)]">
                        Glassdoor: {company.glassdoor_rating}/5
                      </span>
                    )}
                  </div>
                )}
                {company.hq && <InfoRow label={t("c_hq")} value={company.hq} />}
                {company.sector && (
                  <InfoRow label={t("c_sector")} value={company.sector} />
                )}
                {company.size && (
                  <InfoRow label={t("c_size")} value={company.size} />
                )}
                {company.culture_notes && (
                  <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mt-2">
                    {company.culture_notes}
                  </p>
                )}
                {company.red_flags && (
                  <p
                    className="text-[11px] leading-relaxed mt-2"
                    style={{ color: "var(--color-red)" }}
                  >
                    <span aria-hidden="true">⚠</span> {company.red_flags}
                  </p>
                )}
              </div>
              {company.website && (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                >
                  {t("company_website")} ↗
                </a>
              )}
            </div>
          )}

          {/* Team analysis — parsing del campo notes (vedi parse-analysis) */}
          {position.notes && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-3">{t("team_analysis")}</div>

              {analysis.raw ? (
                <p className="text-[11px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap">
                  {position.notes}
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Requisiti chiave estratti (seniority, esperienza, …) */}
                  {analysis.meta.length > 0 && (
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("an_requirements")}
                      </div>
                      <div className="space-y-2">
                        {analysis.meta.map((m) => (
                          <InfoRow
                            key={m.key}
                            label={t(`meta_${m.key}`)}
                            value={vt(m.value)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Motivo esclusione (banner rosso) */}
                  {analysis.excluded && (
                    <div
                      className="rounded-lg border p-3"
                      style={{
                        borderColor: "var(--color-red)",
                        background:
                          "color-mix(in srgb, var(--color-red) 9%, transparent)",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
                          style={{
                            color: "var(--color-red)",
                            borderColor: "var(--color-red)",
                          }}
                        >
                          {analysis.excluded.tag || t("an_excluded")}
                        </span>
                        <span className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-red)]">
                          {t("an_excluded")}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--color-base)] leading-relaxed">
                        {analysis.excluded.text}
                      </p>
                    </div>
                  )}

                  {/* Disallineamenti taggati (STACK / GEO / SENIORITY / …) */}
                  {analysis.mismatches.length > 0 && (
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("an_mismatches")}
                      </div>
                      <ul className="space-y-2.5">
                        {analysis.mismatches.map((mm, i) => (
                          <li key={i} className="flex gap-2">
                            {mm.tag && (
                              <span
                                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 h-fit"
                                style={{
                                  color: tagColor(mm.tag),
                                  borderColor: tagColor(mm.tag),
                                }}
                              >
                                {mm.tag}
                              </span>
                            )}
                            <span className="text-[11px] text-[var(--color-muted)] leading-relaxed min-w-0 break-words">
                              {mm.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Prosa libera residua */}
                  {analysis.prose && (
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                        {t("an_notes")}
                      </div>
                      <MarkdownLite
                        text={analysis.prose}
                        className="text-[11px] text-[var(--color-muted)] leading-relaxed"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-[var(--color-dim)] shrink-0">
        {label}
      </span>
      <span className="text-[11px] text-[var(--color-base)] text-right">
        {value}
      </span>
    </div>
  );
}
