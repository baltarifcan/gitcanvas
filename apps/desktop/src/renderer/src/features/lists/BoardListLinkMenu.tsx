import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, FolderTree, Link2, Unlink } from 'lucide-react'
import clsx from 'clsx'
import {
  useLinkBoardToList,
  useRepoLists,
  useUnlinkBoardFromList,
} from './useRepoLists'

type Props = {
  boardId: string
  syncedListId: string | null
}

/**
 * Header control shown in BoardView. Displays which list (if any) the board
 * is currently syncing with, and lets the user link to a different list or
 * unlink entirely.
 *
 * Linking an already-populated board to a list adds the list's missing repos
 * as new nodes and tags any existing matching manual nodes as list-managed
 * (see `linkBoardToList` in the main-process query layer).
 */
export function BoardListLinkMenu({ boardId, syncedListId }: Props) {
  const lists = useRepoLists()
  const link = useLinkBoardToList()
  const unlink = useUnlinkBoardFromList()

  const syncedList = syncedListId
    ? lists.data?.find((l) => l.id === syncedListId)
    : null

  const handleLink = (listId: string) => {
    link.mutate({ boardId, listId })
  }

  const handleUnlink = () => {
    unlink.mutate({ boardId })
  }

  const labelText = syncedList
    ? syncedList.name
    : syncedListId
      ? 'Synced list'
      : 'Link to list…'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={clsx(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition',
            syncedListId
              ? 'border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20'
              : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
          )}
          title={
            syncedListId
              ? 'This board syncs with a list'
              : 'Link this board to a list so membership syncs automatically'
          }
        >
          {syncedListId ? <FolderTree size={12} /> : <Link2 size={12} />}
          <span className="max-w-[140px] truncate">{labelText}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[220px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 p-1 text-sm text-zinc-200 shadow-xl"
        >
          <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Sync with list
          </div>

          {(lists.data?.length ?? 0) === 0 && (
            <div className="px-2 py-2 text-xs text-zinc-500">
              No lists yet. Create one from the sidebar.
            </div>
          )}

          {lists.data?.map((l) => {
            const isActive = l.id === syncedListId
            return (
              <DropdownMenu.Item
                key={l.id}
                onSelect={(e) => {
                  e.preventDefault()
                  if (!isActive) handleLink(l.id)
                }}
                className={clsx(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-zinc-800',
                  isActive && 'text-violet-300',
                )}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {isActive && <Check size={12} />}
                </span>
                <span className="flex-1 truncate">{l.name}</span>
                <span className="text-[10px] text-zinc-500">{l.repoCount}</span>
              </DropdownMenu.Item>
            )
          })}

          {syncedListId && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-zinc-800" />
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault()
                  handleUnlink()
                }}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-zinc-300 outline-none data-[highlighted]:bg-zinc-800"
              >
                <Unlink size={12} />
                Unlink from list
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
