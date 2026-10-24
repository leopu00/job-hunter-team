import { describe, expect, it } from "vitest";
import { BACKUP_TEXT } from "./backup/backup.i18n";
import { EXPORT_TEXT } from "./export/export.i18n";
import { TEAM_SETTINGS_TEXT } from "./team-settings/team-settings.i18n";

// Portuguese of Portugal says «equipa»; «equipe» is the Brazilian spelling and sat in two pages
// while the rest of the app said «equipa».
describe("the Portuguese texts of the settings pages", () => {
  it.each([
    ["export", EXPORT_TEXT],
    ["team settings", TEAM_SETTINGS_TEXT],
    ["backup", BACKUP_TEXT],
  ])("write «equipa», never «equipe» (%s)", (_, texts) => {
    const text = JSON.stringify(texts.pt);
    expect(text).toMatch(/equipa/i);
    expect(text).not.toMatch(/equipe/i);
  });
});
