import type { Locale } from "@/i18n/config";

/**
 * «Work flat out until HH:MM» (the burst): one gesture on the Hours page and in the agents' panel, next to
 * «Stop the team». 7 languages; Italian is the source and its shape is the type. The Italian says «a tutta», the
 * operator's own words for this gesture ("Lavora a tutta fino alle HH:MM"); the agents' panel keeps its
 * «a tutto gas» for the burn that the Captain turns on. `{time}` is the team's wall clock HH:MM, filled in by the page. The two refusals
 * (a time too near, a time too far) are in the error catalog, not here.
 */
const it = {
  burstTitle: "A tutta, fino a un’ora",
  burstIntro: "Un gesto solo: la squadra lavora a tutta fino all’ora scelta, anche fuori dagli orari. Alla scadenza tornano da soli gli orari di prima, anche se l’app è chiusa.",
  burstUntilLabel: "Fino alle",
  burstStart: "Lavora a tutta fino alle {time}",
  burstStartShort: "Lavora a tutta",
  burstNeedsTime: "Scegli l’ora: compila ore e minuti (e AM/PM, se il campo li mostra), oppure tocca una durata.",
  burstQuickLabel: "Per quanto tempo?",
  burstFor1: "per 1 ora",
  burstFor2: "per 2 ore",
  burstFor4: "per 4 ore",
  burstExactLabel: "Oppure un’ora precisa",
  burstLimit: "Da 15 minuti a 12 ore da adesso.",
  burstActive: "A tutta fino alle {time}",
  burstActiveNote: "Alla scadenza tornano gli orari di prima.",
  burstStop: "Ferma adesso",
  burstStarted: "Avviato fino alle {time}",
  burstUndo: "Annulla",
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
  burstNeedsTime: "Choose the time: fill in hours and minutes (and AM/PM if the field shows it), or tap a length of time.",
  burstQuickLabel: "For how long?",
  burstFor1: "for 1 hour",
  burstFor2: "for 2 hours",
  burstFor4: "for 4 hours",
  burstExactLabel: "Or an exact time",
  burstLimit: "From 15 minutes to 12 hours from now.",
  burstActive: "Full throttle until {time}",
  burstActiveNote: "When it ends, the hours you had before come back.",
  burstStop: "Stop now",
  burstStarted: "Started until {time}",
  burstUndo: "Undo",
  burstStopped: "Stopped: the earlier hours are back.",
  burstBusy: "One moment…",
};

const de: BurstText = {
  burstTitle: "Vollgas bis zu einer Uhrzeit",
  burstIntro: "Ein Fingertipp: Das Team arbeitet mit Vollgas bis zur gewählten Uhrzeit, auch außerhalb der Arbeitszeiten. Danach gelten von selbst wieder die Zeiten von vorher, auch wenn die App geschlossen ist.",
  burstUntilLabel: "Bis",
  burstStart: "Mit Vollgas arbeiten bis {time}",
  burstStartShort: "Mit Vollgas arbeiten",
  burstNeedsTime: "Wähle die Uhrzeit: Gib Stunden und Minuten ein (und AM/PM, wenn das Feld es zeigt) oder tippe auf eine Dauer.",
  burstQuickLabel: "Wie lange?",
  burstFor1: "für 1 Stunde",
  burstFor2: "für 2 Stunden",
  burstFor4: "für 4 Stunden",
  burstExactLabel: "Oder eine genaue Uhrzeit",
  burstLimit: "Von 15 Minuten bis 12 Stunden ab jetzt.",
  burstActive: "Vollgas bis {time}",
  burstActiveNote: "Danach gelten wieder die Zeiten von vorher.",
  burstStop: "Jetzt anhalten",
  burstStarted: "Gestartet bis {time}",
  burstUndo: "Rückgängig",
  burstStopped: "Angehalten: Die Zeiten von vorher gelten wieder.",
  burstBusy: "Einen Moment…",
};

const fr: BurstText = {
  burstTitle: "Pleins gaz, jusqu’à une heure",
  burstIntro: "Un seul geste : l’équipe travaille à pleins gaz jusqu’à l’heure choisie, même en dehors de ses horaires. À l’échéance, les horaires d’avant reviennent tout seuls, même si l’app est fermée.",
  burstUntilLabel: "Jusqu’à",
  burstStart: "Travailler à pleins gaz jusqu’à {time}",
  burstStartShort: "Travailler à pleins gaz",
  burstNeedsTime: "Choisis l’heure : renseigne les heures et les minutes (et AM/PM si le champ l’affiche), ou touche une durée.",
  burstQuickLabel: "Pendant combien de temps ?",
  burstFor1: "pendant 1 heure",
  burstFor2: "pendant 2 heures",
  burstFor4: "pendant 4 heures",
  burstExactLabel: "Ou une heure précise",
  burstLimit: "De 15 minutes à 12 heures à partir de maintenant.",
  burstActive: "Pleins gaz jusqu’à {time}",
  burstActiveNote: "À l’échéance, les horaires d’avant reviennent.",
  burstStop: "Arrêter maintenant",
  burstStarted: "Lancé jusqu’à {time}",
  burstUndo: "Annuler",
  burstStopped: "Arrêté : les horaires d’avant sont revenus.",
  burstBusy: "Un instant…",
};

const es: BurstText = {
  burstTitle: "A todo gas, hasta una hora",
  burstIntro: "Un solo gesto: el equipo trabaja a todo gas hasta la hora elegida, incluso fuera de su horario. Al terminar, vuelve solo el horario de antes, aunque la app esté cerrada.",
  burstUntilLabel: "Hasta las",
  burstStart: "Trabajar a todo gas hasta las {time}",
  burstStartShort: "Trabajar a todo gas",
  burstNeedsTime: "Elige la hora: rellena horas y minutos (y AM/PM si el campo lo muestra), o toca una duración.",
  burstQuickLabel: "¿Durante cuánto tiempo?",
  burstFor1: "durante 1 hora",
  burstFor2: "durante 2 horas",
  burstFor4: "durante 4 horas",
  burstExactLabel: "O una hora exacta",
  burstLimit: "De 15 minutos a 12 horas desde ahora.",
  burstActive: "A todo gas hasta las {time}",
  burstActiveNote: "Al terminar, vuelve el horario de antes.",
  burstStop: "Parar ahora",
  burstStarted: "Iniciado hasta las {time}",
  burstUndo: "Deshacer",
  burstStopped: "Parado: ha vuelto el horario de antes.",
  burstBusy: "Un momento…",
};

const pt: BurstText = {
  burstTitle: "Todo o gás, até uma hora",
  burstIntro: "Um só gesto: a equipa trabalha com todo o gás até à hora escolhida, mesmo fora do horário. No fim, o horário de antes volta sozinho, mesmo com a app fechada.",
  burstUntilLabel: "Até às",
  burstStart: "Trabalhar com todo o gás até às {time}",
  burstStartShort: "Trabalhar com todo o gás",
  burstNeedsTime: "Escolhe a hora: preenche horas e minutos (e AM/PM, se o campo os mostrar), ou toca numa duração.",
  burstQuickLabel: "Durante quanto tempo?",
  burstFor1: "durante 1 hora",
  burstFor2: "durante 2 horas",
  burstFor4: "durante 4 horas",
  burstExactLabel: "Ou uma hora exata",
  burstLimit: "De 15 minutos a 12 horas a partir de agora.",
  burstActive: "Todo o gás até às {time}",
  burstActiveNote: "No fim, volta o horário de antes.",
  burstStop: "Parar agora",
  burstStarted: "Iniciado até às {time}",
  burstUndo: "Desfazer",
  burstStopped: "Parado: voltou o horário de antes.",
  burstBusy: "Um momento…",
};

const hu: BurstText = {
  burstTitle: "Full gőz, egy időpontig",
  burstIntro: "Egyetlen mozdulat: a csapat full gőzzel dolgozik a választott időpontig, a munkaidőn kívül is. Lejártakor magától visszaáll a korábbi munkaidő, akkor is, ha az alkalmazás be van zárva.",
  burstUntilLabel: "Eddig",
  burstStart: "Dolgozzanak full gőzzel {time}-ig",
  burstStartShort: "Dolgozzanak full gőzzel",
  burstNeedsTime: "Válaszd ki az időpontot: töltsd ki az órát és a percet (és az AM/PM-et, ha a mező mutatja), vagy koppints egy időtartamra.",
  burstQuickLabel: "Mennyi ideig?",
  burstFor1: "1 órára",
  burstFor2: "2 órára",
  burstFor4: "4 órára",
  burstExactLabel: "Vagy pontos időpont",
  burstLimit: "Mostantól 15 perctől 12 óráig.",
  burstActive: "Full gőzzel {time}-ig",
  burstActiveNote: "Lejártakor visszaáll a korábbi munkaidő.",
  burstStop: "Leállítás most",
  burstStarted: "Elindítva eddig: {time}",
  burstUndo: "Visszavonás",
  burstStopped: "Leállítva: visszaállt a korábbi munkaidő.",
  burstBusy: "Egy pillanat…",
};

export const BURST_TEXT: Record<Locale, BurstText> = { it, en, de, fr, es, pt, hu };
