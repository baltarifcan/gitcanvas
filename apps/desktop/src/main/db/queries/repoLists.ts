import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { ulid } from 'ulidx'
import type {
  CreateRepoListInput,
  Repo,
  RepoList,
  RepoListWithRepos,
  UpdateRepoListInput,
} from '@gitcanvas/shared'
import { getDb } from '@main/db/client'
import {
  boardNodes,
  boards,
  repoListItems,
  repoLists,
  repos,
  type RepoListRow,
} from '@main/db/schema'

/**
 * CRUD + membership + board-sync helpers for repository lists.
 *
 * "Sync" means: every board with `boards.synced_list_id = listId` should have
 * exactly one list-managed repo node per repo currently in the list. Manually
 * placed nodes for the same repo coexist untouched — they're distinguished by
 * `board_nodes.source_list_id` being null.
 *
 * The sync helpers are invoked from the IPC handlers whenever list membership
 * or a board↔list link changes. They use small grid offsets for placement
 * based on the existing node count so newly-added nodes stack into empty
 * canvas space rather than landing on top of each other.
 */

// Mirror RepoLibraryDialog so manual + synced flows lay out identically.
const GRID_COLUMNS = 3
const GRID_COL_GUTTER = 280
const GRID_ROW_GUTTER = 130
const GRID_ORIGIN = { x: 80, y: 80 }

function rowToList(row: RepoListRow, repoCount: number): RepoList {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repoCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function countForList(listId: string): number {
  const db = getDb()
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(repoListItems)
    .where(eq(repoListItems.listId, listId))
    .get()
  return row?.c ?? 0
}

function touchList(listId: string, now: string): void {
  const db = getDb()
  db.update(repoLists).set({ updatedAt: now }).where(eq(repoLists.id, listId)).run()
}

export function listRepoLists(): RepoList[] {
  const db = getDb()
  // One query per list for the count is fine — lists are a small cardinality
  // collection in practice (tens, not thousands). If that ever stops being
  // true we can switch to a single grouped join.
  const rows = db.select().from(repoLists).orderBy(asc(repoLists.name)).all()
  return rows.map((r) => rowToList(r, countForList(r.id)))
}

export function getRepoList(id: string): RepoListWithRepos {
  const db = getDb()
  const row = db.select().from(repoLists).where(eq(repoLists.id, id)).get()
  if (!row) {
    throw new Error(`Repo list not found: ${id}`)
  }

  // Join through repo_list_items → repos, ordered the same way as the flat
  // repo list (alphabetical by fullName) so the manage dialog is readable.
  const memberRows = db
    .select({ repo: repos })
    .from(repoListItems)
    .innerJoin(repos, eq(repoListItems.repoId, repos.id))
    .where(eq(repoListItems.listId, id))
    .orderBy(asc(repos.fullName))
    .all()

  const members: Repo[] = memberRows.map(({ repo }) => ({
    id: repo.id,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    description: repo.description,
    primaryLanguage: repo.primaryLanguage,
    defaultBranch: repo.defaultBranch,
    localPath: repo.localPath,
    topics: repo.topics,
    createdAt: repo.createdAt,
  }))

  return {
    ...rowToList(row, members.length),
    repos: members,
  }
}

export function createRepoList(input: CreateRepoListInput): RepoList {
  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()

  db.insert(repoLists)
    .values({
      id,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const row = db.select().from(repoLists).where(eq(repoLists.id, id)).get()
  if (!row) throw new Error('Repo list insert returned no row')
  return rowToList(row, 0)
}

export function updateRepoList(id: string, patch: UpdateRepoListInput): RepoList {
  const db = getDb()
  const now = new Date().toISOString()

  const updates: Partial<typeof repoLists.$inferInsert> = { updatedAt: now }
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.description !== undefined) updates.description = patch.description

  db.update(repoLists).set(updates).where(eq(repoLists.id, id)).run()

  const row = db.select().from(repoLists).where(eq(repoLists.id, id)).get()
  if (!row) {
    throw new Error(`Repo list not found after update: ${id}`)
  }
  return rowToList(row, countForList(id))
}

export function deleteRepoList(id: string): void {
  // Cascade deletes the list items; boards.synced_list_id is ON DELETE SET NULL
  // so any boards synced with this list simply lose their link. List-managed
  // nodes stay on those boards (their source_list_id FK is also SET NULL).
  const db = getDb()
  db.delete(repoLists).where(eq(repoLists.id, id)).run()
}

// ─── Membership helpers ─────────────────────────────────────────────────────

/**
 * Returns true if the repo is already in the list. Used to make add idempotent
 * (the unique index protects us either way, but we want to skip the sync step
 * when the membership didn't actually change).
 */
function isMember(listId: string, repoId: string): boolean {
  const db = getDb()
  const row = db
    .select({ id: repoListItems.id })
    .from(repoListItems)
    .where(and(eq(repoListItems.listId, listId), eq(repoListItems.repoId, repoId)))
    .get()
  return !!row
}

/**
 * Returns board ids that are currently synced to `listId`. Used to fan out
 * membership changes to all affected boards.
 */
function boardsSyncedToList(listId: string): string[] {
  const db = getDb()
  const rows = db
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.syncedListId, listId))
    .all()
  return rows.map((r) => r.id)
}

/** Repo ids already present on a board (regardless of manual vs list-managed). */
function repoIdsOnBoard(boardId: string): Set<string> {
  const db = getDb()
  const rows = db
    .select({ repoId: boardNodes.repoId })
    .from(boardNodes)
    .where(and(eq(boardNodes.boardId, boardId), eq(boardNodes.kind, 'repo')))
    .all()
  const set = new Set<string>()
  for (const r of rows) if (r.repoId) set.add(r.repoId)
  return set
}

/**
 * Position picker: places the node in a simple grid based on how many repo
 * nodes already exist on the board. Good enough for "add this list to my
 * empty board"; the user can drag them around afterwards.
 */
function nextGridPosition(boardId: string, offset = 0): { x: number; y: number } {
  const db = getDb()
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(boardNodes)
    .where(and(eq(boardNodes.boardId, boardId), eq(boardNodes.kind, 'repo')))
    .get()
  const existing = (row?.c ?? 0) + offset
  const col = existing % GRID_COLUMNS
  const rowIdx = Math.floor(existing / GRID_COLUMNS)
  return {
    x: GRID_ORIGIN.x + col * GRID_COL_GUTTER,
    y: GRID_ORIGIN.y + rowIdx * GRID_ROW_GUTTER,
  }
}

/**
 * Insert a minimal repo node for a (boardId, repoId, listId) triple. Used by
 * sync paths; caller guarantees no existing list-managed node for that repo
 * on this board already exists.
 */
function insertListManagedRepoNode(params: {
  boardId: string
  repoId: string
  listId: string
  positionOffset: number
}): void {
  const db = getDb()
  const { boardId, repoId, listId, positionOffset } = params
  const id = ulid()
  const now = new Date().toISOString()
  const position = nextGridPosition(boardId, positionOffset)

  db.insert(boardNodes)
    .values({
      id,
      boardId,
      kind: 'repo',
      repoId,
      sourceListId: listId,
      parentId: null,
      x: position.x,
      y: position.y,
      width: 260,
      height: 110,
      zIndex: 0,
      data: {},
      createdAt: now,
      updatedAt: now,
    })
    .run()

  db.update(boards).set({ updatedAt: now }).where(eq(boards.id, boardId)).run()
}

/**
 * Flip an existing (manual) node for this repo on this board into a
 * list-managed node. Used when linking a board to a list that has repos
 * already placed manually on the board — avoids creating duplicates.
 */
function claimExistingRepoNode(boardId: string, repoId: string, listId: string): boolean {
  const db = getDb()
  // Claim the first matching node only. If the user had duplicates of the
  // same repo on the board, we arbitrarily attach the list link to one of
  // them — the others stay manual.
  const existing = db
    .select({ id: boardNodes.id })
    .from(boardNodes)
    .where(
      and(
        eq(boardNodes.boardId, boardId),
        eq(boardNodes.kind, 'repo'),
        eq(boardNodes.repoId, repoId),
      ),
    )
    .get()
  if (!existing) return false
  db.update(boardNodes)
    .set({ sourceListId: listId, updatedAt: new Date().toISOString() })
    .where(eq(boardNodes.id, existing.id))
    .run()
  return true
}

export function addRepoToList(listId: string, repoId: string): void {
  if (isMember(listId, repoId)) return

  const db = getDb()
  const now = new Date().toISOString()
  db.insert(repoListItems)
    .values({
      id: ulid(),
      listId,
      repoId,
      addedAt: now,
    })
    .run()
  touchList(listId, now)

  // Sync: every synced board gains a node for this repo (if it doesn't
  // already have one — in which case we claim the existing node).
  for (const boardId of boardsSyncedToList(listId)) {
    if (claimExistingRepoNode(boardId, repoId, listId)) continue
    insertListManagedRepoNode({ boardId, repoId, listId, positionOffset: 0 })
  }
}

/**
 * Batch add — used by the import flow so we can drop many repos into a list
 * and onto synced boards in a single round-trip. Keeps grid positions unique
 * across the batch so new nodes don't stack on top of each other.
 */
export function addReposToList(listId: string, repoIds: string[]): void {
  if (repoIds.length === 0) return
  const db = getDb()
  const now = new Date().toISOString()

  // Figure out which ones are actually new so we only sync those.
  const existing = db
    .select({ repoId: repoListItems.repoId })
    .from(repoListItems)
    .where(and(eq(repoListItems.listId, listId), inArray(repoListItems.repoId, repoIds)))
    .all()
  const existingSet = new Set(existing.map((r) => r.repoId))
  const newRepoIds = repoIds.filter((id) => !existingSet.has(id))
  if (newRepoIds.length === 0) return

  const rowsToInsert = newRepoIds.map((repoId) => ({
    id: ulid(),
    listId,
    repoId,
    addedAt: now,
  }))
  db.insert(repoListItems).values(rowsToInsert).run()
  touchList(listId, now)

  for (const boardId of boardsSyncedToList(listId)) {
    let offset = 0
    for (const repoId of newRepoIds) {
      if (claimExistingRepoNode(boardId, repoId, listId)) continue
      insertListManagedRepoNode({ boardId, repoId, listId, positionOffset: offset })
      offset += 1
    }
  }
}

export function removeRepoFromList(listId: string, repoId: string): void {
  const db = getDb()
  const now = new Date().toISOString()

  const result = db
    .delete(repoListItems)
    .where(and(eq(repoListItems.listId, listId), eq(repoListItems.repoId, repoId)))
    .run()
  if (result.changes === 0) return
  touchList(listId, now)

  // Sync: drop list-managed nodes for this (boardId, repoId, listId) triple.
  // Manually-added nodes for the same repo keep source_list_id = null and
  // are left alone.
  for (const boardId of boardsSyncedToList(listId)) {
    db.delete(boardNodes)
      .where(
        and(
          eq(boardNodes.boardId, boardId),
          eq(boardNodes.repoId, repoId),
          eq(boardNodes.sourceListId, listId),
        ),
      )
      .run()
    db.update(boards).set({ updatedAt: now }).where(eq(boards.id, boardId)).run()
  }
}

// ─── Board ↔ list linking ───────────────────────────────────────────────────

export function linkBoardToList(boardId: string, listId: string): void {
  const db = getDb()
  const now = new Date().toISOString()

  // Verify both exist so we throw a readable error instead of an FK crash.
  const list = db.select().from(repoLists).where(eq(repoLists.id, listId)).get()
  if (!list) throw new Error(`Repo list not found: ${listId}`)
  const board = db.select().from(boards).where(eq(boards.id, boardId)).get()
  if (!board) throw new Error(`Board not found: ${boardId}`)

  // If the board was already synced with a different list, clear the old
  // source_list_id tags first — those nodes revert to loose/manual status
  // rather than silently switching lists under the user.
  if (board.syncedListId && board.syncedListId !== listId) {
    db.update(boardNodes)
      .set({ sourceListId: null, updatedAt: now })
      .where(
        and(eq(boardNodes.boardId, boardId), eq(boardNodes.sourceListId, board.syncedListId)),
      )
      .run()
  }

  db.update(boards).set({ syncedListId: listId, updatedAt: now }).where(eq(boards.id, boardId)).run()

  // Add nodes for every repo in the list that isn't already on the board.
  // Repos already present get their first node tagged with source_list_id
  // so subsequent list removals clean up correctly.
  const memberIds = db
    .select({ repoId: repoListItems.repoId })
    .from(repoListItems)
    .where(eq(repoListItems.listId, listId))
    .all()
    .map((r) => r.repoId)

  const existingRepoIds = repoIdsOnBoard(boardId)
  let offset = 0
  for (const repoId of memberIds) {
    if (existingRepoIds.has(repoId)) {
      claimExistingRepoNode(boardId, repoId, listId)
      continue
    }
    insertListManagedRepoNode({ boardId, repoId, listId, positionOffset: offset })
    offset += 1
  }
}

export function unlinkBoardFromList(boardId: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const board = db.select().from(boards).where(eq(boards.id, boardId)).get()
  if (!board) throw new Error(`Board not found: ${boardId}`)
  if (!board.syncedListId) return

  // Leave the existing nodes in place but clear their list tag so any
  // subsequent list mutation no longer touches them.
  db.update(boardNodes)
    .set({ sourceListId: null, updatedAt: now })
    .where(
      and(eq(boardNodes.boardId, boardId), eq(boardNodes.sourceListId, board.syncedListId)),
    )
    .run()

  db.update(boards).set({ syncedListId: null, updatedAt: now }).where(eq(boards.id, boardId)).run()
}
