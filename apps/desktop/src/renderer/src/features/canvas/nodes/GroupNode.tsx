import { memo, useEffect, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import { useUpdateNode } from '@renderer/features/canvas/useBoardNodes'
import { useCanvasContext } from '@renderer/features/canvas/CanvasContext'
import type { GroupFlowNode } from '@renderer/features/canvas/nodeMapping'

function GroupNodeImpl({ id, data, selected }: NodeProps<GroupFlowNode>) {
  const updateNode = useUpdateNode()
  const { updateLocalNodeData, highlightedGroupId, renamingGroupId, clearRenamingGroupId } =
    useCanvasContext()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label)

  // Stay in sync with external data updates (e.g., board reload).
  useEffect(() => {
    setLabel(data.label)
  }, [data.label])

  // Programmatic rename trigger from the right-click context menu.
  useEffect(() => {
    if (renamingGroupId === id) {
      setEditing(true)
      clearRenamingGroupId()
    }
  }, [renamingGroupId, id, clearRenamingGroupId])

  const saveLabel = () => {
    setEditing(false)
    const trimmed = label.trim()
    if (!trimmed || trimmed === data.label) {
      setLabel(data.label)
      return
    }
    const newData = { label: trimmed, color: data.color }
    // Update local React Flow state immediately so the rename is visible
    // without waiting for any cache roundtrip.
    updateLocalNodeData(id, newData)
    updateNode.mutate({ id, patch: { data: newData } })
  }

  const isDropTarget = highlightedGroupId === id

  return (
    // Outer wrapper does NOT clip overflow — NodeResizer renders its corner
    // handles slightly outside the node bounds and `overflow: hidden` here
    // would make them invisible/unclickable. The visual chrome (colored
    // background + border + header) lives on a clipping inner layer.
    <div className="relative h-full w-full">
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={140}
        lineClassName="!border-violet-400"
        handleClassName="!h-3 !w-3 !rounded-sm !border-violet-500 !bg-violet-200"
      />

      <div
        className={clsx(
          'absolute inset-0 box-border overflow-hidden rounded-2xl border-2 transition',
          selected ? 'shadow-xl' : 'shadow-sm',
        )}
        style={{
          borderColor: data.color,
          backgroundColor: hexWithAlpha(data.color, 0.06),
          boxShadow: isDropTarget
            ? `0 0 0 3px ${hexWithAlpha(data.color, 0.55)}, 0 0 24px 4px ${hexWithAlpha(data.color, 0.35)}`
            : undefined,
        }}
      >
        <header
          onDoubleClick={() => setEditing(true)}
          className="flex h-7 items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-100"
          style={{ backgroundColor: data.color }}
        >
          {editing ? (
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveLabel()
                if (e.key === 'Escape') {
                  setLabel(data.label)
                  setEditing(false)
                }
              }}
              className="nodrag h-5 w-full rounded bg-black/20 px-1 text-xs font-semibold uppercase tracking-wider text-white outline-none"
              maxLength={120}
            />
          ) : (
            <span className="truncate">{label}</span>
          )}
        </header>

        {isDropTarget && (
          <div
            className="pointer-events-none absolute inset-0 flex items-end justify-center pb-2 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: data.color }}
          >
            Drop into {label}
          </div>
        )}
      </div>
    </div>
  )
}

/** Convert `#7c3aed` + alpha → `rgba(...)` for the soft tint background. */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const int = parseInt(m[1]!, 16)
  const r = (int >> 16) & 0xff
  const g = (int >> 8) & 0xff
  const b = int & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const GroupNode = memo(GroupNodeImpl)
