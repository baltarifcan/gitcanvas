import { useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useQueryClient } from '@tanstack/react-query'
import { GitBranch, Group as GroupIcon, StickyNote } from 'lucide-react'
import type { BoardNode } from '@gitcanvas/shared'
import { useAddGroupNode, useAddNoteNode } from './useBoardNodes'
import { recordNodeCreate } from './historyActions'
import { boardNodeToFlowNode, type GitcanvasFlowNode } from './nodeMapping'
import { ColorPicker } from '@renderer/components/ColorPicker'
import { RepoLibraryDialog } from '@renderer/features/repos/RepoLibraryDialog'

type Props = {
  boardId: string
  onNodeAdded: (node: GitcanvasFlowNode) => void
}

const DEFAULT_GROUP_COLOR = '#7c3aed'

export function CanvasToolbar({ boardId, onNodeAdded }: Props) {
  const addNote = useAddNoteNode()
  const addGroup = useAddGroupNode()
  const rf = useReactFlow()
  const qc = useQueryClient()
  const [repoLibraryOpen, setRepoLibraryOpen] = useState(false)
  // Persist the last-used group color across "Add group" clicks so users
  // don't have to re-pick every time they're filling out a board.
  const [groupColor, setGroupColor] = useState(DEFAULT_GROUP_COLOR)

  const centerOfViewport = () => {
    // Translate the viewport center into flow coordinates so new nodes drop
    // wherever the user is currently looking, not at the world origin.
    const { x, y, zoom } = rf.getViewport()
    const el = document.querySelector('.react-flow__viewport')?.parentElement
    const w = el?.clientWidth ?? 800
    const h = el?.clientHeight ?? 600
    return {
      x: (w / 2 - x) / zoom - 120,
      y: (h / 2 - y) / zoom - 70,
    }
  }

  const pushBoardNode = (node: BoardNode) => onNodeAdded(boardNodeToFlowNode(node))

  const handleAddNote = async () => {
    if (addNote.isPending) return
    const node = await addNote.mutateAsync({
      boardId,
      position: centerOfViewport(),
      data: { content: '' },
    })
    pushBoardNode(node)
    recordNodeCreate(qc, node)
  }

  const handleAddGroup = async () => {
    if (addGroup.isPending) return
    const node = await addGroup.mutateAsync({
      boardId,
      position: centerOfViewport(),
      data: { label: 'Group', color: groupColor },
    })
    pushBoardNode(node)
    recordNodeCreate(qc, node)
  }

  return (
    <>
      <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/90 p-1 shadow-xl backdrop-blur">
        <ToolbarButton
          icon={<GitBranch size={14} />}
          label="Add repo"
          onClick={() => setRepoLibraryOpen(true)}
        />
        <div className="mx-1 h-4 w-px bg-zinc-800" />
        <ToolbarButton
          icon={<StickyNote size={14} />}
          label="Add note"
          onClick={handleAddNote}
          disabled={addNote.isPending}
        />
        <div className="flex items-center">
          <ToolbarButton
            icon={<GroupIcon size={14} />}
            label="Add group"
            onClick={handleAddGroup}
            disabled={addGroup.isPending}
          />
          {/* Inline color picker — pre-set the next group's color without
              having to add then re-color. */}
          <ColorPicker value={groupColor} onChange={setGroupColor}>
            <button
              type="button"
              className="mr-1 h-5 w-5 shrink-0 rounded-full border border-black/30 transition hover:scale-110"
              style={{ background: groupColor }}
              aria-label="Pick group color"
              title="Pick the next group's color"
            />
          </ColorPicker>
        </div>
      </div>

      <RepoLibraryDialog
        open={repoLibraryOpen}
        onOpenChange={setRepoLibraryOpen}
        boardId={boardId}
        getDropOrigin={centerOfViewport}
        onAdded={pushBoardNode}
      />
    </>
  )
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  )
}
