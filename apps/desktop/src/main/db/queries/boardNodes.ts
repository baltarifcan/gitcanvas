import { asc, eq } from 'drizzle-orm'
import { ulid } from 'ulidx'
import type {
  BoardNode,
  GroupBoardNode,
  GroupNodeData,
  NoteBoardNode,
  NoteNodeData,
  Position,
  RepoBoardNode,
  RepoNodeData,
  UpdateNodePatch,
} from '@gitcanvas/shared'
import { getDb } from '@main/db/client'
import { boardNodes, boards, type BoardNodeRow } from '@main/db/schema'

/** Default sizes when creating new nodes — tuned for the React Flow canvas. */
const DEFAULT_NOTE_SIZE = { width: 240, height: 140 }
const DEFAULT_GROUP_SIZE = { width: 380, height: 240 }
const DEFAULT_REPO_SIZE = { width: 260, height: 110 }

/**
 * Maps a raw `board_nodes` row to the discriminated `BoardNode` union exposed
 * over IPC. The discriminator is `kind`; we trust the column constraints in
 * the schema and cast `data` accordingly.
 */
function rowToNode(row: BoardNodeRow): BoardNode {
  const base = {
    id: row.id,
    boardId: row.boardId,
    parentId: row.parentId,
    position: { x: row.x, y: row.y },
    size: { width: row.width, height: row.height },
    zIndex: row.zIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }

  switch (row.kind) {
    case 'repo': {
      if (!row.repoId) {
        throw new Error(`board_node ${row.id} has kind=repo but no repo_id`)
      }
      // Read the persisted RepoNodeData (visibleBranches/branchColors/etc).
      // The previous implementation hardcoded `data: {}` here which silently
      // wiped any per-node configuration on every reload.
      const node: RepoBoardNode = {
        ...base,
        kind: 'repo',
        repoId: row.repoId,
        sourceListId: row.sourceListId ?? null,
        data: row.data as RepoNodeData,
      }
      return node
    }
    case 'note': {
      const node: NoteBoardNode = {
        ...base,
        kind: 'note',
        repoId: null,
        data: row.data as NoteNodeData,
      }
      return node
    }
    case 'group': {
      const node: GroupBoardNode = {
        ...base,
        kind: 'group',
        repoId: null,
        data: row.data as GroupNodeData,
      }
      return node
    }
    default: {
      const exhaustive: never = row.kind
      throw new Error(`Unknown board_node kind: ${exhaustive}`)
    }
  }
}

/** Touch the parent board's updatedAt — keeps the sidebar ordering fresh. */
function touchBoard(boardId: string, now: string): void {
  const db = getDb()
  db.update(boards).set({ updatedAt: now }).where(eq(boards.id, boardId)).run()
}

export function listByBoard(boardId: string): BoardNode[] {
  const db = getDb()
  return db
    .select()
    .from(boardNodes)
    .where(eq(boardNodes.boardId, boardId))
    .orderBy(asc(boardNodes.createdAt))
    .all()
    .map(rowToNode)
}


export function getBoardNode(id: string): BoardNode | null {
  const db = getDb()
  const row = db.select().from(boardNodes).where(eq(boardNodes.id, id)).get()
  return row ? rowToNode(row) : null
}

export function insertNoteNode(input: {
  boardId: string
  position: Position
  data: NoteNodeData
  parentId?: string | null
}): BoardNode {
  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()

  db.insert(boardNodes)
    .values({
      id,
      boardId: input.boardId,
      kind: 'note',
      repoId: null,
      parentId: input.parentId ?? null,
      x: input.position.x,
      y: input.position.y,
      width: DEFAULT_NOTE_SIZE.width,
      height: DEFAULT_NOTE_SIZE.height,
      zIndex: 0,
      data: input.data,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  touchBoard(input.boardId, now)
  return getBoardNodeOrThrow(id)
}

export function insertGroupNode(input: {
  boardId: string
  position: Position
  data: GroupNodeData
  parentId?: string | null
}): BoardNode {
  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()

  db.insert(boardNodes)
    .values({
      id,
      boardId: input.boardId,
      kind: 'group',
      repoId: null,
      parentId: input.parentId ?? null,
      x: input.position.x,
      y: input.position.y,
      width: DEFAULT_GROUP_SIZE.width,
      height: DEFAULT_GROUP_SIZE.height,
      // Group containers sit behind the nodes they contain.
      zIndex: -1,
      data: input.data,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  touchBoard(input.boardId, now)
  return getBoardNodeOrThrow(id)
}

export function insertRepoNode(input: {
  boardId: string
  repoId: string
  position: Position
  parentId?: string | null
  /** When set, marks the node as list-managed (see Board/RepoList sync). */
  sourceListId?: string | null
}): BoardNode {
  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()

  db.insert(boardNodes)
    .values({
      id,
      boardId: input.boardId,
      kind: 'repo',
      repoId: input.repoId,
      sourceListId: input.sourceListId ?? null,
      parentId: input.parentId ?? null,
      x: input.position.x,
      y: input.position.y,
      width: DEFAULT_REPO_SIZE.width,
      height: DEFAULT_REPO_SIZE.height,
      zIndex: 0,
      data: {},
      createdAt: now,
      updatedAt: now,
    })
    .run()

  touchBoard(input.boardId, now)
  return getBoardNodeOrThrow(id)
}

export function updateBoardNode(id: string, patch: UpdateNodePatch): BoardNode {
  const db = getDb()
  const now = new Date().toISOString()

  const updates: Partial<typeof boardNodes.$inferInsert> = { updatedAt: now }
  if (patch.position) {
    updates.x = patch.position.x
    updates.y = patch.position.y
  }
  if (patch.size) {
    updates.width = patch.size.width
    updates.height = patch.size.height
  }
  if (patch.parentId !== undefined) updates.parentId = patch.parentId
  if (patch.zIndex !== undefined) updates.zIndex = patch.zIndex
  if (patch.data !== undefined) updates.data = patch.data as Record<string, unknown>

  db.update(boardNodes).set(updates).where(eq(boardNodes.id, id)).run()

  const row = db.select().from(boardNodes).where(eq(boardNodes.id, id)).get()
  if (!row) {
    throw new Error(`Board node not found after update: ${id}`)
  }
  touchBoard(row.boardId, now)
  return rowToNode(row)
}

export function deleteBoardNode(id: string): void {
  const db = getDb()
  const row = db.select().from(boardNodes).where(eq(boardNodes.id, id)).get()
  if (!row) return
  db.delete(boardNodes).where(eq(boardNodes.id, id)).run()
  touchBoard(row.boardId, new Date().toISOString())
}

function getBoardNodeOrThrow(id: string): BoardNode {
  const node = getBoardNode(id)
  if (!node) {
    throw new Error(`Board node insert returned no row: ${id}`)
  }
  return node
}
