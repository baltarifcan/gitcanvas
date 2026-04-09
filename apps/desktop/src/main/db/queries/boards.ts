import { desc, eq } from 'drizzle-orm'
import { ulid } from 'ulidx'
import type {
  Board,
  BoardWithNodes,
  CreateBoardInput,
  UpdateBoardInput,
} from '@gitcanvas/shared'
import { getDb } from '@main/db/client'
import { boards, type BoardRow } from '@main/db/schema'
import { listByBoard } from '@main/db/queries/boardNodes'

export function rowToBoard(row: BoardRow): Board {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    syncedListId: row.syncedListId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listBoards(): Board[] {
  const db = getDb()
  return db.select().from(boards).orderBy(desc(boards.updatedAt)).all().map(rowToBoard)
}

export function getBoard(id: string): BoardWithNodes {
  const db = getDb()
  const row = db.select().from(boards).where(eq(boards.id, id)).get()
  if (!row) {
    throw new Error(`Board not found: ${id}`)
  }
  return {
    ...rowToBoard(row),
    nodes: listByBoard(id),
  }
}

export function createBoard(input: CreateBoardInput): Board {
  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()

  db.insert(boards)
    .values({
      id,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  const row = db.select().from(boards).where(eq(boards.id, id)).get()
  if (!row) {
    throw new Error('Board insert returned no row')
  }
  return rowToBoard(row)
}

export function updateBoard(id: string, patch: UpdateBoardInput): Board {
  const db = getDb()
  const now = new Date().toISOString()

  const updates: Partial<typeof boards.$inferInsert> = { updatedAt: now }
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.description !== undefined) updates.description = patch.description

  db.update(boards).set(updates).where(eq(boards.id, id)).run()

  const row = db.select().from(boards).where(eq(boards.id, id)).get()
  if (!row) {
    throw new Error(`Board not found after update: ${id}`)
  }
  return rowToBoard(row)
}

export function deleteBoard(id: string): void {
  const db = getDb()
  db.delete(boards).where(eq(boards.id, id)).run()
}
