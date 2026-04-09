import * as Dialog from '@radix-ui/react-dialog'
import { TriangleAlert } from 'lucide-react'
import type { RepoList } from '@gitcanvas/shared'
import { useDeleteRepoList } from './useRepoLists'

type Props = {
  list: RepoList | null
  onClose: () => void
  onDeleted?: () => void
}

export function DeleteRepoListConfirm({ list, onClose, onDeleted }: Props) {
  const del = useDeleteRepoList()
  if (!list) return null

  const handleDelete = async () => {
    await del.mutateAsync(list.id)
    onDeleted?.()
    onClose()
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="mb-3 flex items-start gap-3">
            <div className="rounded-full bg-red-500/10 p-2 text-red-400">
              <TriangleAlert size={18} />
            </div>
            <div>
              <Dialog.Title className="text-lg font-semibold text-zinc-100">
                Delete list?
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-400">
                <span className="font-medium text-zinc-200">{list.name}</span> will be removed.
                The {list.repoCount} {list.repoCount === 1 ? 'repository' : 'repositories'} in
                this list are not deleted, and any boards synced with it simply lose the link.
              </Dialog.Description>
            </div>
          </div>

          {del.isError && (
            <p className="mt-2 text-xs text-red-400">{(del.error as Error).message}</p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={del.isPending}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
