// Dizionario di `DashboardLinkedCharts.tsx`.
//
// Le chiavi sono LOCALI a questo file: lo stesso nome può valere
// tutt'altro altrove (`empty` è "nessun backup" in una pagina e
// "nessun canale" in un'altra), quindi non vanno accorpate in un
// dizionario comune. `satisfies Dictionary` fa pretendere al
// compilatore tutte e sette le lingue: una voce a cui ne manca una
// non compila, invece di mostrare l'inglese all'utente sbagliato.
import type { Dictionary } from "@/lib/i18n-dict";

export const T = {
  no_country: {
    it: "Senza paese",
    en: "No country",
    hu: "Nincs ország",
    es: "Sin país",
    de: "Ohne Land",
    fr: "Sans pays",
    pt: "Sem país",
  },
  no_city: {
    it: "Senza città",
    en: "No city",
    hu: "Nincs város",
    es: "Sin ciudad",
    de: "Ohne Stadt",
    fr: "Sans ville",
    pt: "Sem cidade",
  },
  // Spicchio che raccoglie i tipi sotto soglia: "{n}" = quanti ne contiene.
  other_types: {
    it: "Altre ({n} tipi)",
    en: "Other ({n} types)",
    hu: "Egyéb ({n} típus)",
    es: "Otras ({n} tipos)",
    de: "Andere ({n} Typen)",
    fr: "Autres ({n} types)",
    pt: "Outras ({n} tipos)",
  },
  reset_all: {
    it: "Rimuovi tutti i filtri",
    en: "Clear all filters",
    hu: "Összes szűrő törlése",
    es: "Quitar todos los filtros",
    de: "Alle Filter entfernen",
    fr: "Supprimer tous les filtres",
    pt: "Remover todos os filtros",
  },
  filters_label: {
    it: "Filtri",
    en: "Filters",
    hu: "Szűrők",
    es: "Filtros",
    de: "Filter",
    fr: "Filtres",
    pt: "Filtros",
  },
  score_prefix: {
    it: "Score",
    en: "Score",
    hu: "Score",
    es: "Score",
    de: "Score",
    fr: "Score",
    pt: "Score",
  },
} satisfies Dictionary;
