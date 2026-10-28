import type { Locale } from "@/i18n/config";

/**
 * The «Working hours» page (/settings/hours): when the agents work, for the team of this computer or of
 * the linked VPS. 7 languages; Italian is the source and its shape is the type. `consequence` says
 * what really happens after a change: shared/skills/working_hours.py reads the hours from disk at every
 * call, so the team sees them at its next check (the pacing tick, 15 minutes) with no restart, and work
 * in progress is not interrupted. A test reads that file and fails if the text stops being true.
 * `unreadable` is the limit of the hours today: a file that cannot be read means a team with no hours limit,
 * and the page says so, in the read-only view too (the settings page carries it there).
 */
const it = {
  title: "Orari di lavoro",
  link: "Orari di lavoro",
  linkNote: "Quando lavorano gli agenti.",
  introLocal: "Quando lavorano gli agenti, per la squadra di questo computer.",
  introVps: "Quando lavorano gli agenti, per la squadra della VPS.",
  consequence: "Il nuovo orario vale dal prossimo controllo della squadra (entro circa 15 minuti); non interrompe il lavoro in corso.",
  unreadable: "Se gli orari non sono leggibili, la squadra lavora senza limiti d’orario finché non li salvi di nuovo.",
  back: "Impostazioni",
  loading: "Leggo gli orari della squadra…",
  retry: "Riprova",
  loadFailed: "Non riesco a leggere gli orari della squadra.",
  saved: "Salvato: questo è ciò che la squadra ha adesso.",
};

export type WorkHoursText = typeof it;

const en: WorkHoursText = {
  title: "Working hours",
  link: "Working hours",
  linkNote: "When the agents work.",
  introLocal: "When the agents work, for the team on this computer.",
  introVps: "When the agents work, for the team on the VPS.",
  consequence: "The new hours apply from the team's next check (within about 15 minutes); they do not interrupt work in progress.",
  unreadable: "If the hours cannot be read, the team works with no hours limit until you save them again.",
  back: "Settings",
  loading: "Reading the team's hours…",
  retry: "Try again",
  loadFailed: "Cannot read the team's hours.",
  saved: "Saved: this is what the team holds now.",
};

const de: WorkHoursText = {
  title: "Arbeitszeiten",
  link: "Arbeitszeiten",
  linkNote: "Wann die Agenten arbeiten.",
  introLocal: "Wann die Agenten arbeiten, für das Team auf diesem Computer.",
  introVps: "Wann die Agenten arbeiten, für das Team auf der VPS.",
  consequence: "Die neuen Zeiten gelten ab der nächsten Prüfung des Teams (in etwa 15 Minuten); laufende Arbeit wird nicht unterbrochen.",
  unreadable: "Sind die Arbeitszeiten nicht lesbar, arbeitet das Team ohne Zeitlimit, bis du sie erneut speicherst.",
  back: "Einstellungen",
  loading: "Ich lese die Arbeitszeiten des Teams…",
  retry: "Erneut versuchen",
  loadFailed: "Die Arbeitszeiten des Teams lassen sich nicht lesen.",
  saved: "Gespeichert: So sieht das Team es jetzt.",
};

const fr: WorkHoursText = {
  title: "Horaires de travail",
  link: "Horaires de travail",
  linkNote: "Quand les agents travaillent.",
  introLocal: "Quand les agents travaillent, pour l’équipe de cet ordinateur.",
  introVps: "Quand les agents travaillent, pour l’équipe de la VPS.",
  consequence: "Le nouvel horaire s’applique dès le prochain contrôle de l’équipe (dans environ 15 minutes) ; il n’interrompt pas le travail en cours.",
  unreadable: "Si les horaires ne sont pas lisibles, l’équipe travaille sans limite d’horaire jusqu’à ce que tu les enregistres de nouveau.",
  back: "Paramètres",
  loading: "Je lis les horaires de l’équipe…",
  retry: "Réessayer",
  loadFailed: "Impossible de lire les horaires de l’équipe.",
  saved: "Enregistré : voici ce que l’équipe a maintenant.",
};

const es: WorkHoursText = {
  title: "Horario de trabajo",
  link: "Horario de trabajo",
  linkNote: "Cuándo trabajan los agentes.",
  introLocal: "Cuándo trabajan los agentes, para el equipo de este ordenador.",
  introVps: "Cuándo trabajan los agentes, para el equipo de la VPS.",
  consequence: "El nuevo horario vale desde la próxima comprobación del equipo (en unos 15 minutos); no interrumpe el trabajo en curso.",
  unreadable: "Si el horario no se puede leer, el equipo trabaja sin límite de horario hasta que lo guardes de nuevo.",
  back: "Ajustes",
  loading: "Leyendo el horario del equipo…",
  retry: "Reintentar",
  loadFailed: "No se puede leer el horario del equipo.",
  saved: "Guardado: esto es lo que tiene ahora el equipo.",
};

const pt: WorkHoursText = {
  title: "Horário de trabalho",
  link: "Horário de trabalho",
  linkNote: "Quando os agentes trabalham.",
  introLocal: "Quando os agentes trabalham, para a equipa deste computador.",
  introVps: "Quando os agentes trabalham, para a equipa da VPS.",
  consequence: "O novo horário vale a partir da próxima verificação da equipa (em cerca de 15 minutos); não interrompe o trabalho em curso.",
  unreadable: "Se o horário não puder ser lido, a equipa trabalha sem limite de horário até o guardares de novo.",
  back: "Configurações",
  loading: "A ler o horário da equipa…",
  retry: "Tentar de novo",
  loadFailed: "Não é possível ler o horário da equipa.",
  saved: "Guardado: é isto que a equipa tem agora.",
};

const hu: WorkHoursText = {
  title: "Munkaidő",
  link: "Munkaidő",
  linkNote: "Mikor dolgoznak az ügynökök.",
  introLocal: "Mikor dolgoznak az ügynökök, az ezen a számítógépen futó csapatnál.",
  introVps: "Mikor dolgoznak az ügynökök, a VPS-en futó csapatnál.",
  consequence: "Az új munkaidő a csapat következő ellenőrzésétől érvényes (kb. 15 percen belül); a folyamatban lévő munkát nem szakítja meg.",
  unreadable: "Ha a munkaidő nem olvasható, a csapat időkorlát nélkül dolgozik, amíg újra el nem mented.",
  back: "Beállítások",
  loading: "A csapat munkaidejének beolvasása…",
  retry: "Újra",
  loadFailed: "A csapat munkaideje nem olvasható.",
  saved: "Mentve: ezt tartja most a csapat.",
};

export const WORK_HOURS_TEXT: Record<Locale, WorkHoursText> = { it, en, de, fr, es, pt, hu };
