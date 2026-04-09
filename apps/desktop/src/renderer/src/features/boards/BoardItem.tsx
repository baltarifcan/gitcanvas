import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import type { Board } from '@gitcanvas/shared'

type Props = {
  board: Board
  selected: boolean
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
}

export function BoardItem({ board, selected, onSelect, onRename, onDelete }: Props) {
  return (
    <div
      onClick={onSelect}
      className={clsx(
        'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition',
        selected
          ? 'bg-violet-600/15 text-violet-100 ring-1 ring-inset ring-violet-500/30'
          : 'text-zinc-300 hover:bg-zinc-800/60',
      )}
    >
      <span className="flex-1 truncate">{board.name}</span>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={clsx(
              'rounded p-1 text-zinc-500 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-200 focus:outline-none data-[state=open]:opacity-100 group-hover:opacity-100',
              selected && 'opacity-60',
            )}
            aria-label={`Actions for ${board.name}`}
          >
            <MoreHorizontal size={14} />
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
                onRename()
              }}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-zinc-800"
            >
              <Pencil size={14} className="text-zinc-400" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault()
                onDelete()
              }}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-red-400 outline-none data-[highlighted]:bg-red-500/10"
            >
              <Trash2 size={14} />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
