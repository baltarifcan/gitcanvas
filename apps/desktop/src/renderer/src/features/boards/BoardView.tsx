import { useEffect, useRef, useState } from 'react'
import { useBoard } from './useBoards'
import { Canvas } from '@renderer/features/canvas/Canvas'
import { RepoDetailsPanel } from '@renderer/features/repos/RepoDetailsPanel'
import { BoardExportMenu } from '@renderer/features/canvas/BoardExportMenu'
import { BoardListLinkMenu } from '@renderer/features/lists/BoardListLinkMenu'

type Props = {
  boardId: string
}

export function BoardView({ boardId }: Props) {
  const board = useBoard(boardId)
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)

  /**
   * Bump a counter whenever the cached node ID set changes externally so the
   * Canvas resets its internal React Flow state from the fresh `board.nodes`.
   *
   * Why a signature instead of `nodes.length`: linking a board to a list can
   * both add new nodes AND tag pre-existing manual nodes as list-managed in
   * the same call — the count may stay the same but the membership changes.
   * Drags/resizes mutate node positions in place (same id set), so this
   * leaves the user's in-flight canvas state alone.
   */
  const nodeIdSignature = board.data
    ? board.data.nodes
        .map((n) => n.id)
        .sort()
        .join('|')
    : ''
  const lastSignatureRef = useRef(nodeIdSignature)
  const [syncToken, setSyncToken] = useState(0)
  useEffect(() => {
    if (lastSignatureRef.current !== nodeIdSignature) {
      lastSignatureRef.current = nodeIdSignature
      setSyncToken((t) => t + 1)
    }
  }, [nodeIdSignature])

  if (board.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    )
  }
  if (board.isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-400">
        {(board.error as Error).message}
      </div>
    )
  }
  if (!board.data) return null

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/50 px-5">
          <h1 className="text-sm font-semibold text-zinc-100">{board.data.name}</h1>
          <span className="text-xs text-zinc-600">
            {board.data.nodes.length} {board.data.nodes.length === 1 ? 'node' : 'nodes'}
          </span>
          <div className="flex-1" />
          <BoardListLinkMenu
            boardId={board.data.id}
            syncedListId={board.data.syncedListId}
          />
          <BoardExportMenu board={board.data} />
        </header>

        <div className="min-h-0 flex-1">
          <Canvas
            board={board.data}
            syncToken={syncToken}
            onSelectRepoNode={setSelectedRepoId}
            selectedRepoId={selectedRepoId}
          />
        </div>
      </div>

      {selectedRepoId && (
        <RepoDetailsPanel
          repoId={selectedRepoId}
          onClose={() => setSelectedRepoId(null)}
        />
      )}
    </div>
  )
}
