import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(
  path.resolve(HERE, "../../../supabase/migrations/070_user_settings.sql"),
  "utf8",
);

describe("user_settings migration v1", () => {
  it("espone soltanto ownership, tema e timestamp", () => {
    const tableBody = MIGRATION.match(
      /create table if not exists public\.user_settings\s*\(([\s\S]*?)\n\);/i,
    )?.[1];

    expect(tableBody).toBeTruthy();
    expect(tableBody).toMatch(/user_id\s+uuid\s+primary key/i);
    expect(tableBody).toMatch(/theme\s+text\s+not null/i);
    expect(tableBody).toMatch(/updated_at\s+timestamptz\s+not null/i);
    expect(tableBody).not.toMatch(/language|locale|currency|columns|sidebar/i);
  });

  it("limita l'enum a dark, light e system", () => {
    expect(MIGRATION).toMatch(
      /check\s*\(theme in \('dark', 'light', 'system'\)\)/i,
    );
  });

  it("abilita RLS owner-only in lettura e scrittura", () => {
    expect(MIGRATION).toMatch(
      /alter table public\.user_settings enable row level security/i,
    );
    expect(MIGRATION).toMatch(/for all/i);
    expect(MIGRATION).toMatch(
      /using\s*\(\(select auth\.uid\(\)\) = user_id\)/i,
    );
    expect(MIGRATION).toMatch(
      /with check\s*\(\(select auth\.uid\(\)\) = user_id\)/i,
    );
    expect(MIGRATION).not.toMatch(/service_role|security definer/i);
  });

  it("affida updated_at al trigger condiviso del database", () => {
    expect(MIGRATION).toMatch(/updated_at timestamptz not null default now\(\)/i);
    expect(MIGRATION).toMatch(
      /before update on public\.user_settings[\s\S]*execute function public\.update_updated_at\(\)/i,
    );
  });
});
