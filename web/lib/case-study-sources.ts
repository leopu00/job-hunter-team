// Colori + etichette delle FONTI (provider) dei case-studies, condivisi tra
// SourcesTimeChart (barre) e SourcesScoreChart (barre + linee score): così la
// mappa colori non diverge tra i due grafici.

// Tinte mid-tone leggibili sia su dark sia su light. LinkedIn blu e Greenhouse
// verde richiamano i brand; le altre sono distinte.
export const SOURCE_COLORS: Record<string, string> = {
  linkedin: "#0A66C2",
  "linkedin-public": "#4F9BE8",
  greenhouse: "#22A06B",
  workday: "#F59E0B",
  ashby: "#8B5CF6",
  "company-careers": "#0EA5A4",
  "official-careers-direct": "#EC4899",
  "bnpparibas-careers": "#15803D",
  lever: "#EF4444",
  smartrecruiters: "#3B82F6",
  efinancialcareers: "#14B8A6",
  recruitee: "#A855F7",
  bebee: "#F97316",
  indeed: "#6366F1",
  glassdoor: "#10B981",
  wellfound: "#06B6D4",
};
// Fallback per fonti senza colore dedicato (assegnato per indice).
export const FALLBACK_COLORS = [
  "#0EA5E9",
  "#F472B6",
  "#84CC16",
  "#FB923C",
  "#A78BFA",
  "#2DD4BF",
  "#F87171",
  "#FBBF24",
  "#C084FC",
];
export const ALTRE_COLOR = "var(--color-dim)";

// Etichette "belle" per i brand (i nomi grezzi sono lowercase normalizzati).
const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  "linkedin-public": "LinkedIn (public)",
  "bnpparibas-careers": "BNP Paribas",
  greenhouse: "Greenhouse",
  workday: "Workday",
  ashby: "Ashby",
  lever: "Lever",
  smartrecruiters: "SmartRecruiters",
  efinancialcareers: "eFinancialCareers",
  recruitee: "Recruitee",
  bebee: "beBee",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  wellfound: "Wellfound",
};

export function colorForSource(key: string, i: number): string {
  if (key === "Altre") return ALTRE_COLOR;
  return SOURCE_COLORS[key] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

function prettify(key: string) {
  const s = key.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Etichetta localizzata: i nomi generici (Altre/career pages) vengono dal
// dizionario `generic` del componente; i brand dalla mappa; il resto prettify.
export function labelForSource(
  key: string,
  generic: { other: string; companyCareers: string; officialCareers: string },
): string {
  if (key === "Altre") return generic.other;
  if (key === "company-careers") return generic.companyCareers;
  if (key === "official-careers-direct") return generic.officialCareers;
  return SOURCE_LABELS[key] ?? prettify(key);
}

// "Altre" sempre per ultima (in fondo allo stack e alla legenda).
export function orderSourceKeys(keys: string[]): string[] {
  return [
    ...keys.filter((k) => k !== "Altre"),
    ...keys.filter((k) => k === "Altre"),
  ];
}
