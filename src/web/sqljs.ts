import initSqlJs, {
  type Database as SqlJsDatabase,
  type SqlJsStatic,
  type Statement as SqlJsStatement,
  type SqlValue
} from 'sql.js'
import type { SqlDriver, SqlStatement } from '../main/db/driver'

/**
 * SQLite in the browser, wearing the same face as better-sqlite3.
 *
 * sql.js is SQLite compiled to WebAssembly, so the SQL, the schema and the
 * file format are all identical to the desktop build — a `trailhead.db` moves
 * between the two untouched. What differs is the JavaScript API, so this
 * adapter translates the four methods `SqlDriver` promises into sql.js calls.
 * Nothing above this file knows which engine it is talking to.
 *
 * The whole database lives in memory while the app is open. `export()` hands
 * back the bytes to write to the user's file; see `storage.ts` for where they
 * go.
 */

let runtime: SqlJsStatic | null = null
let locateWasm: ((file: string) => string) | null = null

/**
 * Says where to fetch the SQLite WebAssembly from. The browser build points
 * this at a hashed asset beside the page — our own origin, never a CDN — and
 * the tests point it at `node_modules`. Call it before opening a database.
 */
export function configureSqlJs(locateFile: (file: string) => string): void {
  locateWasm = locateFile
}

async function loadRuntime(): Promise<SqlJsStatic> {
  if (!runtime) {
    runtime = await initSqlJs(locateWasm ? { locateFile: locateWasm } : undefined)
  }
  return runtime
}

/**
 * better-sqlite3 refuses some JavaScript values outright; sql.js accepts a
 * narrower set still. Normalizing here keeps callers from having to care.
 */
function toSqlValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Uint8Array) return value
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Works out what to hand sql.js for this call.
 *
 * Queries in `db/` bind either positionally (`?`, passed as loose arguments)
 * or by name (`@firstName`, passed as one object). sql.js wants named keys to
 * carry their prefix, which better-sqlite3 does not, so named parameters are
 * matched against the placeholders actually present in the SQL. Scanning the
 * SQL rather than the object also means an `@` inside a string literal — say
 * `'%@gmail.com'` — is skipped, because no bound value goes by that name.
 */
function bindValues(sql: string, params: unknown[]): SqlValue[] | Record<string, SqlValue> | null {
  if (params.length === 0) return null

  const first = params[0]
  const isNamed =
    params.length === 1 &&
    typeof first === 'object' &&
    first !== null &&
    !Array.isArray(first) &&
    !(first instanceof Uint8Array) &&
    !(first instanceof Date)

  if (!isNamed) return params.map(toSqlValue)

  const source = first as Record<string, unknown>
  const named: Record<string, SqlValue> = {}
  for (const match of sql.matchAll(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const [placeholder, key] = match
    if (key in source) named[placeholder] = toSqlValue(source[key])
  }
  return named
}

class WebStatement implements SqlStatement {
  private compiled: SqlJsStatement | null = null
  private compiledAt = -1

  constructor(
    private readonly owner: WebDatabase,
    private readonly sql: string
  ) {}

  /**
   * Compiles the statement on first use and reuses it afterwards. A compiled
   * statement doesn't survive the table it reads being altered, so it is
   * thrown away whenever the schema has moved on since it was prepared.
   */
  private bound(params: unknown[]): SqlJsStatement {
    if (this.compiled && this.compiledAt !== this.owner.schemaGeneration) {
      this.compiled.free()
      this.compiled = null
    }
    if (!this.compiled) {
      this.compiled = this.owner.raw.prepare(this.sql)
      this.compiledAt = this.owner.schemaGeneration
    }
    this.compiled.reset() // also clears the previous call's bindings
    const values = bindValues(this.sql, params)
    if (values) this.compiled.bind(values as never)
    return this.compiled
  }

  all(...params: unknown[]): unknown[] {
    const statement = this.bound(params)
    const rows: unknown[] = []
    while (statement.step()) rows.push(statement.getAsObject())
    statement.reset()
    return rows
  }

  get(...params: unknown[]): unknown {
    const statement = this.bound(params)
    const row = statement.step() ? statement.getAsObject() : undefined
    statement.reset() // don't leave a cursor open across the next write
    return row
  }

  run(...params: unknown[]): { changes: number } {
    const statement = this.bound(params)
    statement.step()
    statement.reset()
    this.owner.markChanged()
    return { changes: this.owner.raw.getRowsModified() }
  }
}

export class WebDatabase implements SqlDriver {
  /** Bumped by anything that might invalidate a compiled statement. */
  schemaGeneration = 0
  private savepointDepth = 0
  private onChange: (() => void) | null = null

  constructor(readonly raw: SqlJsDatabase) {}

  prepare(sql: string): SqlStatement {
    return new WebStatement(this, sql)
  }

  exec(sql: string): void {
    this.raw.exec(sql)
    // `exec` carries the DDL (CREATE, ALTER, DROP), so assume the shape of
    // the database has changed and let compiled statements recompile.
    this.schemaGeneration++
    this.markChanged()
  }

  pragma(source: string): unknown {
    // WAL and checkpointing are meaningless for an in-memory database; the
    // desktop build is the only caller that asks for them.
    if (/^\s*(journal_mode|wal_checkpoint)/i.test(source)) return null
    return this.raw.exec(`PRAGMA ${source}`)
  }

  transaction<Args extends unknown[], T>(fn: (...args: Args) => T): (...args: Args) => T {
    return (...args: Args): T => {
      // Savepoints rather than BEGIN/COMMIT so a transaction nested inside
      // another still rolls back only its own work.
      const name = `trailhead_sp_${this.savepointDepth++}`
      this.control(`SAVEPOINT ${name}`)
      try {
        const result = fn(...args)
        this.control(`RELEASE ${name}`)
        return result
      } catch (error) {
        // The importer's dry run throws on purpose to undo a trial import, so
        // this path is ordinary control flow, not just error handling.
        this.control(`ROLLBACK TO ${name}`)
        this.control(`RELEASE ${name}`)
        throw error
      } finally {
        this.savepointDepth--
      }
    }
  }

  /** Transaction bookkeeping — never changes the schema, so no generation bump. */
  private control(sql: string): void {
    this.raw.exec(sql)
  }

  /** Called whenever the database may have been written to. */
  markChanged(): void {
    this.onChange?.()
  }

  watch(listener: (() => void) | null): void {
    this.onChange = listener
  }

  /** The database as SQLite file bytes, ready to be written to disk. */
  export(): Uint8Array {
    return this.raw.export()
  }

  close(): void {
    this.onChange = null
    this.raw.close()
  }
}

/** Opens `bytes` as a database, or creates an empty one when given nothing. */
export async function openWebDatabase(bytes?: Uint8Array): Promise<WebDatabase> {
  const SQL = await loadRuntime()
  return new WebDatabase(new SQL.Database(bytes))
}
