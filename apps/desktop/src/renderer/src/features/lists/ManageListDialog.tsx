import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Search, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import type { Repo } from '@gitcanvas/shared'
import { useRepos } from '@renderer/features/repos/useRepos'
import {
  useAddRepoToList,
  useRemoveRepoFromList,
  useRepoList,
} from './useRepoLists'

type Props = {
  listId: string | null
  onClose: () => void
}

/**
 * Manage the repo membership of a single list. Two panes:
 *
 *   - Members (current repos in the list) with a Remove affordance.
 *   - Library (all repos not yet in the list), searchable + multi-select
 *     for bulk add.
 *
 * All mutations invalidate the list's cache (and any boards synced with it)
 * so the canvas reflects changes immediately.
 */
export function ManageListDialog({ listId, onClose }: Props) {
  const open = !!listId
  const list = useRepoList(listId)
  const repos = useRepos()
  const addRepo = useAddRepoToList()
  const removeRepo = useRemoveRepoFromList()

  const [search, setSearch] = useState('')
  const [stagedAdds, setStagedAdds] = useState<Set<string>>(new Set())

  const memberIds = useMemo(
    () => new Set(list.data?.repos.map((r) => r.id) ?? []),
    [list.data],
  )

  const candidates = useMemo(() => {
    const all = repos.data ?? []
    const q = search.trim().toLowerCase()
    return all
      .filter((r) => !memberIds.has(r.id))
      .filter((r) => {
        if (!q) return true
        return (
          r.fullName.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          (r.primaryLanguage?.toLowerCase().includes(q) ?? false)
        )
      })
  }, [repos.data, memberIds, search])

  const reset = () => {
    setSearch('')
    setStagedAdds(new Set())
  }

  const toggleStaged = (id: string) => {
    setStagedAdds((curr) => {
      const next = new Set(curr)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = async () => {
    if (!listId || stagedAdds.size === 0) return
    // Fire sequentially — IPC is local and the sync fan-out needs ordered
    // positions so new nodes don't stack on top of each other.
    for (const repoId of stagedAdds) {
      await addRepo.mutateAsync({ listId, repoId })
    }
    setStagedAdds(new Set())
  }

  const handleRemove = (repo: Repo) => {
    if (!listId) return
    removeRepo.mutate({ listId, repoId: repo.id })
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
          <div className="flex items-start justify-between border-b border-zinc-800 px-6 pb-4 pt-5">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold text-zinc-100">
                {list.data ? list.data.name : 'List'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-400">
                {list.data
                  ? `${list.data.repos.length} ${list.data.repos.length === 1 ? 'repo' : 'repos'} in this list`
                  : 'Loading…'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-zinc-800">
            {/* Members */}
            <div className="flex min-h-0 flex-col">
              <h3 className="border-b border-zinc-800 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Members
              </h3>
              <div className="flex-1 overflow-y-auto">
                {(list.data?.repos.length ?? 0) === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-zinc-600">
                    No repos yet. Add some from the right →
                  </div>
                )}
                <ul className="divide-y divide-zinc-800/60">
                  {list.data?.repos.map((r) => (
                    <li
                      key={r.id}
                      className="group flex items-center gap-2 px-4 py-2 text-sm hover:bg-zinc-800/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-zinc-100">{r.name}</div>
                        <div className="truncate text-[11px] text-zinc-500">
                          {r.owner}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(r)}
                        className="rounded p-1 text-zinc-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                        title="Remove from list"
                        aria-label={`Remove ${r.name} from list`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Candidates */}
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-zinc-800 px-4 py-2">
                <div className="relative">
                  <Search
                    size={12}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search repos…"
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1 pl-7 pr-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {candidates.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-zinc-600">
                    {search
                      ? `No matches for "${search}".`
                      : (repos.data?.length ?? 0) === 0
                        ? 'No repos imported yet.'
                        : 'All repos are already in this list.'}
                  </div>
                )}
                <ul className="divide-y divide-zinc-800/60">
                  {candidates.map((r) => {
                    const checked = stagedAdds.has(r.id)
                    return (
                      <li key={r.id}>
                        <label
                          className={clsx(
                            'flex cursor-pointer items-center gap-3 px-4 py-2 text-sm transition',
                            checked ? 'bg-violet-500/5' : 'hover:bg-zinc-800/40',
                          )}
                        >
                          <span
                            className={clsx(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              checked
                                ? 'border-violet-500 bg-violet-600'
                                : 'border-zinc-600 bg-zinc-950',
                            )}
                          >
                            {checked && <Check size={11} className="text-white" />}
                          </span>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => toggleStaged(r.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-zinc-100">{r.name}</div>
                            <div className="truncate text-[11px] text-zinc-500">
                              {r.owner}
                            </div>
                          </div>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-3">
            <span className="text-xs text-zinc-500">
              {stagedAdds.size > 0
                ? `${stagedAdds.size} selected to add`
                : 'Select repos on the right to add them'}
            </span>
            <div className="flex gap-2">
              <Dialog.Close className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
                Done
              </Dialog.Close>
              <button
                type="button"
                onClick={handleAdd}
                disabled={stagedAdds.size === 0 || addRepo.isPending}
                className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {addRepo.isPending
                  ? 'Adding…'
                  : `Add ${stagedAdds.size > 0 ? stagedAdds.size : ''}`.trim()}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
