import { asc, eq } from 'drizzle-orm'
import { ulid } from 'ulidx'
import type {
  DomainAnnotationData,
  RepoAnnotation,
  SmartContractAnnotationData,
} from '@gitcanvas/shared'
import { getDb } from '@main/db/client'
import { repoAnnotations, type RepoAnnotationRow } from '@main/db/schema'

function rowToAnnotation(row: RepoAnnotationRow): RepoAnnotation {
  const base = {
    id: row.id,
    repoId: row.repoId,
    branchName: row.branchName,
    createdAt: row.createdAt,
  }
  if (row.kind === 'domain') {
    return { ...base, kind: 'domain', data: row.data as DomainAnnotationData }
  }
  return { ...base, kind: 'smart_contract', data: row.data as SmartContractAnnotationData }
}

export function listByRepo(repoId: string): RepoAnnotation[] {
  const db = getDb()
  return db
    .select()
    .from(repoAnnotations)
    .where(eq(repoAnnotations.repoId, repoId))
    .orderBy(asc(repoAnnotations.createdAt))
    .all()
    .map(rowToAnnotation)
}

export function insertDomain(input: {
  repoId: string
  branchName: string | null
  data: DomainAnnotationData
}): RepoAnnotation {
  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()

  db.insert(repoAnnotations)
    .values({
      id,
      repoId: input.repoId,
      branchName: input.branchName,
      kind: 'domain',
      data: input.data as Record<string, unknown>,
      createdAt: now,
    })
    .run()

  const row = db.select().from(repoAnnotations).where(eq(repoAnnotations.id, id)).get()
  if (!row) throw new Error('annotation insert returned no row')
  return rowToAnnotation(row)
}

export function insertSmartContract(input: {
  repoId: string
  branchName: string | null
  data: SmartContractAnnotationData
}): RepoAnnotation {
  const db = getDb()
  const id = ulid()
  const now = new Date().toISOString()

  db.insert(repoAnnotations)
    .values({
      id,
      repoId: input.repoId,
      branchName: input.branchName,
      kind: 'smart_contract',
      data: input.data as Record<string, unknown>,
      createdAt: now,
    })
    .run()

  const row = db.select().from(repoAnnotations).where(eq(repoAnnotations.id, id)).get()
  if (!row) throw new Error('annotation insert returned no row')
  return rowToAnnotation(row)
}

export function deleteAnnotation(id: string): void {
  const db = getDb()
  db.delete(repoAnnotations).where(eq(repoAnnotations.id, id)).run()
}
