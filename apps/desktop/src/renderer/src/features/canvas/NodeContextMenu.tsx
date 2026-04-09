import { useEffect, useRef } from 'react'
import {
  Cog,
  FolderOpen,
  Palette,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { GitcanvasFlowNode } from '@renderer/features/canvas/nodeMapping'

export type NodeContextMenuState = {
  /** Screen-relative coords where the menu should anchor (event.clientX/Y). */
  x: number
  y: number
  /**
   * The set of nodes the action should apply to. Always at least one entry.
   * For multi-select right-clicks this contains every selected node; for a
   * single-node right-click it contains just that one.
   */
  nodes: GitcanvasFlowNode[]
  /** The actual node that was right-clicked — used to decide kind-specific actions. */
  primary: GitcanvasFlowNode
}

type Props = {
  state: NodeContextMenuState | null
  onClose: () => void
  onAction: (action: NodeContextAction, state: NodeContextMenuState) => void
}

export type NodeContextAction =
  | 'configure-repo'
  | 'open-folder'
  | 'rename-group'
  | 'change-color'
  | 'delete'

/**
 * Lightweight floating menu shown on right-click. Uses fixed positioning at
 * the click coordinates. Auto-closes on outside click and Escape.
 *
 * Per-kind actions only show when a single node is targeted. Multi-select
 * right-clicks collapse to a single "Delete N nodes" action.
 */
export function NodeContextMenu({ state, onClose, onAction }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!state) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [state, onClose])

  if (!state) return null

  const isMulti = state.nodes.length > 1
  const actions: { key: NodeContextAction; label: string; Icon: LucideIcon; danger?: boolean }[] = []

  if (!isMulti) {
    if (state.primary.type === 'repo') {
      actions.push({ key: 'configure-repo', label: 'Configure…', Icon: Cog })
      actions.push({ key: 'open-folder', label: 'Open in Finder', Icon: FolderOpen })
    }
    if (state.primary.type === 'group') {
      actions.push({ key: 'rename-group', label: 'Rename', Icon: Pencil })
      actions.push({ key: 'change-color', label: 'Change color…', Icon: Palette })
    }
  }
  actions.push({
    key: 'delete',
    label: isMulti ? `Delete ${state.nodes.length} nodes` : 'Delete',
    Icon: Trash2,
    danger: true,
  })

  // Clamp to viewport bounds.
  const MENU_WIDTH = 220
  const MENU_HEIGHT_ESTIMATE = actions.length * 32 + 8
  const left = Math.min(state.x, window.innerWidth - MENU_WIDTH - 8)
  const top = Math.min(state.y, window.innerHeight - MENU_HEIGHT_ESTIMATE - 8)

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[200px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 p-1 text-sm text-zinc-200 shadow-xl"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map(({ key, label, Icon, danger }) => (
        <button
          key={key}
          type="button"
          onClick={() => {
            onAction(key, state)
            onClose()
          }}
          className={
            'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left outline-none ' +
            (danger
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-zinc-200 hover:bg-zinc-800')
          }
        >
          <Icon size={13} className={danger ? '' : 'text-zinc-400'} />
          {label}
        </button>
      ))}
    </div>
  )
}
