import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  BoardNode,
  BoardWithNodes,
  GroupNodeData,
  NoteNodeData,
  Position,
  UpdateNodePatch,
} from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'
import { boardKey } from '@renderer/features/boards/useBoards'

/**
 * Mutation hooks for board nodes. Each one writes through to the main process
 * via IPC and then patches the cached `BoardWithNodes` for the parent board
 * so navigating away and back is instant.
 *
 * The Canvas component holds React Flow state separately for snappy UI; these
 * cache writes only matter for cold-load freshness, not for the live drag/drop
 * experience.
 */

function patchBoardNodes(
  cached: BoardWithNodes | undefined,
  mapper: (nodes: BoardNode[]) => BoardNode[],
): BoardWithNodes | undefined {
  if (!cached) return cached
  return { ...cached, nodes: mapper(cached.nodes) }
}

export function useAddRepoNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { boardId: string; repoId: string; position: Position }) =>
      api.boards.addRepoNode(input),
    onSuccess: (node, vars) => {
      qc.setQueryData<BoardWithNodes>(boardKey(vars.boardId), (prev) =>
        patchBoardNodes(prev, (nodes) => [...nodes, node]),
      )
    },
  })
}

export function useAddNoteNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { boardId: string; position: Position; data: NoteNodeData }) =>
      api.boards.addNoteNode(input),
    onSuccess: (node, vars) => {
      qc.setQueryData<BoardWithNodes>(boardKey(vars.boardId), (prev) =>
        patchBoardNodes(prev, (nodes) => [...nodes, node]),
      )
    },
  })
}

export function useAddGroupNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { boardId: string; position: Position; data: GroupNodeData }) =>
      api.boards.addGroupNode(input),
    onSuccess: (node, vars) => {
      qc.setQueryData<BoardWithNodes>(boardKey(vars.boardId), (prev) =>
        patchBoardNodes(prev, (nodes) => [...nodes, node]),
      )
    },
  })
}

export function useUpdateNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateNodePatch }) =>
      api.boards.updateNode(input),
    onSuccess: (node) => {
      qc.setQueryData<BoardWithNodes>(boardKey(node.boardId), (prev) =>
        patchBoardNodes(prev, (nodes) => nodes.map((n) => (n.id === node.id ? node : n))),
      )
    },
  })
}

export function useRemoveNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; boardId: string }) =>
      api.boards.removeNode({ id: input.id }),
    onSuccess: (_void, vars) => {
      qc.setQueryData<BoardWithNodes>(boardKey(vars.boardId), (prev) =>
        patchBoardNodes(prev, (nodes) => nodes.filter((n) => n.id !== vars.id)),
      )
    },
  })
}

/**
 * Re-insert a node verbatim. Used by the undo/redo system to bring back a
 * node that was just deleted (or to redo a previously-undone create) with
 * full per-instance fidelity — id, createdAt, size, parentId, sourceListId,
 * and the polymorphic `data` blob are all preserved by the main process.
 */
export function useRestoreNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { node: BoardNode }) => api.boards.restoreNode(input),
    onSuccess: (node) => {
      qc.setQueryData<BoardWithNodes>(boardKey(node.boardId), (prev) =>
        patchBoardNodes(prev, (nodes) => {
          // Defensive: if a stale copy somehow lingers (shouldn't happen —
          // restore is preceded by a delete), replace it instead of duping.
          const existing = nodes.findIndex((n) => n.id === node.id)
          if (existing >= 0) {
            const copy = nodes.slice()
            copy[existing] = node
            return copy
          }
          return [...nodes, node]
        }),
      )
    },
  })
}
