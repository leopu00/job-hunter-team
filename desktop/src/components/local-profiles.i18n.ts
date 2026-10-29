import type { Locale } from "@/i18n/config";

/**
 * The words of the list of local profiles on this Mac: the list on the sign-in page, the
 * team-owner banner inside the app and the button that switches profile.
 * `{name}` is the profile's name; the caller fills it in.
 */
export type LocalProfilesCopy = {
  /** Title above the list on the sign-in page. One line. */
  listTitle: string;
  /** Accessible name of the list. Not visible. */
  listAria: string;
  /** Button of each row. The name can be long: the row may wrap. */
  useProfile: string;
  /** Small label next to the profile that owns this Mac's team. */
  teamHere: string;
  /** Small label on the profile used last. */
  lastUsed: string;
  /** Secondary button under the list. */
  newProfile: string;
  /** Note in the form of the new profile. One line. */
  newProfileNote: string;
  /** Band inside the app, when the profile in use does not own the team. */
  ownerBanner: string;
  /** The same band when the owner's name is not known. */
  ownerBannerUnknown: string;
  /** The same band when the owner of the team is a Google account, not a local profile. No name. */
  ownerBannerAccount: string;
  /** The same band when the data of this Mac belongs to no profile and this profile cannot take it: no one to switch to, no name. */
  ownerBannerNobody: string;
  /** Button in the band: it leads to the choice of the profile. */
  switchProfile: string;
};

/** The same supported locales as the sign-in screen. */
export const LOCAL_PROFILES_TEXT: Record<Locale, LocalProfilesCopy> = {
  it: {
    listTitle: "Profili su questo Mac",
    listAria: "Profili locali salvati",
    useProfile: "Continua come {name}",
    teamHere: "Squadra di questo Mac",
    lastUsed: "Ultimo usato",
    newProfile: "Nuovo profilo locale",
    newProfileNote: "Si aggiunge agli altri: non li sostituisce.",
    ownerBanner: "Su questo Mac la squadra risulta di {name}: passa a quel profilo per usarla.",
    ownerBannerUnknown: "Su questo Mac la squadra risulta di un altro profilo: passa a quel profilo per usarla.",
    ownerBannerAccount: "Su questo Mac la squadra risulta di un account Google: passa a quel profilo per usarla.",
    ownerBannerNobody: "Su questo Mac ci sono dati che non sono di nessun profilo: questo profilo non può prenderli.",
    switchProfile: "Cambia profilo",
  },
  en: {
    listTitle: "Profiles on this Mac",
    listAria: "Saved local profiles",
    useProfile: "Continue as {name}",
    teamHere: "This Mac's team",
    lastUsed: "Last used",
    newProfile: "New local profile",
    newProfileNote: "It is added to the others: it does not replace them.",
    ownerBanner: "On this Mac, the team appears to belong to {name}: switch to that profile to use it.",
    ownerBannerUnknown: "On this Mac, the team appears to belong to another profile: switch to that profile to use it.",
    ownerBannerAccount: "On this Mac, the team appears to belong to a Google account: switch to that profile to use it.",
    ownerBannerNobody: "There is data on this Mac that belongs to no profile: this profile cannot take it over.",
    switchProfile: "Switch profile",
  },
  de: {
    listTitle: "Profile auf diesem Mac",
    listAria: "Gespeicherte lokale Profile",
    useProfile: "Weiter als {name}",
    teamHere: "Team dieses Macs",
    lastUsed: "Zuletzt benutzt",
    newProfile: "Neues lokales Profil",
    newProfileNote: "Es kommt zu den anderen dazu: es ersetzt sie nicht.",
    ownerBanner: "Auf diesem Mac scheint das Team {name} zu gehören: Wechsle zu diesem Profil, um es zu nutzen.",
    ownerBannerUnknown: "Auf diesem Mac scheint das Team einem anderen Profil zu gehören: Wechsle zu diesem Profil, um es zu nutzen.",
    ownerBannerAccount: "Auf diesem Mac scheint das Team zu einem Google-Konto zu gehören: Wechsle zu diesem Profil, um es zu nutzen.",
    ownerBannerNobody: "Auf diesem Mac liegen Daten, die keinem Profil gehören: Dieses Profil kann sie nicht übernehmen.",
    switchProfile: "Profil wechseln",
  },
  fr: {
    listTitle: "Profils sur ce Mac",
    listAria: "Profils locaux enregistrés",
    useProfile: "Continuer en tant que {name}",
    teamHere: "Équipe de ce Mac",
    lastUsed: "Dernier utilisé",
    newProfile: "Nouveau profil local",
    newProfileNote: "Il s'ajoute aux autres : il ne les remplace pas.",
    ownerBanner: "Sur ce Mac, l'équipe semble appartenir à {name} : passe à ce profil pour l'utiliser.",
    ownerBannerUnknown: "Sur ce Mac, l'équipe semble appartenir à un autre profil : passe à ce profil pour l'utiliser.",
    ownerBannerAccount: "Sur ce Mac, l'équipe semble appartenir à un compte Google : passe à ce profil pour l'utiliser.",
    ownerBannerNobody: "Sur ce Mac, il y a des données qui n'appartiennent à aucun profil : ce profil ne peut pas les reprendre.",
    switchProfile: "Changer de profil",
  },
  es: {
    listTitle: "Perfiles en este Mac",
    listAria: "Perfiles locales guardados",
    useProfile: "Continuar como {name}",
    teamHere: "Equipo de este Mac",
    lastUsed: "Último usado",
    newProfile: "Nuevo perfil local",
    newProfileNote: "Se suma a los demás: no los sustituye.",
    ownerBanner: "En este Mac el equipo figura como de {name}: cambia a ese perfil para usarlo.",
    ownerBannerUnknown: "En este Mac el equipo figura como de otro perfil: cambia a ese perfil para usarlo.",
    ownerBannerAccount: "En este Mac el equipo figura como de una cuenta de Google: cambia a ese perfil para usarlo.",
    ownerBannerNobody: "En este Mac hay datos que no son de ningún perfil: este perfil no puede hacerse cargo de ellos.",
    switchProfile: "Cambiar de perfil",
  },
  pt: {
    listTitle: "Perfis neste Mac",
    listAria: "Perfis locais guardados",
    useProfile: "Continuar como {name}",
    teamHere: "Equipa deste Mac",
    lastUsed: "Último utilizado",
    newProfile: "Novo perfil local",
    newProfileNote: "Junta-se aos outros: não os substitui.",
    ownerBanner: "Neste Mac, a equipa consta como sendo de {name}: muda para esse perfil para a usar.",
    ownerBannerUnknown: "Neste Mac, a equipa consta como sendo de outro perfil: muda para esse perfil para a usar.",
    ownerBannerAccount: "Neste Mac, a equipa consta como sendo de uma conta Google: muda para esse perfil para a usar.",
    ownerBannerNobody: "Neste Mac há dados que não são de nenhum perfil: este perfil não os pode assumir.",
    switchProfile: "Mudar de perfil",
  },
  hu: {
    listTitle: "Profilok ezen a Macen",
    listAria: "Mentett helyi profilok",
    useProfile: "Folytatás mint {name}",
    teamHere: "A Mac csapata",
    lastUsed: "Legutóbbi",
    newProfile: "Új helyi profil",
    newProfileNote: "Hozzáadódik a többihez: nem váltja le őket.",
    ownerBanner: "Ezen a Macen a csapat {name} profiljához tartozónak tűnik: válts arra a profilra a használatához.",
    ownerBannerUnknown: "Ezen a Macen a csapat egy másik profilhoz tartozónak tűnik: válts arra a profilra a használatához.",
    ownerBannerAccount: "Ezen a Macen a csapat egy Google-fiókhoz tartozónak tűnik: válts arra a profilra a használatához.",
    ownerBannerNobody: "Ezen a Macen vannak adatok, amelyek egyetlen profilhoz sem tartoznak: ez a profil nem veheti át őket.",
    switchProfile: "Profil váltása",
  },
};
