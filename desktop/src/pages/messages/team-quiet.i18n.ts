import type { Locale } from "@/i18n/config";

/**
 * The line under the status of the chat that says why the team is not writing. {time} is the team's own clock (HH:MM), {day} a weekday
 * in the person's language, {when} one of inMinutes / inHours, {pct} the share of the provider's window already used.
 */
export interface TeamQuietText {
  outsideToday: string;
  outsideTomorrow: string;
  outsideDay: string;
  budgetFull: string;
  budgetNear: string;
  inMinutes: string;
  inHours: string;
  containment: string;
  provider: string;
}

export const TEAM_QUIET_TEXT: Record<Locale, TeamQuietText> = {
  it: {
    outsideToday: "Il team non scrive perché ora è fuori dall'orario di lavoro: riprende alle {time}.",
    outsideTomorrow: "Il team non scrive perché ora è fuori dall'orario di lavoro: riprende domani alle {time}.",
    outsideDay: "Il team non scrive perché ora è fuori dall'orario di lavoro: riprende {day} alle {time}.",
    budgetFull: "Il team non scrive: ha esaurito la finestra di lavoro del provider. Riprende {when}.",
    budgetNear: "La finestra di lavoro del provider è al {pct}%: il team rallenta e si riapre {when}.",
    inMinutes: "tra {n} min",
    inHours: "tra {h} h {m} min",
    containment: "Un agente del team è fermo per un contenimento di sicurezza: dall'app non si può riavviare.",
    provider: "Il provider del team non ha un accesso valido: il team non può lavorare finché non accedi di nuovo.",
  },
  en: {
    outsideToday: "The team is not writing because it is outside its working hours now: it starts again at {time}.",
    outsideTomorrow: "The team is not writing because it is outside its working hours now: it starts again tomorrow at {time}.",
    outsideDay: "The team is not writing because it is outside its working hours now: it starts again {day} at {time}.",
    budgetFull: "The team is not writing: it has used up the provider's work window. It starts again {when}.",
    budgetNear: "The provider's work window is at {pct}%: the team slows down and it reopens {when}.",
    inMinutes: "in {n} min",
    inHours: "in {h} h {m} min",
    containment: "An agent of the team is held by a safety containment: it cannot be restarted from the app.",
    provider: "The team's provider has no valid login: the team cannot work until you sign in again.",
  },
  de: {
    outsideToday: "Das Team schreibt nicht, weil es gerade außerhalb der Arbeitszeit ist: Es beginnt wieder um {time} Uhr.",
    outsideTomorrow: "Das Team schreibt nicht, weil es gerade außerhalb der Arbeitszeit ist: Es beginnt wieder morgen um {time} Uhr.",
    outsideDay: "Das Team schreibt nicht, weil es gerade außerhalb der Arbeitszeit ist: Es beginnt wieder am {day} um {time} Uhr.",
    budgetFull: "Das Team schreibt nicht: Das Arbeitsfenster des Anbieters ist aufgebraucht. Es geht weiter {when}.",
    budgetNear: "Das Arbeitsfenster des Anbieters ist zu {pct} % voll: Das Team wird langsamer, es öffnet sich wieder {when}.",
    inMinutes: "in {n} Min.",
    inHours: "in {h} Std. {m} Min.",
    containment: "Ein Agent des Teams ist wegen einer Sicherheitssperre angehalten: Er lässt sich nicht aus der App neu starten.",
    provider: "Der Anbieter des Teams hat keine gültige Anmeldung: Das Team kann nicht arbeiten, bis du dich neu anmeldest.",
  },
  fr: {
    outsideToday: "L'équipe n'écrit pas parce qu'elle est hors de ses heures de travail : elle reprend à {time}.",
    outsideTomorrow: "L'équipe n'écrit pas parce qu'elle est hors de ses heures de travail : elle reprend demain à {time}.",
    outsideDay: "L'équipe n'écrit pas parce qu'elle est hors de ses heures de travail : elle reprend {day} à {time}.",
    budgetFull: "L'équipe n'écrit pas : la fenêtre de travail du fournisseur est épuisée. Elle reprend {when}.",
    budgetNear: "La fenêtre de travail du fournisseur est à {pct} % : l'équipe ralentit et elle se rouvre {when}.",
    inMinutes: "dans {n} min",
    inHours: "dans {h} h {m} min",
    containment: "Un agent de l'équipe est arrêté par un confinement de sécurité : l'app ne peut pas le redémarrer.",
    provider: "Le fournisseur de l'équipe n'a pas de connexion valide : l'équipe ne peut pas travailler tant que tu ne te reconnectes pas.",
  },
  es: {
    outsideToday: "El equipo no escribe porque ahora está fuera de su horario de trabajo: retoma a las {time}.",
    outsideTomorrow: "El equipo no escribe porque ahora está fuera de su horario de trabajo: retoma mañana a las {time}.",
    outsideDay: "El equipo no escribe porque ahora está fuera de su horario de trabajo: retoma el {day} a las {time}.",
    budgetFull: "El equipo no escribe: ha agotado la ventana de trabajo del proveedor. Retoma {when}.",
    budgetNear: "La ventana de trabajo del proveedor está al {pct} %: el equipo va más lento y se reabre {when}.",
    inMinutes: "en {n} min",
    inHours: "en {h} h {m} min",
    containment: "Un agente del equipo está detenido por una contención de seguridad: no se puede reiniciar desde la app.",
    provider: "El proveedor del equipo no tiene un acceso válido: el equipo no puede trabajar hasta que vuelvas a iniciar sesión.",
  },
  pt: {
    outsideToday: "A equipa não escreve porque agora está fora do horário de trabalho: retoma às {time}.",
    outsideTomorrow: "A equipa não escreve porque agora está fora do horário de trabalho: retoma amanhã às {time}.",
    outsideDay: "A equipa não escreve porque agora está fora do horário de trabalho: retoma {day} às {time}.",
    budgetFull: "A equipa não escreve: esgotou a janela de trabalho do fornecedor. Retoma {when}.",
    budgetNear: "A janela de trabalho do fornecedor está em {pct}%: a equipa abranda e reabre {when}.",
    inMinutes: "dentro de {n} min",
    inHours: "dentro de {h} h {m} min",
    containment: "Um agente da equipa está parado por uma contenção de segurança: não pode ser reiniciado a partir da app.",
    provider: "O fornecedor da equipa não tem um acesso válido: a equipa não pode trabalhar até voltares a iniciar sessão.",
  },
  hu: {
    outsideToday: "A csapat nem ír, mert most a munkaidején kívül van: {time}-kor folytatja.",
    outsideTomorrow: "A csapat nem ír, mert most a munkaidején kívül van: holnap {time}-kor folytatja.",
    outsideDay: "A csapat nem ír, mert most a munkaidején kívül van: {day} {time}-kor folytatja.",
    budgetFull: "A csapat nem ír: kimerítette a szolgáltató munkaablakát. Folytatja: {when}.",
    budgetNear: "A szolgáltató munkaablaka {pct}%-on áll: a csapat lassul, újra megnyílik {when}.",
    inMinutes: "{n} perc múlva",
    inHours: "{h} óra {m} perc múlva",
    containment: "A csapat egyik ügynöke biztonsági elzárás miatt áll: az alkalmazásból nem indítható újra.",
    provider: "A csapat szolgáltatójához nincs érvényes bejelentkezés: a csapat nem dolgozhat, amíg újra be nem jelentkezel.",
  },
};
