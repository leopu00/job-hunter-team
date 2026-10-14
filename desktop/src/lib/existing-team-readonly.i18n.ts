import type { Locale } from "@/i18n/config";

export interface ExistingTeamReadOnlyText {
  /** Why a control that would write is disabled, the assistant being off. */
  assistantOff: string;
  /** Same, the assistant being on: this connection never lets the app write. */
  connectionReadOnly: string;
  banner: string;
  positions: string;
  back: string;
  navAria: string;
}

export const EXISTING_TEAM_READONLY_TEXT: Record<Locale, ExistingTeamReadOnlyText> = {
  it: {
    assistantOff: "Solo lettura: assistente non attivo",
    connectionReadOnly: "Solo lettura: questa connessione non consente modifiche",
    banner: "Stai consultando gli annunci della squadra esistente. Le azioni che modificano restano disabilitate.",
    positions: "Posizioni",
    back: "Torna alla configurazione",
    navAria: "Navigazione in sola lettura",
  },
  en: {
    assistantOff: "Read only: assistant not active",
    connectionReadOnly: "Read only: this connection does not allow changes",
    banner: "You are browsing the existing team's positions. Actions that change anything stay disabled.",
    positions: "Positions",
    back: "Back to setup",
    navAria: "Read-only navigation",
  },
  de: {
    assistantOff: "Nur Lesen: Assistent nicht aktiv",
    connectionReadOnly: "Nur Lesen: Diese Verbindung erlaubt keine Änderungen",
    banner: "Du siehst die Stellen des vorhandenen Teams. Aktionen, die etwas ändern, bleiben deaktiviert.",
    positions: "Stellen",
    back: "Zurück zur Einrichtung",
    navAria: "Navigation im Lesemodus",
  },
  fr: {
    assistantOff: "Lecture seule : assistant inactif",
    connectionReadOnly: "Lecture seule : cette connexion n’autorise aucune modification",
    banner: "Vous consultez les offres de l’équipe existante. Les actions qui modifient quoi que ce soit restent désactivées.",
    positions: "Postes",
    back: "Retour à la configuration",
    navAria: "Navigation en lecture seule",
  },
  es: {
    assistantOff: "Solo lectura: asistente no activo",
    connectionReadOnly: "Solo lectura: esta conexión no permite cambios",
    banner: "Estás consultando las ofertas del equipo existente. Las acciones que modifican algo siguen desactivadas.",
    positions: "Puestos",
    back: "Volver a la configuración",
    navAria: "Navegación de solo lectura",
  },
  pt: {
    assistantOff: "Só leitura: assistente não ativo",
    connectionReadOnly: "Só leitura: esta ligação não permite alterações",
    banner: "Está a consultar as vagas da equipa existente. As ações que alteram algo continuam desativadas.",
    positions: "Vagas",
    back: "Voltar à configuração",
    navAria: "Navegação só de leitura",
  },
  hu: {
    assistantOff: "Csak olvasható: az asszisztens nem aktív",
    connectionReadOnly: "Csak olvasható: ez a kapcsolat nem engedi a módosítást",
    banner: "A meglévő csapat pozícióit nézi. A módosító műveletek le vannak tiltva.",
    positions: "Pozíciók",
    back: "Vissza a beállításhoz",
    navAria: "Csak olvasható navigáció",
  },
};
