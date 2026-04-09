import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { FolderTree, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import type { RepoList } from '@gitcanvas/shared'
import { useRepoLists, useUpdateRepoList } from './useRepoLists'
import { ManageListDialog } from './ManageListDialog'
import { NewRepoListDialog } from './NewRepoListDialog'
import { DeleteRepoListConfirm } from './DeleteRepoListConfirm'

/**
 * Sidebar section listing all org-level repo lists. Sits between Boards and
 * Repositories. Click the "+" to create a new list; click a row to open the
 * manage dialog for that list; hover for rename/delete.
 */
export function RepoListSidebarSection() {
  const lists = useRepoLists()
  const updateList = useUpdateRepoList()

  const [managingId, setManagingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<RepoList | null>(null)

  const count = lists.data?.length ?? 0

  const startRename = (list: RepoList) => {
    setRenamingId(list.id)
    setRenamingValue(list.name)
  }

  const commitRename = async () => {
    if (!renamingId) return
    const name = renamingValue.trim()
    if (name) {
      await updateList.mutateAsync({ id: renamingId, patch: { name } })
    }
    setRenamingId(null)
    setRenamingValue('')
  }

  return (
    <section className="border-t border-zinc-800 px-3 pb-3 pt-3">
      <div className="flex items-center justify-between pb-2">
        <h2 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Lists
          {count > 0 && (
            <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400">
              {count}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="New list"
          title="New list"
        >
          <Plus size={14} />
        </button>
      </div>

      {lists.isLoading && <div className="px-1 text-xs text-zinc-600">Loading…</div>}

      {!lists.isLoading && count === 0 && (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-800 px-2 py-2 text-left text-[11px] text-zinc-500 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-300"
        >
          <FolderTree size={12} />
          Create your first list
        </button>
      )}

      {count > 0 && (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
          {lists.data!.map((l) => {
            const isRenaming = renamingId === l.id
            return (
              <li
                key={l.id}
                className="group flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-zinc-400 hover:bg-zinc-800/40"
              >
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renamingValue}
                    onChange={(e) => setRenamingValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') {
                        setRenamingId(null)
                        setRenamingValue('')
                      }
                    }}
                    className="min-w-0 flex-1 rounded bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100 outline-none ring-1 ring-violet-500"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setManagingId(l.id)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={l.description ?? ''}
                  >
                    <FolderTree
                      size={11}
                      className="mr-1 inline-block text-zinc-600"
                    />
                    <span className="text-zinc-300">{l.name}</span>
                    <span className="text-zinc-600"> · {l.repoCount}</span>
                  </button>
                )}

                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="rounded p-0.5 text-zinc-600 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-200 data-[state=open]:opacity-100 group-hover:opacity-100"
                      aria-label={`Actions for ${l.name}`}
                    >
                      <MoreHorizontal size={11} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="end"
                      sideOffset={4}
                      className="z-50 min-w-[180px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 p-1 text-sm text-zinc-200 shadow-xl"
                    >
                      <DropdownMenu.Item
                        onSelect={(e) => {
                          e.preventDefault()
                          setManagingId(l.id)
                        }}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-zinc-800"
                      >
                        <FolderTree size={12} />
                        Manage repos…
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={(e) => {
                          e.preventDefault()
                          startRename(l)
                        }}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-zinc-800"
                      >
                        <Pencil size={12} />
                        Rename
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="my-1 h-px bg-zinc-800" />
                      <DropdownMenu.Item
                        onSelect={(e) => {
                          e.preventDefault()
                          setDeleting(l)
                        }}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-red-400 outline-none data-[highlighted]:bg-red-500/10"
                      >
                        <Trash2 size={12} />
                        Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </li>
            )
          })}
        </ul>
      )}

      <ManageListDialog
        listId={managingId}
        onClose={() => setManagingId(null)}
      />

      <NewRepoListDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setManagingId(id)}
      />

      <DeleteRepoListConfirm
        list={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          // If the user was managing this list, close that dialog too.
          if (deleting && managingId === deleting.id) setManagingId(null)
        }}
      />
    </section>
  )
}
