import { asc, eq } from 'drizzle-orm'
import { ulid } from 'ulidx'
import type { Repo } from '@gitcanvas/shared'
import { getDb } from '@main/db/client'
import { repos, type RepoRow } from '@main/db/schema'

function rowToRepo(row: RepoRow): Repo {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    fullName: row.fullName,
    description: row.description,
    primaryLanguage: row.primaryLanguage,
    defaultBranch: row.defaultBranch,
    localPath: row.localPath,
    topics: row.topics,
    // SQLite stores 0/1; coerce to a real JS boolean for the IPC contract.
    archived: row.archived === 1,
    createdAt: row.createdAt,
  }
}

export function listRepos(): Repo[] {
  const db = getDb()
  return db.select().from(repos).orderBy(asc(repos.fullName)).all().map(rowToRepo)
}

export function getRepo(id: string): Repo | null {
  const db = getDb()
  const row = db.select().from(repos).where(eq(repos.id, id)).get()
  return row ? rowToRepo(row) : null
}

export function getRepoByLocalPath(localPath: string): Repo | null {
  const db = getDb()
  const row = db.select().from(repos).where(eq(repos.localPath, localPath)).get()
  return row ? rowToRepo(row) : null
}

/** localPath → repoId, used to mark scan results as "already imported". */
export function getKnownLocalPaths(): Map<string, string> {
  const db = getDb()
  const rows = db.select({ id: repos.id, localPath: repos.localPath }).from(repos).all()
  const map = new Map<string, string>()
  for (const row of rows) map.set(row.localPath, row.id)
  return map
}

/**
 * Idempotent insert keyed on `local_path`. If the path is already known the
 * existing row is returned unchanged — the caller can refresh metadata
 * separately. If new, defaults are populated from the supplied hints + any
 * git remote info that was probed at import time.
 */
export function upsertLocalRepo(input: {
  localPath: string
  name: string
  ownerHint: string
  defaultBranch?: string | null
  remoteOwner?: string | null
  remoteName?: string | null
}): Repo {
  const existing = getRepoByLocalPath(input.localPath)
  if (existing) return existing

  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()

  // Prefer remote-derived owner/name when present (matches what GitHub thinks
  // the repo is called), otherwise fall back to filesystem hints.
  const owner = input.remoteOwner ?? input.ownerHint
  const name = input.remoteName ?? input.name
  const fullName = `${owner}/${name}`

  db.insert(repos)
    .values({
      id,
      owner,
      name,
      fullName,
      description: null,
      primaryLanguage: null,
      defaultBranch: input.defaultBranch ?? null,
      localPath: input.localPath,
      topics: [],
      createdAt: now,
    })
    .run()

  const row = db.select().from(repos).where(eq(repos.id, id)).get()
  if (!row) throw new Error('Repo insert returned no row')
  return rowToRepo(row)
}

export function deleteRepo(id: string): void {
  const db = getDb()
  db.delete(repos).where(eq(repos.id, id)).run()
}

/**
 * Flip the global `archived` flag on a single repo. Returns the updated row
 * so the IPC handler can hand it back to the renderer cache directly.
 */
export function setRepoArchived(id: string, archived: boolean): Repo {
  const db = getDb()
  // Write 0/1 explicitly — the column is a plain integer (see schema.ts).
  db.update(repos).set({ archived: archived ? 1 : 0 }).where(eq(repos.id, id)).run()
  const row = db.select().from(repos).where(eq(repos.id, id)).get()
  if (!row) throw new Error(`Repo ${id} not found`)
  return rowToRepo(row)
}
