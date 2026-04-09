import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type { Database as DatabaseInstance } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import log from 'electron-log/main.js'
import * as schema from '@main/db/schema'
import { upsertChainByName } from '@main/db/queries/chains'

/**
 * Pre-`app.setName('GitCanvas')` builds wrote the database to a userData
 * folder derived from the package name (`@gitcanvas/desktop`). After we
 * tightened the display name, the new userData folder is just `GitCanvas`
 * — meaning early adopters' existing data appears to vanish on upgrade.
 *
 * This list lives outside `initDb` so it's easy to extend if we ever rename
 * again. Each entry is checked once, in order, the first time the new
 * database file is missing.
 */
const LEGACY_USERDATA_PATHS: ReadonlyArray<readonly [appData: string, ...sub: string[]]> = [
  ['@gitcanvas', 'desktop'],
]

function copyDatabase(src: string, dst: string): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  // Copy the main DB file plus any WAL/SHM sidecars so we don't lose
  // uncommitted writes.
  for (const ext of ['', '-wal', '-shm']) {
    const srcFile = src + ext
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, dst + ext)
    }
  }
}

/** Returns the boards row count, or 0 if the file is missing/corrupt/empty. */
function readBoardCount(dbFile: string): number {
  if (!fs.existsSync(dbFile)) return 0
  try {
    const db = new Database(dbFile, { readonly: true, fileMustExist: true })
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM boards').get() as
        | { c: number }
        | undefined
      return row?.c ?? 0
    } catch {
      return 0
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}

function migrateLegacyDatabase(targetDbPath: string): void {
  const appDataRoot = app.getPath('appData')
  for (const segments of LEGACY_USERDATA_PATHS) {
    const legacyDir = path.join(appDataRoot, ...segments)
    const legacyDbPath = path.join(legacyDir, 'gitcanvas.db')
    if (!fs.existsSync(legacyDbPath)) continue

    // Migration is appropriate when:
    //  (a) the new target doesn't exist at all, or
    //  (b) the new target exists but is empty (zero boards) AND the legacy
    //      DB has actual data — this catches the in-between state where the
    //      user got a fresh DB from a build that flipped userData paths
    //      before this migration shipped.
    if (fs.existsSync(targetDbPath)) {
      const targetCount = readBoardCount(targetDbPath)
      const legacyCount = readBoardCount(legacyDbPath)
      if (targetCount > 0 || legacyCount === 0) return
      log.info(
        `[db] target DB is empty (0 boards), legacy has ${legacyCount} — restoring from legacy`,
      )
    } else {
      log.info(`[db] migrating legacy database from ${legacyDbPath} → ${targetDbPath}`)
    }

    copyDatabase(legacyDbPath, targetDbPath)
    return
  }
}

export type DB = BetterSQLite3Database<typeof schema>

let dbInstance: DB | null = null
let sqliteHandle: DatabaseInstance | null = null

/**
 * Resolves the directory containing migration SQL files.
 *
 * - In development, the migrations live in source at `src/main/db/migrations`.
 *   `app.getAppPath()` returns the desktop package root, so we resolve relative
 *   to that and Drizzle reads them off disk directly.
 * - In a packaged build (Phase 5), the migrations folder is shipped via
 *   `electron-builder.yml extraResources` and lands at `process.resourcesPath`.
 */
function resolveMigrationsFolder(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'migrations')
  }
  return path.join(app.getAppPath(), 'src/main/db/migrations')
}

/**
 * Opens (and lazily creates) the SQLite database, applies pending migrations,
 * and returns the Drizzle handle. Idempotent — call freely from anywhere
 * after `initDb()` has run once during app startup.
 */
export function initDb(): DB {
  if (dbInstance) return dbInstance

  const userDataDir = app.getPath('userData')
  fs.mkdirSync(userDataDir, { recursive: true })
  const dbPath = path.join(userDataDir, 'gitcanvas.db')

  // Move data over from any pre-rename userData folder before we open it.
  migrateLegacyDatabase(dbPath)

  log.info(`[db] opening SQLite at ${dbPath}`)
  sqliteHandle = new Database(dbPath)
  sqliteHandle.pragma('journal_mode = WAL')
  sqliteHandle.pragma('synchronous = NORMAL')

  dbInstance = drizzle(sqliteHandle, { schema })

  const migrationsFolder = resolveMigrationsFolder()
  log.info(`[db] running migrations from ${migrationsFolder}`)

  // FK enforcement is disabled during migrations because table rebuilds
  // (CREATE __new_x → INSERT → DROP → RENAME) would otherwise trip cascade
  // checks against old table references. SQLite's PRAGMA can't be toggled
  // inside a transaction, and drizzle's migrate() runs each migration in
  // one — so we toggle it at the connection level here, with FK ON applied
  // immediately afterwards for the rest of the app's lifetime.
  sqliteHandle.pragma('foreign_keys = OFF')
  migrate(dbInstance, { migrationsFolder })
  sqliteHandle.pragma('foreign_keys = ON')

  // Seed default chains on first run. The upsert is keyed on chain name so
  // re-running this on every startup is harmless.
  seedDefaultChains()

  log.info('[db] ready')
  return dbInstance
}

/**
 * Inserts a starter set of well-known chains the first time the DB exists.
 * Each entry uses `{address}` as the placeholder for substitution at link
 * render time. The user can edit / delete / extend this list from the
 * Settings dialog later.
 *
 * The static import of `upsertChainByName` creates a circular dependency
 * with `@main/db/queries/chains` (which imports `getDb` from this module).
 * That's safe because both modules only use each other at function-call
 * time, not at top-level evaluation — ESM live bindings resolve this.
 */
function seedDefaultChains(): void {
  const defaults: Array<{ name: string; explorerUrlTemplate: string }> = [
    { name: 'ethereum', explorerUrlTemplate: 'https://etherscan.io/address/{address}' },
    { name: 'polygon', explorerUrlTemplate: 'https://polygonscan.com/address/{address}' },
    { name: 'base', explorerUrlTemplate: 'https://basescan.org/address/{address}' },
    { name: 'arbitrum', explorerUrlTemplate: 'https://arbiscan.io/address/{address}' },
    { name: 'optimism', explorerUrlTemplate: 'https://optimistic.etherscan.io/address/{address}' },
    { name: 'bsc', explorerUrlTemplate: 'https://bscscan.com/address/{address}' },
    { name: 'avalanche', explorerUrlTemplate: 'https://snowtrace.io/address/{address}' },
    { name: 'sepolia', explorerUrlTemplate: 'https://sepolia.etherscan.io/address/{address}' },
  ]

  for (const c of defaults) {
    try {
      upsertChainByName(c)
    } catch (err) {
      log.warn(`[db] failed to seed default chain ${c.name}`, err)
    }
  }
}

export function getDb(): DB {
  if (!dbInstance) {
    throw new Error('Database not initialized — call initDb() during app startup')
  }
  return dbInstance
}

/**
 * Returns the raw better-sqlite3 handle. Used by the backup module to drive
 * SQLite's online backup API (`db.backup(dest)`), which can safely snapshot
 * a live, open database — including any uncommitted writes still in the WAL —
 * without taking down the app.
 */
export function getSqliteHandle(): DatabaseInstance {
  if (!sqliteHandle) {
    throw new Error('Database not initialized — call initDb() during app startup')
  }
  return sqliteHandle
}

/** Absolute path to the live SQLite file — handy for the backup module. */
export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'gitcanvas.db')
}

export function closeDb(): void {
  if (sqliteHandle) {
    sqliteHandle.close()
    sqliteHandle = null
    dbInstance = null
    log.info('[db] closed')
  }
}
