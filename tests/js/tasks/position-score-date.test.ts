import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScoreAssessedAt } from "../../../web/app/(protected)/positions/[id]/ScoreAssessedAt";
import { OverviewScoreBadge } from "../../../web/app/(protected)/positions/[id]/OverviewScoreBadge";
import RecentPositionsTable from "../../../web/app/components/RecentPositionsTable";
import { formatPositionEventStamp } from "../../../web/lib/position-event-stamp";
import { T } from "../../../web/app/(protected)/positions/[id]/page.i18n";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const { createElement } = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server");
const page = readFileSync(
  join(repo, "web/app/(protected)/positions/[id]/page.tsx"),
  "utf8",
);
/** «GG/MM, HH:MM» di un timbro senza fuso (UTC, come SQLite) nell'ora locale di chi legge: il fuso della macchina non conta. */
const localStamp = (utc: string) => {
  const d = new Date(`${utc}Z`);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}, ${two(d.getHours())}:${two(d.getMinutes())}`;
};

describe("data della valutazione nella pagina posizione", () => {
  it("formatta la data gia' scritta dallo Scorer senza sostituirla con altre date", () => {
    // Senza offset = UTC (come lo scrive SQLite): il contratto qui e' che venga mostrato lo STESSO istante
    // dello Scorer nell'ora locale della persona, non l'ora UTC scritta come se fosse locale.
    const scoredAt = "2026-08-12T15:24:00.000";
    const local = new Date("2026-08-12T15:24:00.000Z");
    const two = (n: number) => String(n).padStart(2, "0");

    expect(formatPositionEventStamp(scoredAt, "it")).toBe(
      `${two(local.getDate())}/${two(local.getMonth() + 1)}, ${two(local.getHours())}:${two(local.getMinutes())}`,
    );
    expect(formatPositionEventStamp("", "it")).toBeNull();
    expect(formatPositionEventStamp("non-una-data", "it")).toBeNull();
  });

  it("lega il dettaglio alla colonna scores.scored_at senza fallback", () => {
    expect(page).toContain(
      "formatPositionEventStamp(score?.scored_at, locale)",
    );
    expect(page).toContain("<ScoreAssessedAt");
    expect(page).toContain("scoredAt={score.scored_at}");
    expect(page).toContain("formatted={scoreAssessedAt}");
    expect(page).not.toMatch(
      /scoreAssessedAt\s*=\s*formatPositionEventStamp\(position\.(?:updated_at|found_at)/,
    );

    for (const locale of ["it", "en", "hu", "es", "de", "fr", "pt"]) {
      expect(T.score_assessed_at[locale as keyof typeof T.score_assessed_at])
        .toBeTypeOf("string")
        .not.toHaveLength(0);
    }
  });

  it("mostra solo il numero nella Panoramica, senza data di valutazione", () => {
    const html = renderToStaticMarkup(
      createElement(OverviewScoreBadge, { score: 71 }),
    );

    expect(html).toContain('data-overview-score=""');
    expect(html).toContain(">71</div>");
    expect(html).not.toContain("<time");
    expect(html).not.toContain(T.score_assessed_at.it);
  });

  it("mostra scored_at nel dettaglio punteggio quando il dato esiste", () => {
    const scoredAt = "2026-08-12T15:24:00.000";
    const formatted = formatPositionEventStamp(scoredAt, "it");
    const html = renderToStaticMarkup(
      createElement(ScoreAssessedAt, {
        label: T.score_assessed_at.it,
        scoredAt,
        formatted,
      }),
    );

    expect(html).toContain('data-score-assessed-at=""');
    expect(html).toContain(`dateTime="${scoredAt}"`);
    expect(html).toContain("Valutato dallo Scorer il");
    expect(html).toContain(localStamp(scoredAt));
  });

  it("conserva scored_at nella lista delle posizioni valutate", () => {
    const scoredAt = "2026-08-12T15:24:00.000";
    const html = renderToStaticMarkup(
      createElement(RecentPositionsTable, {
        rows: [
          {
            id: "position-score-date",
            legacy_id: 79,
            title: "Backend Engineer",
            company: "Example",
            location: "Remote",
            remote_type: "full_remote",
            status: "scored",
            score: 71,
            role_family: "Software Engineering",
            loc_country: null,
            loc_city: null,
            source: "test",
            salary_min: null,
            salary_max: null,
            salary_currency: "EUR",
            found_at: "2026-08-12T12:00:00.000",
            scored_at: scoredAt,
            last_action_at: scoredAt,
            last_action_by: "scorer-1",
            last_action_actor: "scorer",
            critic_score: null,
            critic_verdict: null,
          },
        ],
        labels: {
          title: "Ultime posizioni valutate",
          titleFiltered: "Posizioni filtrate",
          viewAll: "Vedi tutte",
          noPositions: "Nessuna posizione",
          unseen: "Nuova",
          colId: "ID",
          colTitle: "Posizione",
          colCompany: "Azienda",
          colCountry: "Paese",
          colCity: "Citta'",
          colScore: "Punteggio",
          colScored: "Valutata",
        },
        filtered: false,
        totalFiltered: 1,
        firstCol: "scored",
      }),
    );

    expect(html).toContain(`title="${scoredAt}"`);
    expect(html).toContain(localStamp(scoredAt));
  });

  it("non inventa una data nel dettaglio quando scored_at e' assente", () => {
    const html = renderToStaticMarkup(
      createElement(ScoreAssessedAt, {
        label: T.score_assessed_at.it,
        scoredAt: null,
        formatted: null,
      }),
    );

    expect(html).toBe("");
  });
});
