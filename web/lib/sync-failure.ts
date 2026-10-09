/**
 * La sincronizzazione manuale (`POST /api/local/sync`) che non riesce, detta
 * nella lingua dell'utente. La usano la pagina Cloud sync e il banner: tutte e
 * due mostravano il corpo della route (in italiano, o `sqlite_read_failed`) o
 * il testo di un'eccezione.
 */
import type { Locale } from "@/i18n/config";
import { makeT, type Dictionary } from "@/lib/i18n-dict";
import { writeFailureReason } from "@/lib/write-failure";

const SYNC_FAILURE = {
  not_synced: {
    it: "Sincronizzazione NON fatta.",
    en: "Sync NOT done.",
    hu: "A szinkronizálás NEM történt meg.",
    es: "Sincronización NO realizada.",
    de: "Synchronisierung NICHT durchgeführt.",
    fr: "Synchronisation NON effectuée.",
    pt: "Sincronização NÃO feita.",
  },
  no_local_db: {
    it: "Il database locale non c'è ancora: avvia il team almeno una volta.",
    en: "The local database does not exist yet: start the team at least once.",
    hu: "A helyi adatbázis még nem létezik: indítsd el a csapatot legalább egyszer.",
    es: "La base de datos local aún no existe: inicia el equipo al menos una vez.",
    de: "Die lokale Datenbank gibt es noch nicht: Starte das Team mindestens einmal.",
    fr: "La base de données locale n'existe pas encore : lancez l'équipe au moins une fois.",
    pt: "A base de dados local ainda não existe: inicia a equipa pelo menos uma vez.",
  },
} satisfies Dictionary;

/** La frase per una sincronizzazione non riuscita (`status` null = rete). */
export function syncFailureMessage(
  locale: Locale | string,
  status: number | null,
): string {
  const t = makeT(SYNC_FAILURE, locale);
  const reason =
    status === 404 ? t("no_local_db") : writeFailureReason(locale, status);
  return `${t("not_synced")} ${reason}`;
}

/** Una risposta della route di sync: ha sempre il campo booleano `empty`. */
export function isSyncResult(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { empty?: unknown }).empty === "boolean"
  );
}
