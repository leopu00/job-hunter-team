import type { Locale } from "@/i18n/config";
export const EXISTING_TEAM_ID_TEXT: Record<Locale, { label: string; hint: string }> = {
  it: { label: "Identificativo della squadra esistente", hint: "Inserisci l’identificativo verificato della squadra sulla VPS. Non è l’ID del profilo locale. Il collegamento verifica la corrispondenza senza creare una squadra." },
  en: { label: "Existing team identifier", hint: "Enter the verified identifier of the team on the VPS. This is not the local profile ID. Connecting checks the match without creating a team." },
  de: { label: "Kennung des vorhandenen Teams", hint: "Gib die bestätigte Teamkennung der VPS ein, nicht die lokale Profil-ID. Die Verbindung prüft die Übereinstimmung, ohne ein Team zu erstellen." },
  fr: { label: "Identifiant de l’équipe existante", hint: "Saisissez l’identifiant vérifié de l’équipe sur le VPS, pas celui du profil local. La connexion vérifie la correspondance sans créer d’équipe." },
  es: { label: "Identificador del equipo existente", hint: "Introduce el identificador verificado del equipo en el VPS, no el del perfil local. La conexión comprueba la coincidencia sin crear un equipo." },
  pt: { label: "Identificador da equipa existente", hint: "Introduza o identificador verificado da equipa no VPS, não o do perfil local. A ligação verifica a correspondência sem criar uma equipa." },
  hu: { label: "A meglévő csapat azonosítója", hint: "Adja meg a VPS csapatának ellenőrzött azonosítóját, ne a helyi profilét. A kapcsolat egyezést ellenőriz, és nem hoz létre csapatot." },
};
