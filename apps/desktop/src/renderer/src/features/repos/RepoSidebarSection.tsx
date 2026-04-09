import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { GitBranch, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useDeleteRepo, useRepos } from './useRepos'
import { AddLocalRepoDialog } from './AddLocalRepoDialog'

/**
 * Compact sidebar section listing all known repositories. Click "+" to open
 * the AddLocalRepoDialog. Each row has a hover-revealed dropdown with a
 * Remove action that detaches the repo from any boards (cascade FK).
 */
export function RepoSidebarSection() {
  const [addOpen, setAddOpen] = useState(false)
  const repos = useRepos()
  const deleteRepo = useDeleteRepo()
  const count = repos.data?.length ?? 0

  return (
    <section className="border-t border-zinc-800 px-3 pb-3 pt-3">
      <div className="flex items-center justify-between pb-2">
        <h2 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Repositories
          {count > 0 && (
            <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
              {count}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Add local repository"
          title="Add local repository"
        >
          <Plus size={14} />
        </button>
      </div>

      {repos.isLoading && <div className="px-1 text-xs text-zinc-600">Loading…</div>}

      {!repos.isLoading && count === 0 && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-800 px-2 py-2 text-left text-[11px] text-zinc-500 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-300"
        >
          <GitBranch size={12} />
          Add a local repo
        </button>
      )}

      {count > 0 && (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
          {repos.data!.slice(0, 50).map((r) => (
            <li
              key={r.id}
              className="group flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-zinc-400 hover:bg-zinc-800/40"
              title={r.localPath}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="text-zinc-300">{r.name}</span>
                <span className="text-zinc-600"> · {r.owner}</span>
              </span>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="rounded p-0.5 text-zinc-600 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-200 data-[state=open]:opacity-100 group-hover:opacity-100"
                    aria-label={`Actions for ${r.name}`}
                  >
                    <MoreHorizontal size={11} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-[160px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 p-1 text-sm text-zinc-200 shadow-xl"
                  >
                    <DropdownMenu.Item
                      onSelect={(e) => {
                        e.preventDefault()
                        deleteRepo.mutate(r.id)
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-red-400 outline-none data-[highlighted]:bg-red-500/10"
                    >
                      <Trash2 size={12} />
                      Remove
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </li>
          ))}
          {count > 50 && (
            <li className="px-1.5 pt-1 text-[11px] text-zinc-600">+{count - 50} more</li>
          )}
        </ul>
      )}

      <AddLocalRepoDialog open={addOpen} onOpenChange={setAddOpen} />
    </section>
  )
}
