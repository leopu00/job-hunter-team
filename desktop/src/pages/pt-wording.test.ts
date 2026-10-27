// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BACKUP_TEXT } from "./backup/backup.i18n";
import { EXPORT_TEXT } from "./export/export.i18n";
import { TEAM_SETTINGS_TEXT } from "./team-settings/team-settings.i18n";
import { WORK_HOURS_TEXT } from "./work-hours/work-hours.i18n";
import { WORK_STATS_TEXT } from "./work-hours/work-stats.i18n";

// Portuguese of Portugal says «equipa»; «equipe» is the Brazilian spelling and sat in four pages
// while the rest of the app said «equipa».
describe("the Portuguese texts of the settings pages", () => {
  it.each([
    ["export", EXPORT_TEXT],
    ["team settings", TEAM_SETTINGS_TEXT],
    ["backup", BACKUP_TEXT],
    ["work hours", WORK_HOURS_TEXT],
    ["work stats", WORK_STATS_TEXT],
  ])("write «equipa», never «equipe» (%s)", (_, texts) => {
    const text = JSON.stringify(texts.pt);
    expect(text).toMatch(/equipa/i);
    expect(text).not.toMatch(/equipe/i);
  });
});

// The error catalog and the assistant guide keep their Portuguese in files of their own; a scan of the
// app's sources covers them and whatever comes next (French writes «équipe», with its accent).
describe("the app's sources", () => {
  it("never write «equipe» without its accent", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      });
    const offenders = walk(root).filter((file) => /\bequipe\b/i.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });
});

// The app reuses the web's pages (the ones behind the login, the shared components and lib), and
// the CLI and the Telegram bot read shared/locales/pt.json. Their Portuguese is that of Portugal
// too: these are Brazilian words no other language of the app writes, and each has a word of its own
// in the Portuguese of the rest of the app (the site's public pages are not in this list).
describe("the web pages the app reuses, and the CLI texts", () => {
  // \b does not see the end of «você»: letters are told by their Unicode property instead
  const BRAZILIAN = /(?<!\p{L})(equipes?|vocês?|carregando|salvando|excluindo|contêineres?|provedor(?:es)?|baixar|usuários?|seções?|solicitação|solicitações|contatos?|aplicativos?|banco de dados|exibid[ao]s?)(?!\p{L})/iu;
  const web = fileURLToPath(new URL("../../../web/", import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return /^(landing|demo|node_modules)$/.test(name) ? [] : walk(path);
      return /\.tsx?$/.test(name) && !/\.(test|d)\.tsx?$/.test(name) ? [path] : [];
    });

  it("write the Portuguese of Portugal", () => {
    const files = ["app/(protected)", "app/components", "lib"].flatMap((dir) => walk(join(web, dir)))
      .filter((file) => !file.includes(join("lib", "demo")));
    const offenders = files.flatMap((file) =>
      readFileSync(file, "utf-8").split("\n")
        .map((line, index) => ({ line, at: `${file.slice(web.length)}:${index + 1}` }))
        // a code comment is the team's own Italian: «contato» is its «counted»
        .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line) && BRAZILIAN.test(line))
        .map(({ at }) => at));
    expect(offenders).toEqual([]);
  });

  it("keep shared/locales/pt.json in it as well", () => {
    const texts = JSON.parse(readFileSync(join(web, "../shared/locales/pt.json"), "utf-8")) as Record<string, unknown>;
    const offenders = Object.entries(texts)
      .filter(([, text]) => typeof text === "string" && (BRAZILIAN.test(text) || /\b(salvo|arquivo|seu|sua|seus|suas)\b/i.test(text.replace(/\b(o|a|os|as|do|da|dos|das|no|na|ao|pelo|pela|um|uma) (seu|sua|seus|suas)\b/gi, ""))))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
