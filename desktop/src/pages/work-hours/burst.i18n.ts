import type { Locale } from "@/i18n/config";

/**
 * «Work flat out until HH:MM» (the burst): one gesture on the Hours page and in the agents' panel, next to
 * «Stop the team». 7 languages; Italian is the source and its shape is the type. The word for «flat out» is
 * the one the agents' panel already uses for the same thing (burnOn / burnEnding in AgentsPanel.i18n.ts), so
 * one thing has one name. `{time}` is the team's wall clock HH:MM, filled in by the page. The two refusals
 * (a time too near, a time too far) are in the error catalog, not here.
 */
const it = {
  burstTitle: "A tutto gas, fino a un’ora",
  burstIntro: "Un gesto solo: la squadra lavora a tutto gas fino all’ora scelta, anche fuori dagli orari. Alla scadenza tornano da soli gli orari di prima, anche se l’app è chiusa.",
  burstUntilLabel: "Fino alle",
  burstStart: "Lavora a tutto gas fino alle {time}",
  burstStartShort: "Lavora a tutto gas",
  burstNeedsTime: "Scegli l’ora.",
  burstLimit: "Da 15 minuti a 12 ore da adesso.",
  burstActive: "A tutto gas fino alle {time}",
  burstActiveNote: "Alla scadenza tornano gli orari di prima.",
  burstStop: "Ferma adesso",
  burstStarted: "Partito: la squadra lavora a tutto gas fino alle {time}.",
  burstStopped: "Fermato: sono tornati gli orari di prima.",
  burstBusy: "Un momento…",
};

export type BurstText = typeof it;

const en: BurstText = {
  burstTitle: "Full throttle, until a time",
  burstIntro: "One tap: the team works at full throttle until the time you choose, even outside its hours. When it ends, the hours you had before come back by themselves, even if the app is closed.",
  burstUntilLabel: "Until",
  burstStart: "Work at full throttle until {time}",
  burstStartShort: "Work at full throttle",
  burstNeedsTime: "Choose the time.",
  burstLimit: "From 15 minutes to 12 hours from now.",
  burstActive: "Full throttle until {time}",
  burstActiveNote: "When it ends, the hours you had before come back.",
  burstStop: "Stop now",
  burstStarted: "Started: the team is working at full throttle until {time}.",
  burstStopped: "Stopped: the earlier hours are back.",
  burstBusy: "One moment…",
};

const de: BurstText = {
  burstTitle: "Vollgas bis zu einer Uhrzeit",
  burstIntro: "Ein Fingertipp: Das Team arbeitet mit Vollgas bis zur gewählten Uhrzeit, auch außerhalb der Arbeitszeiten. Danach gelten von selbst wieder die Zeiten von vorher, auch wenn die App geschlossen ist.",
  burstUntilLabel: "Bis",
  burstStart: "Mit Vollgas arbeiten bis {time}",
  burstStartShort: "Mit Vollgas arbeiten",
  burstNeedsTime: "Wähle die Uhrzeit.",
  burstLimit: "Von 15 Minuten bis 12 Stunden ab jetzt.",
  burstActive: "Vollgas bis {time}",
  burstActiveNote: "Danach gelten wieder die Zeiten von vorher.",
  burstStop: "Jetzt anhalten",
  burstStarted: "Gestartet: Das Team arbeitet mit Vollgas bis {time}.",
  burstStopped: "Angehalten: Die Zeiten von vorher gelten wieder.",
  burstBusy: "Einen Moment…",
};

const fr: BurstText = {
  burstTitle: "Pleins gaz, jusqu’à une heure",
  burstIntro: "Un seul geste : l’équipe travaille à pleins gaz jusqu’à l’heure choisie, même en dehors de ses horaires. À l’échéance, les horaires d’avant reviennent tout seuls, même si l’app est fermée.",
  burstUntilLabel: "Jusqu’à",
  burstStart: "Travailler à pleins gaz jusqu’à {time}",
  burstStartShort: "Travailler à pleins gaz",
  burstNeedsTime: "Choisis l’heure.",
  burstLimit: "De 15 minutes à 12 heures à partir de maintenant.",
  burstActive: "Pleins gaz jusqu’à {time}",
  burstActiveNote: "À l’échéance, les horaires d’avant reviennent.",
  burstStop: "Arrêter maintenant",
  burstStarted: "C’est parti : l’équipe travaille à pleins gaz jusqu’à {time}.",
  burstStopped: "Arrêté : les horaires d’avant sont revenus.",
  burstBusy: "Un instant…",
};

const es: BurstText = {
  burstTitle: "A todo gas, hasta una hora",
  burstIntro: "Un solo gesto: el equipo trabaja a todo gas hasta la hora elegida, incluso fuera de su horario. Al terminar, vuelve solo el horario de antes, aunque la app esté cerrada.",
  burstUntilLabel: "Hasta las",
  burstStart: "Trabajar a todo gas hasta las {time}",
  burstStartShort: "Trabajar a todo gas",
  burstNeedsTime: "Elige la hora.",
  burstLimit: "De 15 minutos a 12 horas desde ahora.",
  burstActive: "A todo gas hasta las {time}",
  burstActiveNote: "Al terminar, vuelve el horario de antes.",
  burstStop: "Parar ahora",
  burstStarted: "En marcha: el equipo trabaja a todo gas hasta las {time}.",
  burstStopped: "Parado: ha vuelto el horario de antes.",
  burstBusy: "Un momento…",
};

const pt: BurstText = {
  burstTitle: "Todo o gás, até uma hora",
  burstIntro: "Um só gesto: a equipa trabalha com todo o gás até à hora escolhida, mesmo fora do horário. No fim, o horário de antes volta sozinho, mesmo com a app fechada.",
  burstUntilLabel: "Até às",
  burstStart: "Trabalhar com todo o gás até às {time}",
  burstStartShort: "Trabalhar com todo o gás",
  burstNeedsTime: "Escolhe a hora.",
  burstLimit: "De 15 minutos a 12 horas a partir de agora.",
  burstActive: "Todo o gás até às {time}",
  burstActiveNote: "No fim, volta o horário de antes.",
  burstStop: "Parar agora",
  burstStarted: "Arrancou: a equipa trabalha com todo o gás até às {time}.",
  burstStopped: "Parado: voltou o horário de antes.",
  burstBusy: "Um momento…",
};

const hu: BurstText = {
  burstTitle: "Full gőz, egy időpontig",
  burstIntro: "Egyetlen mozdulat: a csapat full gőzzel dolgozik a választott időpontig, a munkaidőn kívül is. Lejártakor magától visszaáll a korábbi munkaidő, akkor is, ha az alkalmazás be van zárva.",
  burstUntilLabel: "Eddig",
  burstStart: "Dolgozzanak full gőzzel {time}-ig",
  burstStartShort: "Dolgozzanak full gőzzel",
  burstNeedsTime: "Válaszd ki az időpontot.",
  burstLimit: "Mostantól 15 perctől 12 óráig.",
  burstActive: "Full gőzzel {time}-ig",
  burstActiveNote: "Lejártakor visszaáll a korábbi munkaidő.",
  burstStop: "Leállítás most",
  burstStarted: "Elindult: a csapat full gőzzel dolgozik {time}-ig.",
  burstStopped: "Leállítva: visszaállt a korábbi munkaidő.",
  burstBusy: "Egy pillanat…",
};

export const BURST_TEXT: Record<Locale, BurstText> = { it, en, de, fr, es, pt, hu };
