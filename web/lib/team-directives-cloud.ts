export type TeamDirectivesQueryResult = { data: unknown; error: unknown };

export interface TeamDirectivesOrderQuery extends PromiseLike<TeamDirectivesQueryResult> {
  order(
    column: string,
    options: { ascending: boolean },
  ): TeamDirectivesOrderQuery;
}

export interface TeamDirectivesReader {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): TeamDirectivesOrderQuery;
    };
  };
}

export async function readTeamDirectivesForUser(
  // Supabase's generated relation type is recursive enough to exceed the
  // compiler expansion budget at callers. This seam deliberately validates
  // only the query operations it uses and returns the provider result.
  supabase: TeamDirectivesReader,
  userId: string,
) {
  const query = supabase
    .from("team_directives")
    .select(
      "id, body, kind, status, sort_order, created_by, created_at, updated_at, archived_at",
    )
    .eq("user_id", userId);
  const ordered = query
    .order("status", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return await ordered;
}

export function validateDirectiveMutationResult(
  data: unknown,
  expected: { requestId: string; action: string; id?: number },
): {
  id: number;
  status: "queued";
  request_id: string;
  action: string;
} | null {
  if (!data || typeof data !== "object") return null;
  const value = data as {
    id?: unknown;
    status?: unknown;
    request_id?: unknown;
    action?: unknown;
  };
  if (!Number.isInteger(value.id) || Number(value.id) <= 0) return null;
  if (value.status !== "queued") return null;
  if (
    value.request_id !== expected.requestId ||
    value.action !== expected.action ||
    (expected.id !== undefined && Number(value.id) !== expected.id)
  ) {
    return null;
  }
  return {
    id: Number(value.id),
    status: "queued",
    request_id: expected.requestId,
    action: expected.action,
  };
}
