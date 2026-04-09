import path from 'node:path'
import { z } from 'zod'
import log from 'electron-log/main.js'
import type { Repo } from '@gitcanvas/shared'
import { registerHandler } from '@main/ipc/util'
import * as reposQ from '@main/db/queries/repos'
import * as listsQ from '@main/db/queries/repoLists'
import { isLocalGitRepo, scanForLocalRepos } from '@main/git/scan'
import {
  getLocalGitStatus,
  getLocalRepoMetadata,
  parseRemoteOwnerName,
} from '@main/git/status'
import { getBranchStatuses } from '@main/git/branches'

const ulidSchema = z.string().min(10).max(40)
const folderPathSchema = z.string().min(1).max(2048)

/**
 * Single-folder import path used by both `addLocal` and `addLocalBatch`. It
 * resolves the absolute path, validates it's a git repo, probes metadata via
 * `simple-git`, and idempotently upserts a row in `repos`.
 */
async function importLocalPath(folderPath: string): Promise<Repo> {
  const absPath = path.resolve(folderPath)

  if (!(await isLocalGitRepo(absPath))) {
    throw new Error(`Not a git repository: ${absPath}`)
  }

  const metadata = await getLocalRepoMetadata(absPath)
  const remote = parseRemoteOwnerName(metadata.remoteUrl)

  return reposQ.upsertLocalRepo({
    localPath: absPath,
    name: path.basename(absPath),
    ownerHint: path.basename(path.dirname(absPath)),
    defaultBranch: metadata.defaultBranch,
    remoteOwner: remote?.owner ?? null,
    remoteName: remote?.name ?? null,
  })
}

export function registerRepoHandlers(): void {
  registerHandler('repos.list', z.void(), () => reposQ.listRepos())

  registerHandler('repos.get', z.object({ id: ulidSchema }), ({ id }) => {
    return reposQ.getRepo(id)
  })

  registerHandler(
    'repos.addLocal',
    z.object({ folderPath: folderPathSchema }),
    async ({ folderPath }) => importLocalPath(folderPath),
  )

  registerHandler(
    'repos.addLocalBatch',
    z.object({
      folderPaths: z.array(folderPathSchema).max(500),
      listId: ulidSchema.optional(),
    }),
    async ({ folderPaths, listId }) => {
      const imported: Repo[] = []
      for (const p of folderPaths) {
        try {
          imported.push(await importLocalPath(p))
        } catch (err) {
          // Don't fail the whole batch if one repo turns out to be broken —
          // skip + log + continue. The renderer surfaces success counts.
          log.warn(`[repos] addLocalBatch failed to import ${p}`, err)
        }
      }
      // Optional: funnel the successfully-imported repos into a named list.
      // This also fans out to any boards currently synced with that list,
      // mirroring the standalone `lists.addRepo` flow.
      if (listId && imported.length > 0) {
        try {
          listsQ.addReposToList(
            listId,
            imported.map((r) => r.id),
          )
        } catch (err) {
          log.warn(`[repos] addLocalBatch failed to add to list ${listId}`, err)
        }
      }
      return imported
    },
  )

  registerHandler(
    'repos.scanLocal',
    z.object({
      parentPath: folderPathSchema,
      respectGitignore: z.boolean().optional(),
    }),
    async ({ parentPath, respectGitignore }) => {
      const discovered = await scanForLocalRepos(path.resolve(parentPath), {
        respectGitignore,
      })
      // Annotate with existingRepoId so the UI can mark already-imported rows.
      const known = reposQ.getKnownLocalPaths()
      return discovered.map((d) => ({
        ...d,
        existingRepoId: known.get(d.absolutePath) ?? null,
      }))
    },
  )

  registerHandler(
    'repos.localStatus',
    z.object({ repoId: ulidSchema }),
    async ({ repoId }) => {
      const repo = reposQ.getRepo(repoId)
      if (!repo) throw new Error(`Repo ${repoId} not found`)
      return getLocalGitStatus(repo.localPath)
    },
  )

  registerHandler(
    'repos.branches',
    z.object({ repoId: ulidSchema }),
    async ({ repoId }) => {
      const repo = reposQ.getRepo(repoId)
      if (!repo) throw new Error(`Repo ${repoId} not found`)
      return getBranchStatuses(repo.localPath)
    },
  )

  registerHandler('repos.delete', z.object({ id: ulidSchema }), ({ id }) => {
    reposQ.deleteRepo(id)
  })
}
