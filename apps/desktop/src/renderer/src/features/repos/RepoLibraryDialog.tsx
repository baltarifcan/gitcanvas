import { useState, useMemo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { Check, GitBranch, Search, X } from 'lucide-react'
import clsx from 'clsx'
import type { BoardNode, Position, Repo } from '@gitcanvas/shared'
import { useRepos } from './useRepos'
import { useAddRepoNode } from '@renderer/features/canvas/useBoardNodes'
import { recordNodeCreate } from '@renderer/features/canvas/historyActions'
import { getBoardHistory } from '@renderer/features/canvas/boardHistory'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  boardId: string
  /** Returns the flow-coordinate position to use as the top-left of the grid. */
  getDropOrigin: () => Position
  /** Called once per repo successfully added — used to push into local canvas state. */
  onAdded: (node: BoardNode) => void
}

const COLUMNS = 3
const COL_GUTTER = 280
const ROW_GUTTER = 130

export function RepoLibraryDialog({
  open,
  onOpenChange,
  boardId,
  getDropOrigin,
  onAdded,
}: Props) {
  const repos = useRepos()
  const addRepoNode = useAddRepoNode()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const list = repos.data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.primaryLanguage?.toLowerCase().includes(q) ?? false),
    )
  }, [repos.data, search])

  const reset = () => {
    setSearch('')
    setSelected(new Set())
    addRepoNode.reset()
  }

  const toggle = (id: string) => {
    setSelected((curr) => {
      const next = new Set(curr)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = async () => {
    if (selected.size === 0) return
    const origin = getDropOrigin()
    const ids = Array.from(selected)
    // Sequential — IPC is local and we want stable ordering. Each successful
    // add immediately materializes on the canvas via `onAdded`.
    //
    // Wrap the whole multi-add in a single history batch so one undo
    // removes every repo the user just dragged in.
    const history = getBoardHistory(boardId)
    history.beginBatch(ids.length > 1 ? `Add ${ids.length} repo nodes` : 'Add repo node')
    for (let i = 0; i < ids.length; i++) {
      const col = i % COLUMNS
      const row = Math.floor(i / COLUMNS)
      const node = await addRepoNode.mutateAsync({
        boardId,
        repoId: ids[i]!,
        position: {
          x: origin.x + col * COL_GUTTER,
          y: origin.y + row * ROW_GUTTER,
        },
      })
      onAdded(node)
      recordNodeCreate(qc, node)
    }
    history.commitBatch()
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
          <div className="flex items-start justify-between border-b border-zinc-800 px-6 pb-4 pt-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-zinc-100">
                Add repositories to board
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-400">
                Pick repos from your library. They drop onto the canvas in a small grid.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="border-b border-zinc-800 px-6 py-3">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, owner, or language…"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {repos.isLoading && (
              <div className="px-6 py-8 text-center text-xs text-zinc-500">Loading…</div>
            )}

            {!repos.isLoading && (repos.data?.length ?? 0) === 0 && (
              <div className="px-6 py-10 text-center">
                <GitBranch size={24} className="mx-auto text-zinc-600" />
                <p className="mt-3 text-sm text-zinc-300">No repositories yet</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Add some from the sidebar&apos;s <span className="text-zinc-400">Repositories</span>{' '}
                  section.
                </p>
              </div>
            )}

            {filtered.length === 0 && (repos.data?.length ?? 0) > 0 && (
              <div className="px-6 py-8 text-center text-xs text-zinc-500">
                No matches for &ldquo;{search}&rdquo;.
              </div>
            )}

            {filtered.length > 0 && (
              <ul className="divide-y divide-zinc-800">
                {filtered.map((r) => (
                  <RepoRow
                    key={r.id}
                    repo={r}
                    checked={selected.has(r.id)}
                    onToggle={() => toggle(r.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-3">
            <span className="text-xs text-zinc-500">
              {selected.size > 0 ? `${selected.size} selected` : 'Pick one or more'}
            </span>
            <div className="flex gap-2">
              <Dialog.Close className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleAdd}
                disabled={selected.size === 0 || addRepoNode.isPending}
                className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {addRepoNode.isPending
                  ? 'Adding…'
                  : `Add ${selected.size > 0 ? selected.size : ''}`.trim()}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function RepoRow({
  repo,
  checked,
  onToggle,
}: {
  repo: Repo
  checked: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <label
        className={clsx(
          'flex cursor-pointer items-center gap-3 px-6 py-2.5 text-sm transition',
          checked ? 'bg-violet-500/5' : 'hover:bg-zinc-800/40',
        )}
      >
        <span
          className={clsx(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
            checked ? 'border-violet-500 bg-violet-600' : 'border-zinc-600 bg-zinc-950',
          )}
        >
          {checked && <Check size={11} className="text-white" />}
        </span>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={onToggle}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-zinc-100">{repo.name}</span>
            <span className="truncate text-xs text-zinc-500">{repo.owner}</span>
          </div>
          {(repo.primaryLanguage || repo.localPath) && (
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
              {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
              {repo.localPath && (
                <span className="truncate" title={repo.localPath}>
                  {repo.localPath}
                </span>
              )}
            </div>
          )}
        </div>
      </label>
    </li>
  )
}
