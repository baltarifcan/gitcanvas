import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Board } from '@gitcanvas/shared'
import { useBoards } from './useBoards'
import { BoardItem } from './BoardItem'
import { NewBoardDialog } from './NewBoardDialog'
import { RenameBoardDialog } from './RenameBoardDialog'
import { DeleteBoardConfirm } from './DeleteBoardConfirm'
import { RepoSidebarSection } from '@renderer/features/repos/RepoSidebarSection'
import { RepoListSidebarSection } from '@renderer/features/lists/RepoListSidebarSection'

type Props = {
  selectedBoardId: string | null
  onSelectBoard: (id: string | null) => void
}

export function BoardSidebar({ selectedBoardId, onSelectBoard }: Props) {
  const boards = useBoards()
  const [newOpen, setNewOpen] = useState(false)
  const [renaming, setRenaming] = useState<Board | null>(null)
  const [deleting, setDeleting] = useState<Board | null>(null)

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Boards
        </h2>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="New board"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {boards.isLoading && (
          <div className="px-2 py-1 text-xs text-zinc-600">Loading…</div>
        )}

        {boards.isError && (
          <div className="px-2 py-1 text-xs text-red-400">
            {(boards.error as Error).message}
          </div>
        )}

        {boards.data && boards.data.length === 0 && (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="mt-2 w-full rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-500 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-300"
          >
            No boards yet.
            <br />
            Click to create your first.
          </button>
        )}

        {boards.data && boards.data.length > 0 && (
          <ul className="space-y-0.5">
            {boards.data.map((b) => (
              <li key={b.id}>
                <BoardItem
                  board={b}
                  selected={b.id === selectedBoardId}
                  onSelect={() => onSelectBoard(b.id)}
                  onRename={() => setRenaming(b)}
                  onDelete={() => setDeleting(b)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      </div>

      <RepoListSidebarSection />
      <RepoSidebarSection />

      <NewBoardDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => onSelectBoard(id)}
      />

      <RenameBoardDialog board={renaming} onClose={() => setRenaming(null)} />

      <DeleteBoardConfirm
        board={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          if (deleting && deleting.id === selectedBoardId) {
            onSelectBoard(null)
          }
        }}
      />
    </aside>
  )
}
