/** Read helper for additive SQLite schema changes during rolling upgrades. */

export type SqliteReadConnection = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
  };
};

export function hasSqliteColumn(
  db: SqliteReadConnection,
  table: string,
  column: string,
): boolean {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).some((row) => row.name === column);
}

const hasColumn = hasSqliteColumn;

/**
 * Reads a table while omitting explicitly additive columns that an older
 * on-disk schema may not have yet. Other missing columns still fail loudly.
 */
export function readSqliteTableCompatible<T>(
  db: SqliteReadConnection,
  table: string,
  columns: string[],
  additiveColumns: ReadonlySet<string>,
): T[] {
  const available = columns.filter(
    (column) => !additiveColumns.has(column) || hasColumn(db, table, column),
  );
  return db
    .prepare(`SELECT ${available.join(", ")} FROM ${table}`)
    .all() as T[];
}
