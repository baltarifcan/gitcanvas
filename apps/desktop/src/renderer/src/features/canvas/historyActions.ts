/**
 * Helper bindings between board mutations and the per-board history store.
 *
 * Why a separate module from `useBoardNodes.ts`?
 *   • The undo / redo command closures need to call the same persistence
 *     paths the React Query mutation hooks use, but they may run *outside* a
 *     React render (a stale closure won't have access to the right hook
 *     instance). So we duplicate the cache-write logic here as plain
 *     functions that take a `QueryClient` directly.
 *   • The renderer's existing mutation hooks (`useUpdateNode`, etc.) still
 *     do the forward action — these helpers only fire on undo/redo and on
 *     the post-mutation `record*` calls.
 *
 * Forward-action call sites (e.g. handlers in `Canvas.tsx`) keep using the
 * existing mutation hooks. After the mutation, they call one of the
 * `record*` helpers below to push an inverse command onto the history.
 */

import type { QueryClient } from '@tanstack/react-query'
import type {
  BoardNode,
  BoardWithNodes,
  GroupNodeData,
  NoteNodeData,
  RepoNodeData,
  UpdateNodePatch,
} from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'
import { boardKey } from '@renderer/features/boards/useBoards'
import { getBoardHistory, type Command } from './boardHistory'

// ── Cache-syncing IPC wrappers ─────────────────────────────────────────────
//
// These mirror the `onSuccess` patches inside the mutation hooks but are
// callable from anywhere with a QueryClient — including command closures
// running long after the React render that captured them. Keeping them
// in lockstep with the hook implementations is part of the contract.

function patchBoardNodes(
  cached: BoardWithNodes | undefined,
  mapper: (nodes: BoardNode[]) => BoardNode[],
): BoardWithNodes | undefined {
  if (!cached) return cached
  return { ...cached, nodes: mapper(cached.nodes) }
}

async function applyUpdateNode(
  qc: QueryClient,
  args: { id: string; patch: UpdateNodePatch },
): Promise<BoardNode> {
  const node = await api.boards.updateNode(args)
  qc.setQueryData<BoardWithNodes>(boardKey(node.boardId), (prev) =>
    patchBoardNodes(prev, (nodes) => nodes.map((n) => (n.id === node.id ? node : n))),
  )
  return node
}

async function applyRemoveNode(
  qc: QueryClient,
  args: { id: string; boardId: string },
): Promise<void> {
  await api.boards.removeNode({ id: args.id })
  qc.setQueryData<BoardWithNodes>(boardKey(args.boardId), (prev) =>
    patchBoardNodes(prev, (nodes) => nodes.filter((n) => n.id !== args.id)),
  )
}

async function applyRestoreNode(qc: QueryClient, node: BoardNode): Promise<BoardNode> {
  const restored = await api.boards.restoreNode({ node })
  qc.setQueryData<BoardWithNodes>(boardKey(restored.boardId), (prev) =>
    patchBoardNodes(prev, (nodes) => {
      const existing = nodes.findIndex((n) => n.id === restored.id)
      if (existing >= 0) {
        const copy = nodes.slice()
        copy[existing] = restored
        return copy
      }
      return [...nodes, restored]
    }),
  )
  return restored
}

// ── Command builders ───────────────────────────────────────────────────────
//
// Each `record*` helper is invoked AFTER the user's forward action has been
// dispatched. It captures the inverse + replay closures and pushes them onto
// the active board's history. If a batch is open the command joins the
// batch instead of going straight onto the main stack.
//
// The history itself doesn't care which mutation primitive a command uses
// — these helpers exist purely for ergonomics so call sites don't have to
// repeat the closure / cache-write boilerplate.

/**
 * Capture an "update" command. `before` and `after` are the same shape as
 * `UpdateNodePatch` and only need to include the fields the call site
 * actually changed (position-only drag → only position; group color picker
 * → only data; etc.).
 *
 * Trying to record an empty patch (before === after on every field) is
 * a no-op so callers can be lazy and just always call this helper.
 */
export function recordNodeUpdate(
  qc: QueryClient,
  boardId: string,
  nodeId: string,
  before: UpdateNodePatch,
  after: UpdateNodePatch,
  label = 'Edit node',
): void {
  if (patchesEqual(before, after)) return
  const cmd: Command = {
    label,
    undo: async () => {
      await applyUpdateNode(qc, { id: nodeId, patch: before })
    },
    redo: async () => {
      await applyUpdateNode(qc, { id: nodeId, patch: after })
    },
  }
  getBoardHistory(boardId).push(cmd)
}

/**
 * Capture a "create" command. Call this AFTER the create mutation has
 * resolved with the freshly-inserted node — we need its server-assigned id
 * and createdAt so redo can restore the exact same row instead of forging
 * a brand-new one.
 */
export function recordNodeCreate(
  qc: QueryClient,
  node: BoardNode,
  label = labelForKind('Create', node),
): void {
  // Capture a snapshot — we want redo to bring back THIS exact node, not a
  // mutated version of it that may have been edited in the meantime.
  const snapshot = node
  const cmd: Command = {
    label,
    undo: async () => {
      await applyRemoveNode(qc, { id: snapshot.id, boardId: snapshot.boardId })
    },
    redo: async () => {
      await applyRestoreNode(qc, snapshot)
    },
  }
  getBoardHistory(snapshot.boardId).push(cmd)
}

/**
 * Capture a "delete" command. Call this BEFORE the delete actually happens
 * (so we can grab the full node), then run the delete via the existing
 * mutation hook. The command stores the snapshot so undo can restore it
 * verbatim.
 */
export function recordNodeDelete(
  qc: QueryClient,
  node: BoardNode,
  label = labelForKind('Delete', node),
): void {
  const snapshot = node
  const cmd: Command = {
    label,
    undo: async () => {
      await applyRestoreNode(qc, snapshot)
    },
    redo: async () => {
      await applyRemoveNode(qc, { id: snapshot.id, boardId: snapshot.boardId })
    },
  }
  getBoardHistory(snapshot.boardId).push(cmd)
}

// ── Cache helpers ──────────────────────────────────────────────────────────

/**
 * Read the persisted snapshot of a node out of the React Query cache.
 *
 * The renderer keeps a `BoardWithNodes` per board in the cache and the
 * various mutation hooks patch it on success. Crucially, that cached copy
 * lags one beat behind the Canvas's local React Flow state during in-flight
 * gestures (drag / resize) — so it represents the "last persisted" state,
 * which is exactly what we want as the BEFORE half of an update command.
 */
export function getCachedNode(
  qc: QueryClient,
  boardId: string,
  nodeId: string,
): BoardNode | undefined {
  const board = qc.getQueryData<BoardWithNodes>(boardKey(boardId))
  return board?.nodes.find((n) => n.id === nodeId)
}

// ── Misc helpers ───────────────────────────────────────────────────────────

/**
 * Structural compare for the (small, flat) shapes of `UpdateNodePatch`. We
 * intentionally JSON.stringify because the `data` payload is plain JSON and
 * positions / sizes are pairs of numbers — no functions, no Dates, no
 * symbols. Faster than a recursive deep-eq for this trivial schema.
 */
function patchesEqual(a: UpdateNodePatch, b: UpdateNodePatch): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function labelForKind(verb: string, node: BoardNode): string {
  switch (node.kind) {
    case 'repo':
      return `${verb} repo node`
    case 'note':
      return `${verb} note`
    case 'group':
      return `${verb} group`
  }
}

// Re-exports kept for ergonomic imports at call sites — callers pull both
// the record helpers and the data shapes from one module.
export type { BoardNode, NoteNodeData, GroupNodeData, RepoNodeData }
