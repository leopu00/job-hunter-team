// Dizionario della fascia di aggiornamento ([NO-UPDATE-SIGNAL-TO-THE-USER]).
//
// Il tono è quello di una notizia, non di un allarme: il box funziona, è
// solo indietro. Niente "errore", niente urgenza fabbricata — e nessuna
// promessa che l'aggiornamento parta da sé, perché non parte.
//
// `satisfies Dictionary` fa pretendere al compilatore tutte e sette le
// lingue: una voce a cui ne manca una non compila.
import type { Dictionary } from "@/lib/i18n-dict";

export const UPDATE_BANNER_T = {
  label: {
    it: "Aggiornamento",
    en: "Update",
    hu: "Frissítés",
    es: "Actualización",
    de: "Update",
    fr: "Mise à jour",
    pt: "Atualização",
  },
  // Dice entrambi i numeri: senza quello installato, "c'è la {latest}" non
  // fa capire quanto si è rimasti indietro.
  text: {
    it: "È disponibile la versione {latest}: il tuo box è sulla {current}. L'aggiornamento si lancia dal computer o dalla VPS che ospita il team.",
    en: "Version {latest} is out: your box runs {current}. The update is started from the computer or VPS that hosts the team.",
    hu: "Megjelent a {latest} verzió: a boxod a(z) {current} verzión fut. A frissítést arról a gépről vagy VPS-ről kell indítani, amelyik a csapatot futtatja.",
    es: "Está disponible la versión {latest}: tu box está en la {current}. La actualización se lanza desde el ordenador o el VPS que aloja el equipo.",
    de: "Version {latest} ist da: Deine Box läuft auf {current}. Das Update wird vom Rechner oder VPS gestartet, der das Team beherbergt.",
    fr: "La version {latest} est disponible : votre box est en {current}. La mise à jour se lance depuis l'ordinateur ou le VPS qui héberge l'équipe.",
    pt: "A versão {latest} está disponível: o teu box está na {current}. A atualização é iniciada a partir do computador ou VPS que aloja a equipa.",
  },
  how: {
    it: "Come si aggiorna",
    en: "How to update",
    hu: "Hogyan frissíts",
    es: "Cómo actualizar",
    de: "So wird aktualisiert",
    fr: "Comment mettre à jour",
    pt: "Como atualizar",
  },
  dismiss: {
    it: "Non ora",
    en: "Not now",
    hu: "Most nem",
    es: "Ahora no",
    de: "Nicht jetzt",
    fr: "Pas maintenant",
    pt: "Agora não",
  },
} satisfies Dictionary;
