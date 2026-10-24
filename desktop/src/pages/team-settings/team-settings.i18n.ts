import type { Locale } from "@/i18n/config";

/**
 * The «Team: hours and models» page (/settings/team): when the agents work and the model and effort
 * of each role. 7 languages; Italian is the source and its shape is the type. The role and effort
 * names, «Default» and the buttons are the web page's own words (settings/team/page.i18n.ts). The
 * model is a class (sol, terra, luna): the page says «Maximum / Balanced / Economy», and the exact
 * model is the team's provider's business.
 */
const it = {
  title: "Squadra: orari e modelli",
  link: "Orari e modelli della squadra",
  linkNote: "Quando lavorano gli agenti, e con quale modello e impegno.",
  introLocal: "Quando lavorano gli agenti e con quale modello e impegno, per la squadra di questo computer.",
  introVps: "Quando lavorano gli agenti e con quale modello e impegno, per la squadra della VPS.",
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
};

export type TeamSettingsText = typeof it;

const en: TeamSettingsText = {
  title: "Team: hours and models",
  link: "Team hours and models",
  linkNote: "When the agents work, and with which model and effort.",
  introLocal: "When the agents work and with which model and effort, for the team on this computer.",
  introVps: "When the agents work and with which model and effort, for the team on the VPS.",
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
};

const de: TeamSettingsText = {
  title: "Team: Zeiten und Modelle",
  link: "Zeiten und Modelle des Teams",
  linkNote: "Wann die Agenten arbeiten und mit welchem Modell und Aufwand.",
  introLocal: "Wann die Agenten arbeiten und mit welchem Modell und Aufwand, für das Team auf diesem Computer.",
  introVps: "Wann die Agenten arbeiten und mit welchem Modell und Aufwand, für das Team auf der VPS.",
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
};

const fr: TeamSettingsText = {
  title: "Équipe : horaires et modèles",
  link: "Horaires et modèles de l’équipe",
  linkNote: "Quand les agents travaillent, et avec quel modèle et quel effort.",
  introLocal: "Quand les agents travaillent et avec quel modèle et quel effort, pour l’équipe de cet ordinateur.",
  introVps: "Quand les agents travaillent et avec quel modèle et quel effort, pour l’équipe de la VPS.",
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
};

const es: TeamSettingsText = {
  title: "Equipo: horarios y modelos",
  link: "Horarios y modelos del equipo",
  linkNote: "Cuándo trabajan los agentes, y con qué modelo y esfuerzo.",
  introLocal: "Cuándo trabajan los agentes y con qué modelo y esfuerzo, para el equipo de este ordenador.",
  introVps: "Cuándo trabajan los agentes y con qué modelo y esfuerzo, para el equipo de la VPS.",
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
};

const pt: TeamSettingsText = {
  title: "Equipe: horários e modelos",
  link: "Horários e modelos da equipe",
  linkNote: "Quando os agentes trabalham, e com que modelo e esforço.",
  introLocal: "Quando os agentes trabalham e com que modelo e esforço, para a equipe deste computador.",
  introVps: "Quando os agentes trabalham e com que modelo e esforço, para a equipe da VPS.",
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
};

const hu: TeamSettingsText = {
  title: "Csapat: munkaidő és modellek",
  link: "A csapat munkaideje és modelljei",
  linkNote: "Mikor dolgoznak az ügynökök, és milyen modellel és erőfeszítéssel.",
  introLocal: "Mikor dolgoznak az ügynökök, és milyen modellel és erőfeszítéssel, az ezen a számítógépen futó csapatnál.",
  introVps: "Mikor dolgoznak az ügynökök, és milyen modellel és erőfeszítéssel, a VPS-en futó csapatnál.",
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
};

export const TEAM_SETTINGS_TEXT: Record<Locale, TeamSettingsText> = { it, en, de, fr, es, pt, hu };
