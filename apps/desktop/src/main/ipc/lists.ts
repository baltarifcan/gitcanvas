import { z } from 'zod'
import { registerHandler } from '@main/ipc/util'
import * as listsQ from '@main/db/queries/repoLists'

const ulidSchema = z.string().min(10).max(40)

const createInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
})

const updateInput = z.object({
  id: ulidSchema,
  patch: z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
  }),
})

export function registerListHandlers(): void {
  registerHandler('lists.list', z.void(), () => listsQ.listRepoLists())

  registerHandler('lists.get', z.object({ id: ulidSchema }), ({ id }) => {
    return listsQ.getRepoList(id)
  })

  registerHandler('lists.create', createInput, (input) => {
    return listsQ.createRepoList(input)
  })

  registerHandler('lists.update', updateInput, ({ id, patch }) => {
    return listsQ.updateRepoList(id, patch)
  })

  registerHandler('lists.delete', z.object({ id: ulidSchema }), ({ id }) => {
    listsQ.deleteRepoList(id)
  })

  registerHandler(
    'lists.addRepo',
    z.object({ listId: ulidSchema, repoId: ulidSchema }),
    ({ listId, repoId }) => {
      listsQ.addRepoToList(listId, repoId)
    },
  )

  registerHandler(
    'lists.removeRepo',
    z.object({ listId: ulidSchema, repoId: ulidSchema }),
    ({ listId, repoId }) => {
      listsQ.removeRepoFromList(listId, repoId)
    },
  )
}
