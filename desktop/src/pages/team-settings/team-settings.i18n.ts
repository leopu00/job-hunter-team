import type { Locale } from "@/i18n/config";

/**
 * The «Team: models» page (/settings/team): the model and effort of each role (the working hours are
 * the page /settings/hours). 7 languages; Italian is the source and its shape is the type. The role and effort
 * names, «Default» and the buttons are the web page's own words (settings/team/page.i18n.ts). The
 * model is a class (sol, terra, luna): the page says «Maximum / Balanced / Economy», and the exact
 * model is the team's provider's business.
 */
const it = {
  title: "Squadra: modelli",
  link: "Modelli della squadra",
  linkNote: "Con quale modello e impegno lavora ogni ruolo.",
  introLocal: "Con quale modello e impegno lavora ogni ruolo, per la squadra di questo computer.",
  introVps: "Con quale modello e impegno lavora ogni ruolo, per la squadra della VPS.",
  back: "Impostazioni",
  loading: "Leggo le impostazioni della squadra…",
  retry: "Riprova",
  loadFailed: "Non riesco a leggere le impostazioni della squadra.",
  saved: "Salvato: questo è ciò che la squadra ha adesso.",
  modelsTitle: "Modello e impegno per ruolo",
  modelsDesc:
    "Massima, Bilanciata o Economica: il modello preciso lo sceglie la squadra con il suo provider. «Predefinito» lascia la scelta alla squadra. I ruoli che non tocchi restano come sono.",
  classSol: "Massima",
  classTerra: "Bilanciata",
  classLuna: "Economica",
  effectiveHeader: "In uso",
  effectiveUnavailable: "non disponibile su questa squadra",
  effectiveDefault: "predefinito",
  effectiveChosen: "scelto",
  classNotApplied: "Con questo provider la classe è dichiarata ma non applicata: la squadra usa i modelli del provider.",
};

export type TeamSettingsText = typeof it;

const en: TeamSettingsText = {
  title: "Team: models",
  link: "Team models",
  linkNote: "With which model and effort each role works.",
  introLocal: "With which model and effort each role works, for the team on this computer.",
  introVps: "With which model and effort each role works, for the team on the VPS.",
  back: "Settings",
  loading: "Reading the team's settings…",
  retry: "Try again",
  loadFailed: "Cannot read the team's settings.",
  saved: "Saved: this is what the team holds now.",
  modelsTitle: "Model and effort by role",
  modelsDesc:
    "Maximum, Balanced or Economy: the team picks the exact model with its provider. «Default» leaves the choice to the team. Roles you don't touch stay as they are.",
  classSol: "Maximum",
  classTerra: "Balanced",
  classLuna: "Economy",
  effectiveHeader: "In use",
  effectiveUnavailable: "not available on this team",
  effectiveDefault: "default",
  effectiveChosen: "chosen",
  classNotApplied: "With this provider the class is declared but not applied: the team uses the provider's own models.",
};

const de: TeamSettingsText = {
  title: "Team: Modelle",
  link: "Modelle des Teams",
  linkNote: "Mit welchem Modell und Aufwand jede Rolle arbeitet.",
  introLocal: "Mit welchem Modell und Aufwand jede Rolle arbeitet, für das Team auf diesem Computer.",
  introVps: "Mit welchem Modell und Aufwand jede Rolle arbeitet, für das Team auf der VPS.",
  back: "Einstellungen",
  loading: "Ich lese die Einstellungen des Teams…",
  retry: "Erneut versuchen",
  loadFailed: "Die Einstellungen des Teams lassen sich nicht lesen.",
  saved: "Gespeichert: So sieht das Team es jetzt.",
  modelsTitle: "Modell und Aufwand pro Rolle",
  modelsDesc:
    "Maximal, Ausgewogen oder Sparsam: Das genaue Modell wählt das Team mit seinem Anbieter. «Standard» überlässt die Wahl dem Team. Rollen, die du nicht änderst, bleiben wie sie sind.",
  classSol: "Maximal",
  classTerra: "Ausgewogen",
  classLuna: "Sparsam",
  effectiveHeader: "In Gebrauch",
  effectiveUnavailable: "für dieses Team nicht verfügbar",
  effectiveDefault: "Standard",
  effectiveChosen: "gewählt",
  classNotApplied: "Bei diesem Anbieter wird die Klasse angegeben, aber nicht angewendet: Das Team nutzt die Modelle des Anbieters.",
};

const fr: TeamSettingsText = {
  title: "Équipe : modèles",
  link: "Modèles de l’équipe",
  linkNote: "Avec quel modèle et quel effort chaque rôle travaille.",
  introLocal: "Avec quel modèle et quel effort chaque rôle travaille, pour l’équipe de cet ordinateur.",
  introVps: "Avec quel modèle et quel effort chaque rôle travaille, pour l’équipe de la VPS.",
  back: "Paramètres",
  loading: "Je lis les réglages de l’équipe…",
  retry: "Réessayer",
  loadFailed: "Impossible de lire les réglages de l’équipe.",
  saved: "Enregistré : voici ce que l’équipe a maintenant.",
  modelsTitle: "Modèle et effort par rôle",
  modelsDesc:
    "Maximal, Équilibré ou Économique : l’équipe choisit le modèle exact avec son fournisseur. « Par défaut » laisse le choix à l’équipe. Les rôles que tu ne touches pas restent tels quels.",
  classSol: "Maximal",
  classTerra: "Équilibré",
  classLuna: "Économique",
  effectiveHeader: "Utilisé",
  effectiveUnavailable: "non disponible pour cette équipe",
  effectiveDefault: "par défaut",
  effectiveChosen: "choisi",
  classNotApplied: "Avec ce fournisseur, la classe est déclarée mais non appliquée : l’équipe utilise les modèles du fournisseur.",
};

const es: TeamSettingsText = {
  title: "Equipo: modelos",
  link: "Modelos del equipo",
  linkNote: "Con qué modelo y esfuerzo trabaja cada rol.",
  introLocal: "Con qué modelo y esfuerzo trabaja cada rol, para el equipo de este ordenador.",
  introVps: "Con qué modelo y esfuerzo trabaja cada rol, para el equipo de la VPS.",
  back: "Ajustes",
  loading: "Leyendo los ajustes del equipo…",
  retry: "Reintentar",
  loadFailed: "No se pueden leer los ajustes del equipo.",
  saved: "Guardado: esto es lo que tiene ahora el equipo.",
  modelsTitle: "Modelo y esfuerzo por rol",
  modelsDesc:
    "Máxima, Equilibrada o Económica: el equipo elige el modelo exacto con su proveedor. «Predeterminado» deja la elección al equipo. Los roles que no tocas quedan como están.",
  classSol: "Máxima",
  classTerra: "Equilibrada",
  classLuna: "Económica",
  effectiveHeader: "En uso",
  effectiveUnavailable: "no disponible en este equipo",
  effectiveDefault: "predeterminado",
  effectiveChosen: "elegido",
  classNotApplied: "Con este proveedor la clase se declara pero no se aplica: el equipo usa los modelos del proveedor.",
};

const pt: TeamSettingsText = {
  title: "Equipe: modelos",
  link: "Modelos da equipe",
  linkNote: "Com que modelo e esforço cada papel trabalha.",
  introLocal: "Com que modelo e esforço cada papel trabalha, para a equipe deste computador.",
  introVps: "Com que modelo e esforço cada papel trabalha, para a equipe da VPS.",
  back: "Configurações",
  loading: "A ler as configurações da equipe…",
  retry: "Tentar de novo",
  loadFailed: "Não é possível ler as configurações da equipe.",
  saved: "Guardado: é isto que a equipe tem agora.",
  modelsTitle: "Modelo e esforço por função",
  modelsDesc:
    "Máximo, Equilibrado ou Económico: a equipe escolhe o modelo exato com o seu fornecedor. «Predefinido» deixa a escolha à equipe. As funções que não tocas ficam como estão.",
  classSol: "Máximo",
  classTerra: "Equilibrado",
  classLuna: "Económico",
  effectiveHeader: "Em uso",
  effectiveUnavailable: "não disponível nesta equipa",
  effectiveDefault: "predefinido",
  effectiveChosen: "escolhido",
  classNotApplied: "Com este fornecedor a classe é declarada mas não aplicada: a equipa usa os modelos do fornecedor.",
};

const hu: TeamSettingsText = {
  title: "Csapat: modellek",
  link: "A csapat modelljei",
  linkNote: "Milyen modellel és erőfeszítéssel dolgozik minden szerepkör.",
  introLocal: "Milyen modellel és erőfeszítéssel dolgozik minden szerepkör, az ezen a számítógépen futó csapatnál.",
  introVps: "Milyen modellel és erőfeszítéssel dolgozik minden szerepkör, a VPS-en futó csapatnál.",
  back: "Beállítások",
  loading: "A csapat beállításainak beolvasása…",
  retry: "Újra",
  loadFailed: "A csapat beállításai nem olvashatók.",
  saved: "Mentve: ezt tartja most a csapat.",
  modelsTitle: "Modell és erőfeszítés szerepenként",
  modelsDesc:
    "Legnagyobb, Kiegyensúlyozott vagy Takarékos: a pontos modellt a csapat választja a szolgáltatójával. Az «Alapértelmezett» a csapatra hagyja a választást. Az érintetlen szerepek úgy maradnak, ahogy vannak.",
  classSol: "Legnagyobb",
  classTerra: "Kiegyensúlyozott",
  classLuna: "Takarékos",
  effectiveHeader: "Használatban",
  effectiveUnavailable: "ennél a csapatnál nem elérhető",
  effectiveDefault: "alapértelmezett",
  effectiveChosen: "választott",
  classNotApplied: "Ennél a szolgáltatónál az osztály csak meg van adva, de nem érvényesül: a csapat a szolgáltató saját modelljeit használja.",
};

export const TEAM_SETTINGS_TEXT: Record<Locale, TeamSettingsText> = { it, en, de, fr, es, pt, hu };
