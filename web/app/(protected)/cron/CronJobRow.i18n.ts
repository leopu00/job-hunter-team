// Dizionario di `CronJobRow.tsx`.
//
// Le chiavi sono LOCALI a questo file: lo stesso nome può valere
// tutt'altro altrove (`empty` è "nessun backup" in una pagina e
// "nessun canale" in un'altra), quindi non vanno accorpate in un
// dizionario comune. `satisfies Dictionary` fa pretendere al
// compilatore tutte e sette le lingue: una voce a cui ne manca una
// non compila, invece di mostrare l'inglese all'utente sbagliato.
import type { Dictionary } from "@/lib/i18n-dict";

export const T = {
  pause: {
    it: "pausa",
    en: "pause",
    hu: "szünet",
    es: "pausar",
    de: "Pause",
    fr: "pause",
    pt: "pausar",
  },
  resume: {
    it: "riprendi",
    en: "resume",
    hu: "folytatás",
    es: "reanudar",
    de: "fortsetzen",
    fr: "reprendre",
    pt: "retomar",
  },
  delete: {
    it: "elimina",
    en: "delete",
    hu: "törlés",
    es: "eliminar",
    de: "löschen",
    fr: "supprimer",
    pt: "excluir",
  },
  next: {
    it: "prossima:",
    en: "next:",
    hu: "következő:",
    es: "próxima:",
    de: "nächste:",
    fr: "prochaine :",
    pt: "próxima:",
  },
  last: {
    it: "ultimo:",
    en: "last:",
    hu: "utolsó:",
    es: "último:",
    de: "letzter:",
    fr: "dernier :",
    pt: "último:",
  },
} satisfies Dictionary;
