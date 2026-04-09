/**
 * Backup / restore for the local SQLite database.
 *
 * Storage layout — every backup is its own folder under
 * `~/Documents/GitCanvas/backups/`:
 *
 *   ~/Documents/GitCanvas/backups/
 *     2026-04-09T20-44-30Z/          ← backup id (folder name)
 *       manifest.json                ← {@link BackupManifest}
 *       gitcanvas.db                 ← snapshot taken via SQLite online backup
 *
 * Why this shape:
 *  - One folder per backup → atomic to delete, easy to inspect, no zip dep.
 *  - The manifest carries enough metadata that an *older* GitCanvas build
 *    can recognise a *newer* backup and refuse to restore it (rather than
 *    silently corrupting the schema). Today we use the Drizzle migration
 *    journal as the schema version: a backup with migrations
 *    `[0000, 0001]` is restorable on a build that has `[0000, 0001, 0002]`
 *    — drizzle.migrate() will bring it forward — but a backup with a
 *    migration this build has never heard of is rejected.
 *  - {@link BACKUP_FORMAT_VERSION} is the manifest's *own* schema version,
 *    bumped if we ever change the manifest layout itself (e.g. multi-file
 *    backups, encryption, exported JSON dumps).
 */

import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { app } from 'electron'
import log from 'electron-log/main.js'
import { closeDb, getDbPath, getSqliteHandle, initDb } from '@main/db/client'

/**
 * Bump this when the manifest schema changes in a backwards-incompatible way.
 * Older builds reading a newer formatVersion will refuse to restore.
 */
export const BACKUP_FORMAT_VERSION = 1

export type BackupManifest = {
  /** Format version of *this manifest file*, not the app schema. */
  formatVersion: number
  /** Backup folder name — also the human-facing identifier. */
  id: string
  /** ISO-8601 timestamp the backup was taken. */
  createdAt: string
  /** Optional user label, e.g. "before refactor". */
  label?: string
  /** App package version that produced the backup. */
  appVersion: string
  /**
   * Drizzle migration tags applied to the snapshotted DB, in order. Used to
   * decide whether the current build is allowed to restore this backup.
   */
  migrations: string[]
  /** Convenience — `migrations.length`. Easier to display in the UI. */
  schemaVersion: number
  /** Filename of the snapshot inside the backup folder. */
  dbFile: string
  /** Size of the snapshot file in bytes. */
  dbBytes: number
}

/** Lightweight summary used by the listing endpoint. */
export type BackupSummary = BackupManifest & {
  /** Absolute path to the backup folder — handy for "open in Finder". */
  folderPath: string
  /** True when the manifest is unparseable or the .db file is missing. */
  corrupt?: boolean
  /** Human-readable reason set when `corrupt === true`. */
  corruptReason?: string
}

const DB_FILE = 'gitcanvas.db'
const MANIFEST_FILE = 'manifest.json'

/** `~/Documents/GitCanvas/backups` — created lazily on first use. */
export function getBackupsRoot(): string {
  return path.join(app.getPath('documents'), 'GitCanvas', 'backups')
}

/**
 * Reads the Drizzle migration journal so we know exactly which migrations
 * are baked into the *current* build. Stored on the manifest for restore-time
 * compatibility checks.
 *
 * Mirrors `resolveMigrationsFolder()` in `client.ts` — packaged builds ship
 * the migrations under `process.resourcesPath/migrations`.
 */
function readMigrationTags(): string[] {
  const migrationsFolder = app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(app.getAppPath(), 'src/main/db/migrations')
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  try {
    const raw = fs.readFileSync(journalPath, 'utf8')
    const parsed = JSON.parse(raw) as { entries?: Array<{ tag: string }> }
    return (parsed.entries ?? []).map((e) => e.tag)
  } catch (err) {
    log.warn('[backup] failed to read migration journal', err)
    return []
  }
}

/**
 * Filesystem-safe ISO timestamp: `2026-04-09T20-44-30Z`. We use this as the
 * backup folder name *and* the manifest id, so listing the directory is the
 * same as listing backups in chronological order (string sort = time sort).
 */
function makeBackupId(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Snapshot the live database into a new backup folder. Uses
 * `better-sqlite3`'s `.backup()` (SQLite's online backup API), which is safe
 * to call against an open WAL-mode database — it copies a consistent page
 * set even if writers are active.
 */
export async function createBackup(opts: { label?: string } = {}): Promise<BackupSummary> {
  const root = getBackupsRoot()
  ensureDir(root)

  const id = makeBackupId()
  const folderPath = path.join(root, id)
  // Extremely unlikely collision (1s resolution) — but be defensive.
  if (fs.existsSync(folderPath)) {
    throw new Error(`Backup folder already exists: ${folderPath}`)
  }
  ensureDir(folderPath)

  const dbDest = path.join(folderPath, DB_FILE)

  log.info(`[backup] snapshotting → ${dbDest}`)
  const handle = getSqliteHandle()
  // Best-effort WAL flush so the snapshot is as compact as possible. The
  // online backup below would also pick up WAL pages, but TRUNCATE keeps
  // the destination clean and avoids surprising file sizes.
  try {
    handle.pragma('wal_checkpoint(TRUNCATE)')
  } catch (err) {
    log.warn('[backup] wal_checkpoint failed (continuing anyway)', err)
  }
  await handle.backup(dbDest)

  const stat = await fsp.stat(dbDest)
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    id,
    createdAt: new Date().toISOString(),
    label: opts.label?.trim() || undefined,
    appVersion: app.getVersion(),
    migrations: readMigrationTags(),
    schemaVersion: readMigrationTags().length,
    dbFile: DB_FILE,
    dbBytes: stat.size,
  }
  await fsp.writeFile(
    path.join(folderPath, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2),
    'utf8',
  )

  log.info(`[backup] created ${id} (${stat.size} bytes, schemaVersion ${manifest.schemaVersion})`)
  return { ...manifest, folderPath }
}

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * Enumerates every backup folder, parses its manifest, and sorts newest-first.
 * Folders without a parseable manifest are still returned (marked corrupt) so
 * the user can find and clean them up from the UI rather than wondering where
 * they went.
 */
export async function listBackups(): Promise<BackupSummary[]> {
  const root = getBackupsRoot()
  if (!fs.existsSync(root)) return []

  const entries = await fsp.readdir(root, { withFileTypes: true })
  const out: BackupSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folderPath = path.join(root, entry.name)
    const summary = await readBackupFolder(folderPath, entry.name)
    if (summary) out.push(summary)
  }
  // Newest first — id is an ISO timestamp so a reverse string sort works.
  out.sort((a, b) => b.id.localeCompare(a.id))
  return out
}

async function readBackupFolder(
  folderPath: string,
  fallbackId: string,
): Promise<BackupSummary | null> {
  const manifestPath = path.join(folderPath, MANIFEST_FILE)
  let manifest: BackupManifest | null = null
  let corruptReason: string | undefined

  try {
    const raw = await fsp.readFile(manifestPath, 'utf8')
    manifest = JSON.parse(raw) as BackupManifest
  } catch (err) {
    corruptReason = `manifest unreadable: ${(err as Error).message}`
  }

  const dbPath = path.join(folderPath, manifest?.dbFile ?? DB_FILE)
  let dbBytes = 0
  try {
    dbBytes = (await fsp.stat(dbPath)).size
  } catch {
    corruptReason = corruptReason ?? `db file missing: ${path.basename(dbPath)}`
  }

  if (!manifest) {
    return {
      formatVersion: 0,
      id: fallbackId,
      createdAt: '',
      appVersion: '',
      migrations: [],
      schemaVersion: 0,
      dbFile: DB_FILE,
      dbBytes,
      folderPath,
      corrupt: true,
      corruptReason,
    }
  }

  return {
    ...manifest,
    folderPath,
    corrupt: corruptReason !== undefined,
    corruptReason,
  }
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restore a backup by id (folder name). Sequence:
 *
 *   1. Validate the manifest is something we can read (formatVersion check).
 *   2. Validate the migration journal: the backup's migrations must be a
 *      *prefix* of (or equal to) the current build's migrations. A backup
 *      with a migration tag we don't recognise was made by a newer build
 *      and we refuse to touch it.
 *   3. Take a "pre-restore" safety snapshot of the *current* DB so the user
 *      can roll back if the chosen backup turns out to be wrong.
 *   4. Close the live DB handle, copy the backup file over the live file,
 *      delete any leftover WAL/SHM sidecars (the snapshot is a standalone
 *      checkpointed DB), then re-open via `initDb()` — which runs any
 *      forward migrations needed to bring the older snapshot up to date.
 *
 * If anything in step 4 fails after we've closed the DB, we attempt to
 * recover by reopening whatever is currently on disk so the app isn't left
 * with no database at all.
 */
export async function restoreBackup(id: string): Promise<void> {
  const root = getBackupsRoot()
  const folderPath = path.join(root, id)
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Backup not found: ${id}`)
  }

  const summary = await readBackupFolder(folderPath, id)
  if (!summary || summary.corrupt) {
    throw new Error(`Backup is corrupt: ${summary?.corruptReason ?? 'unknown'}`)
  }
  if (summary.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Backup format v${summary.formatVersion} is newer than this build (v${BACKUP_FORMAT_VERSION}). Update GitCanvas before restoring.`,
    )
  }

  const currentMigrations = readMigrationTags()
  const unknown = summary.migrations.filter((tag) => !currentMigrations.includes(tag))
  if (unknown.length > 0) {
    throw new Error(
      `Backup contains migrations this build doesn't know: ${unknown.join(', ')}. Update GitCanvas before restoring.`,
    )
  }

  // Step 3: safety snapshot — labelled so the user can find it post-restore.
  log.info(`[backup] taking pre-restore safety snapshot before restoring ${id}`)
  await createBackup({ label: `Auto-saved before restoring ${id}` })

  // Step 4: swap files.
  const live = getDbPath()
  const sourceDb = path.join(folderPath, summary.dbFile)

  log.info(`[backup] closing live DB and restoring from ${sourceDb}`)
  closeDb()

  try {
    // Wipe any leftover WAL/SHM from the previous session — the snapshot is
    // a standalone, checkpointed DB and any stale sidecars would corrupt it.
    for (const ext of ['-wal', '-shm']) {
      const sidecar = live + ext
      if (fs.existsSync(sidecar)) {
        try {
          fs.unlinkSync(sidecar)
        } catch (err) {
          log.warn(`[backup] failed to remove ${sidecar} (continuing)`, err)
        }
      }
    }
    fs.copyFileSync(sourceDb, live)
  } catch (err) {
    log.error('[backup] file swap failed, attempting to reopen original DB', err)
    try {
      initDb()
    } catch (reopenErr) {
      log.error('[backup] reopen after failed restore ALSO failed', reopenErr)
    }
    throw err
  }

  // Reopen — this runs Drizzle migrate() which will bring an older snapshot
  // forward to the current schema if needed.
  initDb()
  log.info(`[backup] restore complete from ${id}`)
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteBackup(id: string): Promise<void> {
  const root = getBackupsRoot()
  const folderPath = path.join(root, id)
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Backup not found: ${id}`)
  }
  // Belt-and-braces: only delete folders that live *under* the backups root,
  // never follow a symlink out, never operate on the root itself.
  const resolved = path.resolve(folderPath)
  const resolvedRoot = path.resolve(root)
  if (!resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot) {
    throw new Error(`Refusing to delete path outside backups root: ${resolved}`)
  }
  await fsp.rm(resolved, { recursive: true, force: true })
  log.info(`[backup] deleted ${id}`)
}
