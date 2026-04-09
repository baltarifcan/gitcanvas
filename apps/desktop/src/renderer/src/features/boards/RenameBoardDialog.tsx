import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { Board } from '@gitcanvas/shared'
import { useUpdateBoard } from './useBoards'

type Props = {
  board: Board | null
  onClose: () => void
}

export function RenameBoardDialog({ board, onClose }: Props) {
  const update = useUpdateBoard()
  const [name, setName] = useState('')

  useEffect(() => {
    if (board) {
      setName(board.name)
      update.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id])

  if (!board) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === board.name) {
      onClose()
      return
    }
    await update.mutateAsync({ id: board.id, patch: { name: trimmed } })
    onClose()
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="mb-4 flex items-start justify-between">
            <Dialog.Title className="text-lg font-semibold text-zinc-100">
              Rename board
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X size={16} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit}>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
            />

            {update.isError && (
              <p className="mt-2 text-xs text-red-400">{(update.error as Error).message}</p>
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
                type="submit"
                disabled={!name.trim() || update.isPending}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {update.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
