// Quale stipendio mostrare quando una posizione ne ha DUE.
//
// O-32: vince il DICHIARATO. È un fatto scritto nell'annuncio; la stima è
// un'ipotesi del team e vale solo dove il dichiarato manca. La lista mostrava
// la stima anche quando il dichiarato c'era, e sbagliava di tre volte
// (35-60k su un annuncio che ne dichiara 12-24k): l'utente sceglie a quali
// offerte candidarsi guardando quel numero, e un numero sembra un fatto —
// nessuno va a controllare l'annuncio.
//
// La regola non nasce qui: `shared/skills/generate_dashboard.py` la applica
// da sempre (`has_declared` prima di `has_estimated`). Era il web a non
// distinguerli. Vive in un file suo perché serve a QUATTRO punti — lista e
// dashboard, ramo cloud e ramo locale — e una regola copiata quattro volte
// è una regola che fra un mese ne dice due cose diverse.
//
// `min`, `max` e `currency` vengono SEMPRE dalla stessa fonte: mescolarli
// significherebbe mostrare un minimo in una valuta e un massimo in un'altra.

export type SalarySourceRow = {
  salary_declared_min?: number | null;
  salary_declared_max?: number | null;
  salary_declared_currency?: string | null;
  salary_estimated_min?: number | null;
  salary_estimated_max?: number | null;
  salary_estimated_currency?: string | null;
};

export type SalaryPick = {
  min: number | null;
  max: number | null;
  currency: string;
  /** true = il numero mostrato è quello dichiarato nell'annuncio. */
  declared: boolean;
};

export function salaryPreference(row: SalarySourceRow): SalaryPick {
  const declared =
    row.salary_declared_min != null || row.salary_declared_max != null;
  const min =
    (declared ? row.salary_declared_min : row.salary_estimated_min) ?? null;
  const max =
    (declared ? row.salary_declared_max : row.salary_estimated_max) ?? null;
  const currency =
    (declared ? row.salary_declared_currency : row.salary_estimated_currency) ??
    "EUR";
  return { min, max, currency, declared };
}
