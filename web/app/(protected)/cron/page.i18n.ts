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
  err_load: {
    it: "Errore caricamento",
    en: "Loading error",
    hu: "Betöltési hiba",
    es: "Error de carga",
    de: "Ladefehler",
    fr: "Erreur de chargement",
    pt: "Erro de carregamento",
  },
  loading: {
    it: "Caricamento…",
    en: "Loading…",
    hu: "Betöltés…",
    es: "Cargando…",
    de: "Wird geladen…",
    fr: "Chargement…",
    pt: "Carregando…",
  },
  subtitle: {
    it: "{a} attivi · {p} in pausa",
    en: "{a} active · {p} paused",
    hu: "{a} aktív · {p} szüneteltetve",
    es: "{a} activos · {p} en pausa",
    de: "{a} aktiv · {p} pausiert",
    fr: "{a} actifs · {p} en pause",
    pt: "{a} ativos · {p} em pausa",
  },
  cancel: {
    it: "Annulla",
    en: "Cancel",
    hu: "Mégse",
    es: "Cancelar",
    de: "Abbrechen",
    fr: "Annuler",
    pt: "Cancelar",
  },
  new_job: {
    it: "+ Nuovo job",
    en: "+ New job",
    hu: "+ Új feladat",
    es: "+ Nueva tarea",
    de: "+ Neuer Job",
    fr: "+ Nouvelle tâche",
    pt: "+ Nova tarefa",
  },
  new_job_title: {
    it: "Nuovo job",
    en: "New job",
    hu: "Új feladat",
    es: "Nueva tarea",
    de: "Neuer Job",
    fr: "Nouvelle tâche",
    pt: "Nova tarefa",
  },
  active_jobs: {
    it: "Job attivi",
    en: "Active jobs",
    hu: "Aktív feladatok",
    es: "Tareas activas",
    de: "Aktive Jobs",
    fr: "Tâches actives",
    pt: "Tarefas ativas",
  },
  refresh_8s: {
    it: "aggiornamento ogni 8s",
    en: "refresh every 8s",
    hu: "frissítés 8 mp-enként",
    es: "actualización cada 8s",
    de: "Aktualisierung alle 8 Sek.",
    fr: "actualisation toutes les 8s",
    pt: "atualização a cada 8s",
  },
  empty: {
    it: "Nessun job configurato.",
    en: "No jobs configured.",
    hu: "Nincs konfigurált feladat.",
    es: "Ninguna tarea configurada.",
    de: "Keine Jobs konfiguriert.",
    fr: "Aucune tâche configurée.",
    pt: "Nenhuma tarefa configurada.",
  },
  empty_hint: {
    it: 'Usa "+ Nuovo job" per crearne uno.',
    en: 'Use "+ New job" to create one.',
    hu: 'Használd a "+ Új feladat" gombot egy létrehozásához.',
    es: 'Usa "+ Nueva tarea" para crear una.',
    de: 'Nutze "+ Neuer Job", um einen zu erstellen.',
    fr: 'Utilisez "+ Nouvelle tâche" pour en créer une.',
    pt: 'Use "+ Nova tarefa" para criar uma.',
  },
} satisfies Dictionary;
