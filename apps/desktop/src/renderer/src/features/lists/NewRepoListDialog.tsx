import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useCreateRepoList } from './useRepoLists'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (id: string) => void
}

export function NewRepoListDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('')
  const create = useCreateRepoList()

  const reset = () => {
    setName('')
    create.reset()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || create.isPending) return
    const list = await create.mutateAsync({ name: name.trim() })
    onCreated?.(list.id)
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <Dialog.Title className="text-lg font-semibold text-zinc-100">
                New list
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-400">
                Group repositories so you can import them into boards as a unit.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X size={16} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Name</span>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Frontend apps"
                maxLength={120}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </label>

            {create.isError && (
              <p className="mt-2 text-xs text-red-400">
                {(create.error as Error).message}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
                Cancel
              </Dialog.Close>
              <button
                type="submit"
                disabled={!name.trim() || create.isPending}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {create.isPending ? 'Creating…' : 'Create list'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
