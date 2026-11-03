/**
 * The slice of the better-sqlite3 API this app actually uses.
 *
 * Every query in `db/` is written against this interface, which is what lets
 * the same SQL run on both targets: the desktop build plugs in a real
 * better-sqlite3 `Database` (see `db/desktop.ts`), and the web build plugs in
 * the sql.js adapter (see `src/web/sqljs.ts`). Neither knows about the other.
 *
 * Keep it this small. Every method added here is a method the sql.js adapter
 * has to reimplement by hand.
 */
export interface SqlStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): { changes: number }
}

export interface SqlDriver {
  prepare(sql: string): SqlStatement
  exec(sql: string): void
  pragma(source: string): unknown
  /**
   * Wraps `fn` so it runs inside a transaction, as better-sqlite3 does:
   * calling the returned function begins the transaction, commits on return,
   * and rolls back if `fn` throws (the importer's dry run depends on that
   * rollback — it throws on purpose to undo a trial import).
   */
  transaction<Args extends unknown[], T>(fn: (...args: Args) => T): (...args: Args) => T
}

let driver: SqlDriver | null = null

/**
 * Hands the database to the query layer. Called once at startup by whichever
 * target is running, before any screen asks for data.
 */
export function setDbDriver(next: SqlDriver | null): void {
  driver = next
}

export function getDb(): SqlDriver {
  if (!driver) throw new Error('No database is open.')
  return driver
}

export function hasDb(): boolean {
  return driver !== null
}
