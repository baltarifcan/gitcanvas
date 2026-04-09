import { memo, useEffect, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useUpdateNode } from '@renderer/features/canvas/useBoardNodes'
import { getCachedNode, recordNodeUpdate } from '@renderer/features/canvas/historyActions'
import { useCanvasContext } from '@renderer/features/canvas/CanvasContext'
import type { NoteFlowNode } from '@renderer/features/canvas/nodeMapping'

function NoteNodeImpl({ id, data, selected }: NodeProps<NoteFlowNode>) {
  const updateNode = useUpdateNode()
  const qc = useQueryClient()
  const { boardId, updateLocalNodeData, exportMode } = useCanvasContext()
  const [content, setContent] = useState(data.content)

  // Re-sync if the source-of-truth content changes externally (e.g. cache refetch).
  useEffect(() => {
    setContent(data.content)
  }, [data.content])

  const save = () => {
    if (content === data.content) return
    const newData = { content }
    const before = getCachedNode(qc, boardId, id)?.data
    updateLocalNodeData(id, newData)
    updateNode.mutate({ id, patch: { data: newData } })
    if (before !== undefined) {
      recordNodeUpdate(qc, boardId, id, { data: before }, { data: newData }, 'Edit note')
    }
  }

  return (
    <div
      className={clsx(
        'flex h-full w-full flex-col overflow-hidden rounded-xl border bg-amber-50/95 text-zinc-900 shadow-md transition',
        selected ? 'border-amber-500 ring-2 ring-amber-400/40' : 'border-amber-200',
      )}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={80}
        lineClassName="!border-amber-400"
        handleClassName="!h-2 !w-2 !rounded-sm !border-amber-500 !bg-amber-200"
      />

      <div className="flex h-5 shrink-0 items-center px-2 text-[10px] font-semibold uppercase tracking-wider text-amber-700/70 select-none">
        Note
      </div>

      {exportMode ? (
        // During PNG/SVG capture, swap the textarea for a static div so the
        // exported image doesn't include a live editable element (which
        // looks weird in SVG and stays editable when the file is opened).
        <div className="flex-1 overflow-hidden whitespace-pre-wrap break-words px-3 pb-2 pt-1 text-sm leading-snug text-zinc-900">
          {content}
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={save}
          placeholder="Write a note…"
          className="nodrag nowheel flex-1 resize-none border-0 bg-transparent px-3 pb-2 pt-1 text-sm leading-snug text-zinc-900 placeholder:text-amber-700/40 focus:outline-none"
          spellCheck={false}
        />
      )}
    </div>
  )
}

export const NoteNode = memo(NoteNodeImpl)
