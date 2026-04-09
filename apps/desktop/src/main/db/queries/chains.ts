import { asc, eq } from 'drizzle-orm'
import { ulid } from 'ulidx'
import type { Chain } from '@gitcanvas/shared'
import { getDb } from '@main/db/client'
import { chains, type ChainRow } from '@main/db/schema'

function rowToChain(row: ChainRow): Chain {
  return {
    id: row.id,
    name: row.name,
    explorerUrlTemplate: row.explorerUrlTemplate,
    addressPattern: row.addressPattern,
    createdAt: row.createdAt,
  }
}

export function listChains(): Chain[] {
  const db = getDb()
  return db.select().from(chains).orderBy(asc(chains.name)).all().map(rowToChain)
}

export function getChain(id: string): Chain | null {
  const db = getDb()
  const row = db.select().from(chains).where(eq(chains.id, id)).get()
  return row ? rowToChain(row) : null
}

export function getChainByName(name: string): Chain | null {
  const db = getDb()
  const row = db.select().from(chains).where(eq(chains.name, name)).get()
  return row ? rowToChain(row) : null
}

export function createChain(input: {
  name: string
  explorerUrlTemplate: string
  addressPattern?: string | null
}): Chain {
  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()
  db.insert(chains)
    .values({
      id,
      name: input.name.trim(),
      explorerUrlTemplate: input.explorerUrlTemplate.trim(),
      addressPattern: input.addressPattern?.trim() || null,
      createdAt: now,
    })
    .run()
  const row = db.select().from(chains).where(eq(chains.id, id)).get()
  if (!row) throw new Error('chain insert returned no row')
  return rowToChain(row)
}

export function updateChain(
  id: string,
  patch: {
    name?: string
    explorerUrlTemplate?: string
    addressPattern?: string | null
  },
): Chain {
  const db = getDb()
  const updates: Partial<typeof chains.$inferInsert> = {}
  if (patch.name !== undefined) updates.name = patch.name.trim()
  if (patch.explorerUrlTemplate !== undefined) {
    updates.explorerUrlTemplate = patch.explorerUrlTemplate.trim()
  }
  if (patch.addressPattern !== undefined) {
    // Empty string → store as NULL so the renderer falls back to the EVM default.
    const trimmed = patch.addressPattern?.trim() ?? null
    updates.addressPattern = trimmed && trimmed.length > 0 ? trimmed : null
  }
  if (Object.keys(updates).length === 0) {
    const existing = getChain(id)
    if (!existing) throw new Error(`Chain not found: ${id}`)
    return existing
  }
  db.update(chains).set(updates).where(eq(chains.id, id)).run()
  const row = db.select().from(chains).where(eq(chains.id, id)).get()
  if (!row) throw new Error(`Chain not found after update: ${id}`)
  return rowToChain(row)
}

export function deleteChain(id: string): void {
  const db = getDb()
  db.delete(chains).where(eq(chains.id, id)).run()
}

/**
 * Idempotent insert keyed on `name`. Used by `seedDefaultChains` so we can
 * call it on every startup without duplicating rows.
 */
export function upsertChainByName(input: {
  name: string
  explorerUrlTemplate: string
}): void {
  const existing = getChainByName(input.name)
  if (existing) return
  createChain(input)
}
