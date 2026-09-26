/**
 * Stand-in for the better-sqlite3 package. The web's routes open SQLite only
 * on their local branch, which the desktop never takes (deploy-mode.ts says
 * "cloud", local-token.ts says no token): opening a database here is a bug,
 * and says so. The types are loose on purpose: they only have to let the
 * web's local branches type-check, never to describe a database that runs.
 */
interface SqliteDatabase {
  prepare<P = any, R = any>(sql: string): any;
  [member: string]: any;
}

class SqliteStandIn {
  constructor(..._args: unknown[]) {
    throw new Error("better-sqlite3: the local SQLite workspace is not available in the desktop");
  }
}

interface SqliteStandIn extends SqliteDatabase {}

declare namespace SqliteStandIn {
  export type Database = SqliteDatabase;
  export type Statement<P = any, R = any> = any;
  export type Options = Record<string, unknown>;
}

// `import("better-sqlite3").Database`, as some routes write it.
export type Database = SqliteDatabase;

export default SqliteStandIn;
