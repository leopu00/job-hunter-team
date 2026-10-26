import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKUP_TEXT } from "../backup/backup.i18n";
import { EXPORT_TEXT } from "../export/export.i18n";
import { WORK_STATS_TEXT } from "./work-stats.i18n";

const LOCALES = ["it", "en", "de", "fr", "es", "pt", "hu"] as const;
// What each language calls the statistics of the working hours in the backup and export notices.
const STATS_WORD: Record<(typeof LOCALES)[number], RegExp> = {
  it: /statistiche degli orari di lavoro/,
  en: /working-hours statistics/,
  de: /Statistiken der Arbeitszeiten/,
  fr: /statistiques des horaires de travail/,
  es: /estadísticas de los horarios de trabajo/,
  pt: /estatísticas dos horários de trabalho/,
  hu: /munkaidő-statisztikák/,
};

describe("what the app says about the working-hours statistics, outside their page", () => {
  it("the backup notice says the backup holds them and the export notice says it does not, in every language", () => {
    for (const locale of LOCALES) {
      expect(BACKUP_TEXT[locale].warning, locale).toMatch(STATS_WORD[locale]);
      expect(EXPORT_TEXT[locale].personalData, locale).toMatch(STATS_WORD[locale]);
    }
  });

  it("the page says JHT sends them to no service, and the archive is only read by the statistics reader and the backup", () => {
    const never: Record<(typeof LOCALES)[number], RegExp> = {
      it: /non le invia ad alcun servizio/, en: /does not send them to any service/, de: /sendet sie an keinen Dienst/,
      fr: /ne les envoie à aucun service/, es: /no las envía a ningún servicio/, pt: /não as envia a nenhum serviço/,
      hu: /egyetlen szolgáltatásnak sem küldi el/,
    };
    for (const locale of LOCALES) {
      expect(WORK_STATS_TEXT[locale].whereLocal, locale).toMatch(never[locale]);
      expect(WORK_STATS_TEXT[locale].whereVps, locale).toMatch(never[locale]);
    }
    // the sentence is true only while this test of the data side stands
    const python = readFileSync(resolve(import.meta.dirname, "../../../../tests/test_work_stats.py"), "utf8");
    expect(python).toContain("def test_nothing_in_the_team_reads_the_archive_outside_work_stats_and_the_backup");
    expect(python).toContain("no cloud code touches the statistics");
  });
});
