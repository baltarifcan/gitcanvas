import { useEffect, useRef } from 'react'
import {
  Archive,
  ArchiveRestore,
  Cog,
  FolderOpen,
  LayoutGrid,
  LayoutList,
  LayoutPanelLeft,
  Palette,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { GroupLayoutMode } from '@gitcanvas/shared'
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
  /**
   * Optional kind-specific snapshot the parent fills in when opening the menu.
   * Avoids re-querying React Query / canvas state inside the menu component.
   */
  context?: {
    /** True when the right-clicked repo is currently archived. */
    repoArchived?: boolean
    /** Current layout mode of the right-clicked group node. */
    groupLayoutMode?: GroupLayoutMode
  }
}

type Props = {
  state: NodeContextMenuState | null
  onClose: () => void
  onAction: (action: NodeContextAction, state: NodeContextMenuState) => void
}

export type NodeContextAction =
  | 'configure-repo'
  | 'open-folder'
  | 'toggle-archived'
  | 'rename-group'
  | 'change-color'
  | 'group-layout-free'
  | 'group-layout-vertical'
  | 'group-layout-horizontal'
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
  type ActionItem = {
    key: NodeContextAction
    label: string
    Icon: LucideIcon
    danger?: boolean
    /** Renders a checkmark / "current" indicator on the right of the row. */
    active?: boolean
  }
  const actions: ActionItem[] = []

  if (!isMulti) {
    if (state.primary.type === 'repo') {
      actions.push({ key: 'configure-repo', label: 'Configure…', Icon: Cog })
      actions.push({ key: 'open-folder', label: 'Open in Finder', Icon: FolderOpen })
      const archived = state.context?.repoArchived ?? false
      actions.push({
        key: 'toggle-archived',
        label: archived ? 'Unarchive' : 'Archive',
        Icon: archived ? ArchiveRestore : Archive,
      })
    }
    if (state.primary.type === 'group') {
      actions.push({ key: 'rename-group', label: 'Rename', Icon: Pencil })
      actions.push({ key: 'change-color', label: 'Change color…', Icon: Palette })
      const mode = state.context?.groupLayoutMode ?? 'free'
      actions.push({
        key: 'group-layout-free',
        label: 'Layout: free',
        Icon: LayoutGrid,
        active: mode === 'free',
      })
      actions.push({
        key: 'group-layout-vertical',
        label: 'Layout: vertical',
        Icon: LayoutList,
        active: mode === 'vertical',
      })
      actions.push({
        key: 'group-layout-horizontal',
        label: 'Layout: horizontal',
        Icon: LayoutPanelLeft,
        active: mode === 'horizontal',
      })
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
      {actions.map(({ key, label, Icon, danger, active }) => (
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
              : active
                ? 'bg-zinc-800/60 text-zinc-100 hover:bg-zinc-800'
                : 'text-zinc-200 hover:bg-zinc-800')
          }
        >
          <Icon size={13} className={danger ? '' : active ? 'text-violet-400' : 'text-zinc-400'} />
          <span className="flex-1">{label}</span>
          {active && <span className="text-[10px] text-violet-400">●</span>}
        </button>
      ))}
    </div>
  )
}
