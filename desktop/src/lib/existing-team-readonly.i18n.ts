import type { Locale } from "@/i18n/config";

export interface ExistingTeamReadOnlyText {
  /** Why a control that would write is disabled, the assistant being off. */
  assistantOff: string;
  /** Same, the assistant being on: this connection never lets the app write. */
  connectionReadOnly: string;
  banner: string;
  back: string;
  navAria: string;
  /** The list is sorted by the insertion date: the team's last action is not read. */
  sortLastAction: string;
}

export const EXISTING_TEAM_READONLY_TEXT: Record<Locale, ExistingTeamReadOnlyText> = {
  it: {
    assistantOff: "Solo lettura: assistente non attivo",
    connectionReadOnly: "Solo lettura: questa connessione non consente modifiche",
    banner: "Stai consultando gli annunci della squadra esistente. Le azioni che modificano restano disabilitate.",
    back: "Torna alla configurazione",
    navAria: "Navigazione in sola lettura",
    sortLastAction: "L’ordinamento per ultima azione non è disponibile in sola lettura: gli annunci sono ordinati per data di inserimento.",
  },
  en: {
    assistantOff: "Read only: assistant not active",
    connectionReadOnly: "Read only: this connection does not allow changes",
    banner: "You are browsing the existing team's positions. Actions that change anything stay disabled.",
    back: "Back to setup",
    navAria: "Read-only navigation",
    sortLastAction: "Sorting by last action is not available read only: the positions are sorted by the date they were found.",
  },
  de: {
    assistantOff: "Nur Lesen: Assistent nicht aktiv",
    connectionReadOnly: "Nur Lesen: Diese Verbindung erlaubt keine Änderungen",
    banner: "Du siehst die Stellen des vorhandenen Teams. Aktionen, die etwas ändern, bleiben deaktiviert.",
    back: "Zurück zur Einrichtung",
    navAria: "Navigation im Lesemodus",
    sortLastAction: "Die Sortierung nach letzter Aktion ist im Lesemodus nicht verfügbar: Die Stellen sind nach Funddatum sortiert.",
  },
  fr: {
    assistantOff: "Lecture seule : assistant inactif",
    connectionReadOnly: "Lecture seule : cette connexion n’autorise aucune modification",
    banner: "Vous consultez les offres de l’équipe existante. Les actions qui modifient quoi que ce soit restent désactivées.",
    back: "Retour à la configuration",
    navAria: "Navigation en lecture seule",
    sortLastAction: "Le tri par dernière action n’est pas disponible en lecture seule : les offres sont triées par date de découverte.",
  },
  es: {
    assistantOff: "Solo lectura: asistente no activo",
    connectionReadOnly: "Solo lectura: esta conexión no permite cambios",
    banner: "Estás consultando las ofertas del equipo existente. Las acciones que modifican algo siguen desactivadas.",
    back: "Volver a la configuración",
    navAria: "Navegación de solo lectura",
    sortLastAction: "La ordenación por última acción no está disponible en solo lectura: las ofertas se ordenan por fecha de hallazgo.",
  },
  pt: {
    assistantOff: "Só leitura: assistente não ativo",
    connectionReadOnly: "Só leitura: esta ligação não permite alterações",
    banner: "Está a consultar as vagas da equipa existente. As ações que alteram algo continuam desativadas.",
    back: "Voltar à configuração",
    navAria: "Navegação só de leitura",
    sortLastAction: "A ordenação por última ação não está disponível só em leitura: as vagas estão ordenadas pela data em que foram encontradas.",
  },
  hu: {
    assistantOff: "Csak olvasható: az asszisztens nem aktív",
    connectionReadOnly: "Csak olvasható: ez a kapcsolat nem engedi a módosítást",
    banner: "A meglévő csapat pozícióit nézi. A módosító műveletek le vannak tiltva.",
    back: "Vissza a beállításhoz",
    navAria: "Csak olvasható navigáció",
    sortLastAction: "Az utolsó művelet szerinti rendezés csak olvasható módban nem érhető el: a pozíciók a megtalálás dátuma szerint vannak rendezve.",
  },
};
