import type { CandidateFileEntry } from "../../../web/lib/position-document-file";

export function createCandidateFilesFixture(delayMs = 0) {
  const fixture = {
    events: [] as unknown[][],
    user: { id: "synthetic-user-a" } as { id: string } | null,
    rows: [
      {
        user_id: "synthetic-user-b",
        name: "CoverLetter_42_foreign.pdf",
        size: 8,
        updated_at: "2026-02-01T00:00:00Z",
      },
      {
        user_id: "synthetic-user-a",
        name: "CoverLetter_42_own.pdf",
        size: 8,
        updated_at: "2026-01-01T00:00:00Z",
      },
    ] as Array<CandidateFileEntry & { user_id: string }> | null,
    error: null as unknown,
    authFailure: null as unknown,
    queryFailure: null as unknown,
    client: null as any,
  };
  const wait = async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  };
  fixture.client = {
    auth: {
      async getUser() {
        fixture.events.push(["getUser"]);
        await wait();
        if (fixture.authFailure) throw fixture.authFailure;
        return { data: { user: fixture.user }, error: null };
      },
    },
    from(table: string) {
      fixture.events.push(["from", table]);
      return {
        select(columns: string) {
          fixture.events.push(["select", columns]);
          return {
            async eq(column: string, userId: string) {
              fixture.events.push(["eq", column, userId]);
              await wait();
              if (fixture.queryFailure) throw fixture.queryFailure;
              return {
                data:
                  fixture.rows?.filter((row) => row.user_id === userId) ?? null,
                error: fixture.error,
              };
            },
          };
        },
      };
    },
  };
  return fixture;
}
