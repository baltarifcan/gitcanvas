import * as Dialog from '@radix-ui/react-dialog'
import { TriangleAlert } from 'lucide-react'
import type { Board } from '@gitcanvas/shared'
import { useDeleteBoard } from './useBoards'

type Props = {
  board: Board | null
  onClose: () => void
  onDeleted?: () => void
}

export function DeleteBoardConfirm({ board, onClose, onDeleted }: Props) {
  const del = useDeleteBoard()
  if (!board) return null

  const handleDelete = async () => {
    await del.mutateAsync(board.id)
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
                Delete board?
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-400">
                <span className="font-medium text-zinc-200">{board.name}</span> and everything
                on it will be removed. This can&apos;t be undone.
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
