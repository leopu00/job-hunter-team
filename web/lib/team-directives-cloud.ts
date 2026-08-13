export async function readTeamDirectivesForUser(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          order: (column: string, options: { ascending: boolean }) => unknown;
        };
      };
    };
  },
  userId: string,
) {
  const query = supabase
    .from("team_directives")
    .select(
      "id, body, kind, status, sort_order, created_by, created_at, updated_at, archived_at",
    )
    .eq("user_id", userId);
  const ordered = (query as any)
    .order("status", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return await ordered;
}
