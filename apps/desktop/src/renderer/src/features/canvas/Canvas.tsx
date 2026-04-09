import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react'
import type {
  BoardWithNodes,
  GroupLayoutMode,
  GroupNodeData,
  Position,
  Repo,
} from '@gitcanvas/shared'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@renderer/lib/api'
import { boardNodeToFlowNode, type GitcanvasFlowNode, type RepoFlowNodeData } from './nodeMapping'
import { nodeTypes } from './nodeTypes'
import { CanvasToolbar } from './CanvasToolbar'
import { useRemoveNode, useUpdateNode } from './useBoardNodes'
import { CanvasProvider, type CanvasContextValue } from './CanvasContext'
import { NodeContextMenu, type NodeContextMenuState, type NodeContextAction } from './NodeContextMenu'
import { RepoNodeConfigDialog } from './RepoNodeConfigDialog'
import { ColorPickerPopover } from './ColorPickerPopover'
import { repoKey, useSetRepoArchived } from '@renderer/features/repos/useRepos'

/**
 * React Flow requires that parent nodes appear before their children in the
 * `nodes` array — otherwise it logs:
 *
 *   "Parent node X not found. Please make sure that parent nodes are in front
 *    of their child nodes in the nodes array."
 *
 * Our query layer orders by `createdAt`, which is great for stable rendering
 * but breaks this rule when a group is created AFTER the repos (or nested
 * groups) that later get dragged into it.
 *
 * Groups can now nest into other groups, so a simple roots-vs-children
 * partition is no longer enough — we need a stable topological sort by
 * parent depth. Same early-return optimization applies: when the input is
 * already valid we hand it back untouched, preserving referential identity
 * so React Flow's reconciliation can skip work.
 */
function ensureParentsFirst(nodes: GitcanvasFlowNode[]): GitcanvasFlowNode[] {
  const indexById = new Map<string, number>()
  for (let i = 0; i < nodes.length; i++) indexById.set(nodes[i]!.id, i)

  let needsResort = false
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    if (!n.parentId) continue
    const parentIdx = indexById.get(n.parentId)
    if (parentIdx !== undefined && parentIdx > i) {
      needsResort = true
      break
    }
  }
  if (!needsResort) return nodes

  // Stable bucketing by depth. Depth 0 = no parent (or parent not in pool);
  // depth(n) = depth(parent) + 1. We resolve depths in passes — at most O(N²)
  // worst case but N is small (canvas nodes), and it preserves the original
  // relative order within each depth bucket.
  const depthById = new Map<string, number>()
  const idsInPool = new Set(nodes.map((n) => n.id))
  let progressed = true
  while (progressed) {
    progressed = false
    for (const n of nodes) {
      if (depthById.has(n.id)) continue
      if (!n.parentId || !idsInPool.has(n.parentId)) {
        depthById.set(n.id, 0)
        progressed = true
        continue
      }
      const parentDepth = depthById.get(n.parentId)
      if (parentDepth !== undefined) {
        depthById.set(n.id, parentDepth + 1)
        progressed = true
      }
    }
  }
  // Any node still missing a depth is part of a cycle — defensively bucket
  // them at the end so React Flow doesn't crash; the drop validator below
  // already prevents cycles being introduced via the UI.
  for (const n of nodes) if (!depthById.has(n.id)) depthById.set(n.id, Number.MAX_SAFE_INTEGER)

  // Stable sort by depth ascending. Array.sort in V8 is stable since ES2019.
  return [...nodes].sort((a, b) => depthById.get(a.id)! - depthById.get(b.id)!)
}

/**
 * True when assigning `node` to `targetParent` would form a cycle — i.e.
 * `targetParent` is already a descendant of `node`. Walks up the parent
 * chain from `targetParent` and checks for `node.id`.
 */
function wouldCreateParentCycle(
  nodeId: string,
  targetParentId: string,
  pool: GitcanvasFlowNode[],
): boolean {
  if (nodeId === targetParentId) return true
  const byId = new Map(pool.map((n) => [n.id, n]))
  let cursor = byId.get(targetParentId)
  // Cap the walk at pool.length to defend against pre-existing cycles (we
  // shouldn't have any, but a corrupted DB shouldn't crash the canvas).
  let hops = 0
  while (cursor?.parentId && hops <= pool.length) {
    if (cursor.parentId === nodeId) return true
    cursor = byId.get(cursor.parentId)
    hops++
  }
  return false
}

type Props = {
  board: BoardWithNodes
  /**
   * Bumped by parent after `setSyncToken` to force a local state reset from
   * `board.nodes` (used by features that mutate the cache externally).
   */
  syncToken?: number
  /** Selected repo node id (for the right-side details panel). */
  selectedRepoId?: string | null
  /** Fired when a repo node is clicked / null when deselected. */
  onSelectRepoNode?: (repoId: string | null) => void
}

function CanvasInner({ board, syncToken = 0, selectedRepoId, onSelectRepoNode }: Props) {
  const initial = useMemo(() => board.nodes.map(boardNodeToFlowNode), [board.id])
   
  const [nodes, setNodes] = useState<GitcanvasFlowNode[]>(initial)
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(null)
  const [configuringRepoNode, setConfiguringRepoNode] = useState<{
    nodeId: string
    data: RepoFlowNodeData
  } | null>(null)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [colorPickerState, setColorPickerState] = useState<{
    nodeId: string
    currentColor: string
    x: number
    y: number
  } | null>(null)
  const [exportMode, setExportMode] = useState(false)

  // Switching boards or completing a sync: replace the entire local state
  // from the (now-fresh) cached board nodes.
  useEffect(() => {
    setNodes(board.nodes.map(boardNodeToFlowNode))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id, syncToken])

  const updateNode = useUpdateNode()
  const removeNode = useRemoveNode()
  const setRepoArchived = useSetRepoArchived()
  const qc = useQueryClient()
  const rf = useReactFlow<GitcanvasFlowNode>()

  // Used by NoteNode/GroupNode to update their own `data` after inline edits
  // — keeps local React Flow state in sync with what the user just typed,
  // since we never re-hydrate from the cache mid-session.
  const updateLocalNodeData = useCallback(
    (id: string, newData: GitcanvasFlowNode['data']) => {
      setNodes((curr) =>
        curr.map((n) => (n.id === id ? ({ ...n, data: newData } as GitcanvasFlowNode) : n)),
      )
    },
    [],
  )

  const ctxValue: CanvasContextValue = useMemo(
    () => ({
      updateLocalNodeData,
      highlightedGroupId,
      renamingGroupId,
      clearRenamingGroupId: () => setRenamingGroupId(null),
      exportMode,
    }),
    [updateLocalNodeData, highlightedGroupId, renamingGroupId, exportMode],
  )

  // Listen for the export menu's request to flip into static-render mode.
  // The export menu fires this CustomEvent before capture and clears it after.
  useEffect(() => {
    const onSet = (e: Event) => {
      const ce = e as CustomEvent<{ active: boolean }>
      setExportMode(!!ce.detail?.active)
    }
    window.addEventListener('gitcanvas:export-mode', onSet)
    return () => window.removeEventListener('gitcanvas:export-mode', onSet)
  }, [])

  // ── Position helpers ───────────────────────────────────────────────────────

  const absoluteOf = useCallback(
    (n: GitcanvasFlowNode, pool: GitcanvasFlowNode[]): Position => {
      if (!n.parentId) return n.position
      const parent = pool.find((p) => p.id === n.parentId)
      if (!parent) return n.position
      const pa = absoluteOf(parent, pool)
      return { x: pa.x + n.position.x, y: pa.y + n.position.y }
    },
    [],
  )

  /**
   * Find the smallest group whose absolute bounds contain the cursor's flow
   * coordinates. Replaces the old `getIntersectingNodes` strategy which
   * picked groups based on the dragged node's bounding box.
   *
   * "Smallest containing group" matters when groups overlap or nest: the
   * innermost one wins.
   *
   * `excludeNodeId` (and its entire subtree) is filtered out so that a group
   * being dragged into another group never picks itself — or one of its own
   * descendants — as the drop target. Without this, dragging a group into
   * one of its own children would corrupt the parent chain.
   */
  const findGroupAtPointer = useCallback(
    (
      evt: { clientX: number; clientY: number },
      pool: GitcanvasFlowNode[],
      excludeNodeId?: string | null,
    ): GitcanvasFlowNode | null => {
      const flowPos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
      // Build the set of ids to exclude: the dragged node and everything
      // beneath it in the parent tree.
      const excluded = new Set<string>()
      if (excludeNodeId) {
        excluded.add(excludeNodeId)
        let added = true
        while (added) {
          added = false
          for (const n of pool) {
            if (n.parentId && excluded.has(n.parentId) && !excluded.has(n.id)) {
              excluded.add(n.id)
              added = true
            }
          }
        }
      }

      let smallest: GitcanvasFlowNode | null = null
      let smallestArea = Infinity
      for (const n of pool) {
        if (n.type !== 'group') continue
        if (excluded.has(n.id)) continue
        const abs = absoluteOf(n, pool)
        const w = n.measured?.width ?? n.width ?? 380
        const h = n.measured?.height ?? n.height ?? 240
        if (
          flowPos.x >= abs.x &&
          flowPos.x <= abs.x + w &&
          flowPos.y >= abs.y &&
          flowPos.y <= abs.y + h
        ) {
          const area = w * h
          if (area < smallestArea) {
            smallest = n
            smallestArea = area
          }
        }
      }
      return smallest
    },
    [rf, absoluteOf],
  )

  /**
   * Walks every group and either:
   *
   *   • For `free` groups (the historical default): expands the group's bounds
   *     in any direction needed to contain all direct children with inner
   *     padding. Children keep their user-chosen positions; the group grows
   *     around them.
   *
   *   • For `vertical` / `horizontal` groups: re-stacks the children along the
   *     primary axis in their current visual order, then sizes the group to
   *     hug the stack. Children's relative positions on the cross axis are
   *     normalised to PADDING so the row/column lines up cleanly.
   *
   * Free-mode left/top expansion is tricky because children are positioned
   * RELATIVE to the parent. Extending leftward requires:
   *   1. Shift the group's own position left/up by the deficit.
   *   2. Bump the group's width/height by the same deficit.
   *   3. Offset every child's relative position by +deficit so they stay
   *      visually still while their parent's coordinate system slides.
   *
   * The function returns the patched node array plus a list of changes to
   * persist via `boards.updateNode` — every modified group/child.
   *
   * Free mode only EXPANDS, never shrinks. Directed modes do shrink-to-fit
   * because the layout is fully determined by the children list.
   */
  const fitGroupsToChildren = useCallback(
    (
      pool: GitcanvasFlowNode[],
    ): {
      nodes: GitcanvasFlowNode[]
      changes: Array<{
        id: string
        position?: { x: number; y: number }
        size?: { width: number; height: number }
      }>
    } => {
      const PADDING = 16
      const HEADER_RESERVED = 32 // group header is 28px tall + a little breathing room
      const CHILD_GAP = 12
      // Extra gap below the header for directed layouts so the first child
      // sits inset by PADDING on every side — symmetric with left / right /
      // bottom. Without this the top would only have HEADER_RESERVED (~4px
      // of breathing room) while the other sides had a full PADDING.
      const DIRECTED_TOP_INSET = HEADER_RESERVED + PADDING

      let nextNodes = pool
      const changes: Array<{
        id: string
        position?: { x: number; y: number }
        size?: { width: number; height: number }
      }> = []

      // Helper to push or merge a change for a node id (last write wins on
      // each field). Keeps `changes` from blowing up when groups nest and a
      // child gets touched by both its direct parent and an ancestor pass.
      const recordChange = (
        id: string,
        patch: { position?: { x: number; y: number }; size?: { width: number; height: number } },
      ) => {
        const existing = changes.find((c) => c.id === id)
        if (existing) {
          if (patch.position) existing.position = patch.position
          if (patch.size) existing.size = patch.size
        } else {
          changes.push({ id, ...patch })
        }
      }

      // ── Build a post-order group walk ────────────────────────────────────
      //
      // Nested groups MUST be reflowed bottom-up. If we processed an outer
      // group first, its child sizes (which include other groups) would
      // still be stale, so the outer would size itself based on what the
      // inner group USED to look like. Then the inner group reflows, the
      // outer never gets re-checked, and you end up with either an outer
      // that's too small (when the inner grew) or one that "shrinks like
      // the inner shrank" (the original bug report).
      //
      // We compute each group's depth by walking the parent chain, then
      // sort groups by depth descending (deepest first). At each step we
      // re-read the group + its children from the running `nextNodes`
      // array so size updates from earlier passes are visible.
      const depthOf = (n: GitcanvasFlowNode): number => {
        let depth = 0
        let cursor: GitcanvasFlowNode | undefined = n
        const seen = new Set<string>()
        while (cursor?.parentId && !seen.has(cursor.id)) {
          seen.add(cursor.id)
          const parent = pool.find((p) => p.id === cursor!.parentId)
          if (!parent) break
          depth++
          cursor = parent
        }
        return depth
      }

      const groupOrder = pool
        .filter((n) => n.type === 'group')
        .map((n) => ({ id: n.id, depth: depthOf(n) }))
        .sort((a, b) => b.depth - a.depth)

      for (const { id: groupId } of groupOrder) {
        // Re-fetch from the running array — earlier passes may have updated
        // this group's children's sizes. Iterating over the original `pool`
        // would silently use stale dimensions.
        const group = nextNodes.find((n) => n.id === groupId)
        if (!group || group.type !== 'group') continue
        const children = nextNodes.filter((n) => n.parentId === groupId)
        if (children.length === 0) continue

        const layoutMode = (group.data as GroupNodeData).layoutMode ?? 'free'
        const currentWidth =
          group.measured?.width ?? (group.width as number | undefined) ?? 380
        const currentHeight =
          group.measured?.height ?? (group.height as number | undefined) ?? 240

        // ── Directed (vertical / horizontal) layout ──────────────────────
        if (layoutMode === 'vertical' || layoutMode === 'horizontal') {
          // Stable order: sort children by their primary-axis position so
          // dragging a child past a sibling reorders the stack predictably.
          const ordered = [...children].sort((a, b) =>
            layoutMode === 'vertical' ? a.position.y - b.position.y : a.position.x - b.position.x,
          )

          // Walk children and assign their new relative positions. Cross-axis
          // is pinned to PADDING; primary axis starts past the header + the
          // top inset so the first child has the same gap as the other sides.
          let cursor = layoutMode === 'vertical' ? DIRECTED_TOP_INSET : PADDING
          let crossExtent = 0
          for (const c of ordered) {
            const cw = c.measured?.width ?? (c.width as number | undefined) ?? 240
            const ch = c.measured?.height ?? (c.height as number | undefined) ?? 140
            const newPos =
              layoutMode === 'vertical'
                ? { x: PADDING, y: cursor }
                : { x: cursor, y: DIRECTED_TOP_INSET }
            cursor += (layoutMode === 'vertical' ? ch : cw) + CHILD_GAP
            crossExtent = Math.max(crossExtent, layoutMode === 'vertical' ? cw : ch)

            if (c.position.x !== newPos.x || c.position.y !== newPos.y) {
              nextNodes = nextNodes.map((n) =>
                n.id === c.id ? ({ ...n, position: newPos } as GitcanvasFlowNode) : n,
              )
              recordChange(c.id, { position: newPos })
            }
          }

          // Final stack length minus the trailing CHILD_GAP we just added.
          // For vertical mode `cursor` already accounts for the top inset
          // (it started at DIRECTED_TOP_INSET); for horizontal we add it to
          // the cross-axis (height) below.
          const stackLen = cursor - CHILD_GAP + PADDING
          const newWidth =
            layoutMode === 'vertical' ? Math.max(crossExtent + PADDING * 2, 200) : stackLen
          const newHeight =
            layoutMode === 'horizontal'
              ? Math.max(crossExtent + DIRECTED_TOP_INSET + PADDING, 140)
              : stackLen

          if (newWidth !== currentWidth || newHeight !== currentHeight) {
            nextNodes = nextNodes.map((n) =>
              n.id === group.id
                ? ({
                    ...n,
                    width: newWidth,
                    height: newHeight,
                    // Stamp `measured` too, so the parent group's pass on
                    // the next iteration reads the just-computed size
                    // instead of React Flow's stale measurement.
                    measured: { width: newWidth, height: newHeight },
                  } as GitcanvasFlowNode)
                : n,
            )
            recordChange(group.id, { size: { width: newWidth, height: newHeight } })
          }
          continue
        }

        // ── Free layout (default) ────────────────────────────────────────
        // Bounding box of children in current parent-relative coordinates.
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const c of children) {
          const cw = c.measured?.width ?? (c.width as number | undefined) ?? 240
          const ch = c.measured?.height ?? (c.height as number | undefined) ?? 140
          minX = Math.min(minX, c.position.x)
          minY = Math.min(minY, c.position.y)
          maxX = Math.max(maxX, c.position.x + cw)
          maxY = Math.max(maxY, c.position.y + ch)
        }

        // How much we need to extend left / up so the leftmost / topmost
        // child sits inside the padding/header zone. Always >= 0.
        const shiftLeft = Math.max(0, PADDING - minX)
        const shiftUp = Math.max(0, HEADER_RESERVED - minY)

        // After shifting, every child's effective position increases by
        // (shiftLeft, shiftUp). Compute the new max edges using the shifted
        // values, then derive the required group dimensions.
        const shiftedMaxX = maxX + shiftLeft
        const shiftedMaxY = maxY + shiftUp
        const requiredWidth = shiftedMaxX + PADDING
        const requiredHeight = shiftedMaxY + PADDING

        // The group must be at least:
        //   - its current size grown by the left/up shift (we extended it that way),
        //   - and big enough to contain the right/bottom-most child + padding.
        const newWidth = Math.max(currentWidth + shiftLeft, requiredWidth)
        const newHeight = Math.max(currentHeight + shiftUp, requiredHeight)

        const dimensionChanged = newWidth !== currentWidth || newHeight !== currentHeight
        const positionChanged = shiftLeft > 0 || shiftUp > 0

        if (!dimensionChanged && !positionChanged) continue

        const newGroupPos = positionChanged
          ? { x: group.position.x - shiftLeft, y: group.position.y - shiftUp }
          : group.position

        // Apply the changes locally: group resize + position, plus children
        // offset by (+shiftLeft, +shiftUp) to keep them visually anchored.
        // We also stamp `measured` on the group so an enclosing group's
        // bottom-up pass reads the post-fit size, not React Flow's stale one.
        nextNodes = nextNodes.map((n) => {
          if (n.id === group.id) {
            return {
              ...n,
              position: newGroupPos,
              width: newWidth,
              height: newHeight,
              measured: { width: newWidth, height: newHeight },
            } as GitcanvasFlowNode
          }
          if (positionChanged && n.parentId === group.id) {
            return {
              ...n,
              position: { x: n.position.x + shiftLeft, y: n.position.y + shiftUp },
            }
          }
          return n
        })

        recordChange(group.id, {
          position: positionChanged ? newGroupPos : undefined,
          size: { width: newWidth, height: newHeight },
        })

        if (positionChanged) {
          for (const c of children) {
            recordChange(c.id, {
              position: { x: c.position.x + shiftLeft, y: c.position.y + shiftUp },
            })
          }
        }
      }

      return { nodes: nextNodes, changes }
    },
    [],
  )

  // ── React Flow event handlers ──────────────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange<GitcanvasFlowNode>[]) => {
      let resizeFinished = false
      setNodes((curr) => {
        let next = applyNodeChanges(changes, curr)

        // Persist resize-end events. NodeResizer may also dispatch a position
        // change alongside dimensions when the user drags the top or left
        // edge — those handles keep the opposite anchor stable by shifting
        // position. We pull both fields off the post-change node so the
        // top/left edges actually persist.
        for (const change of changes) {
          if (change.type === 'dimensions' && change.dimensions && change.resizing === false) {
            resizeFinished = true
            const updated = next.find((n) => n.id === change.id)
            if (!updated) continue
            updateNode.mutate({
              id: change.id,
              patch: {
                position: updated.position,
                size: {
                  width: change.dimensions.width,
                  height: change.dimensions.height,
                },
              },
            })
          }
        }

        // After a resize completes, the affected node may have grown beyond
        // its parent group's bounds — refit groups so the parent expands
        // (potentially in any direction, including position-shifting on
        // top/left expansion).
        if (resizeFinished) {
          const fit = fitGroupsToChildren(next)
          if (fit.changes.length > 0) {
            next = fit.nodes
            for (const c of fit.changes) {
              updateNode.mutate({
                id: c.id,
                patch: { position: c.position, size: c.size },
              })
            }
          }
        }
        return next
      })
    },
    [updateNode, fitGroupsToChildren],
  )

  const handleNodeDrag = useCallback(
    (evt: React.MouseEvent, node: GitcanvasFlowNode) => {
      // Live highlight of the group the cursor is currently hovering over.
      // For group drags we exclude the node and its descendants so the user
      // never sees a "drop into self / own child" highlight.
      const target = findGroupAtPointer(
        evt,
        nodes,
        node.type === 'group' ? node.id : null,
      )
      setHighlightedGroupId(target ? target.id : null)
    },
    [findGroupAtPointer, nodes],
  )

  const handleNodeDragStop = useCallback(
    (evt: React.MouseEvent, node: GitcanvasFlowNode, draggedNodes: GitcanvasFlowNode[]) => {
      setHighlightedGroupId(null)

      // Helper: dispatch every change from fitGroupsToChildren as IPC patches
      // (position+size for groups, position for shifted children).
      const persistFitChanges = (
        list: Array<{
          id: string
          position?: { x: number; y: number }
          size?: { width: number; height: number }
        }>,
      ) => {
        for (const c of list) {
          updateNode.mutate({
            id: c.id,
            patch: { position: c.position, size: c.size },
          })
        }
      }

      // Multi-drag: just persist new positions, no re-parenting. Re-parenting
      // multiple selected nodes at once would be confusing — the user is
      // moving a cluster, not reorganizing.
      if (draggedNodes.length > 1) {
        for (const n of draggedNodes) {
          updateNode.mutate({ id: n.id, patch: { position: n.position } })
        }
        // Refit affected groups since dragged nodes may now overflow.
        const fit = fitGroupsToChildren(nodes)
        if (fit.changes.length > 0) {
          setNodes(fit.nodes)
          persistFitChanges(fit.changes)
        }
        return
      }

      // Groups can now nest into other groups. The drag-stop pass routes
      // through the same target-group + reparent flow as repo / note nodes.
      // Special-case: when dragging a group we exclude the dragged node and
      // its descendants from drop targets so the user can never form a cycle.
      const excludeForTarget = node.type === 'group' ? node.id : null
      const targetGroup = findGroupAtPointer(evt, nodes, excludeForTarget)

      // Defensive cycle check — covers the (rare) case where the pointer
      // lookup somehow returns a descendant due to in-flight state. Bail out
      // and treat the drop as "no re-parenting".
      if (
        targetGroup &&
        node.type === 'group' &&
        wouldCreateParentCycle(node.id, targetGroup.id, nodes)
      ) {
        updateNode.mutate({ id: node.id, patch: { position: node.position } })
        const fit = fitGroupsToChildren(nodes)
        if (fit.changes.length > 0) {
          setNodes(fit.nodes)
          persistFitChanges(fit.changes)
        }
        return
      }

      // Helper to refit groups after we mutate nextNodes locally.
      const refit = (current: GitcanvasFlowNode[]) => {
        const fit = fitGroupsToChildren(current)
        if (fit.changes.length > 0) {
          persistFitChanges(fit.changes)
        }
        return fit.nodes
      }

      if (targetGroup) {
        if (targetGroup.id === node.parentId) {
          updateNode.mutate({ id: node.id, patch: { position: node.position } })
          // Same parent — node may have moved to a position that overflows.
          setNodes((curr) => refit(curr))
          return
        }
        const nodeAbs = absoluteOf(node, nodes)
        const groupAbs = absoluteOf(targetGroup, nodes)
        const relative: Position = {
          x: nodeAbs.x - groupAbs.x,
          y: nodeAbs.y - groupAbs.y,
        }
        setNodes((curr) => {
          const next = curr.map((n) =>
            n.id === node.id ? { ...n, parentId: targetGroup.id, position: relative } : n,
          )
          return refit(next)
        })
        updateNode.mutate({
          id: node.id,
          patch: { position: relative, parentId: targetGroup.id },
        })
        return
      }

      if (node.parentId) {
        const absolute = absoluteOf(node, nodes)
        setNodes((curr) => {
          const next = curr.map((n) =>
            n.id === node.id ? { ...n, parentId: undefined, position: absolute } : n,
          )
          return refit(next)
        })
        updateNode.mutate({
          id: node.id,
          patch: { position: absolute, parentId: null },
        })
        return
      }

      updateNode.mutate({ id: node.id, patch: { position: node.position } })
    },
    [nodes, updateNode, absoluteOf, findGroupAtPointer, fitGroupsToChildren],
  )

  const handleNodesDelete = useCallback(
    (deleted: GitcanvasFlowNode[]) => {
      for (const n of deleted) {
        removeNode.mutate({ id: n.id, boardId: board.id })
      }
    },
    [removeNode, board.id],
  )

  const handleNodeAdded = useCallback((node: GitcanvasFlowNode) => {
    setNodes((curr) => [...curr, node])
  }, [])

  const handleNodeClick = useCallback(
    (_evt: React.MouseEvent, node: GitcanvasFlowNode) => {
      if (node.type === 'repo') {
        onSelectRepoNode?.((node.data as { repoId: string }).repoId)
      } else {
        onSelectRepoNode?.(null)
      }
    },
    [onSelectRepoNode],
  )

  const handlePaneClick = useCallback(() => {
    onSelectRepoNode?.(null)
    setContextMenu(null)
  }, [onSelectRepoNode])

  const handleNodeContextMenu = useCallback(
    (evt: React.MouseEvent, node: GitcanvasFlowNode) => {
      // Without preventDefault the OS / Chromium native context menu pops up.
      evt.preventDefault()

      // If the right-clicked node is part of an existing multi-selection,
      // operate on the whole selection. Otherwise just the clicked node.
      const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
      const targets =
        selectedIds.has(node.id) && selectedIds.size > 1
          ? nodes.filter((n) => selectedIds.has(n.id))
          : [node]

      // Snapshot kind-specific state so the menu can render checkmarks /
      // archive vs unarchive labels without poking back into React Query.
      const context: NodeContextMenuState['context'] = {}
      if (node.type === 'repo') {
        const repoId = (node.data as RepoFlowNodeData).repoId
        const cached = qc.getQueryData<Repo>(repoKey(repoId))
        context.repoArchived = cached?.archived ?? false
      }
      if (node.type === 'group') {
        context.groupLayoutMode = (node.data as GroupNodeData).layoutMode ?? 'free'
      }

      setContextMenu({
        x: evt.clientX,
        y: evt.clientY,
        nodes: targets,
        primary: node,
        context,
      })
    },
    [nodes, qc],
  )

  const handleContextAction = useCallback(
    (action: NodeContextAction, state: NodeContextMenuState) => {
      const { primary, nodes: targetNodes } = state

      if (action === 'configure-repo' && primary.type === 'repo') {
        setConfiguringRepoNode({ nodeId: primary.id, data: primary.data as RepoFlowNodeData })
        return
      }
      if (action === 'open-folder' && primary.type === 'repo') {
        const repoId = (primary.data as RepoFlowNodeData).repoId
        void api.repos.get({ id: repoId }).then((repo) => {
          if (repo) void api.system.openPath({ path: repo.localPath })
        })
        return
      }
      if (action === 'toggle-archived' && primary.type === 'repo') {
        const repoId = (primary.data as RepoFlowNodeData).repoId
        const currentlyArchived = state.context?.repoArchived ?? false
        setRepoArchived.mutate({ id: repoId, archived: !currentlyArchived })
        return
      }
      if (action === 'rename-group' && primary.type === 'group') {
        setRenamingGroupId(primary.id)
        return
      }
      if (action === 'change-color' && primary.type === 'group') {
        setColorPickerState({
          nodeId: primary.id,
          currentColor: (primary.data as { color: string }).color,
          x: state.x,
          y: state.y,
        })
        return
      }
      if (
        (action === 'group-layout-free' ||
          action === 'group-layout-vertical' ||
          action === 'group-layout-horizontal') &&
        primary.type === 'group'
      ) {
        const mode: GroupLayoutMode =
          action === 'group-layout-free'
            ? 'free'
            : action === 'group-layout-vertical'
              ? 'vertical'
              : 'horizontal'
        const currentData = primary.data as GroupNodeData
        if ((currentData.layoutMode ?? 'free') === mode) return
        const nextData: GroupNodeData = { ...currentData, layoutMode: mode }
        // Update local state immediately so the directed layout pass picks
        // it up on the very next fit (handled in handleNodesChange below by
        // re-running fitGroupsToChildren on the updated node).
        setNodes((curr) => {
          const next = curr.map((n) =>
            n.id === primary.id ? ({ ...n, data: nextData } as GitcanvasFlowNode) : n,
          )
          const fit = fitGroupsToChildren(next)
          if (fit.changes.length > 0) {
            for (const c of fit.changes) {
              updateNode.mutate({ id: c.id, patch: { position: c.position, size: c.size } })
            }
            return fit.nodes
          }
          return next
        })
        updateNode.mutate({ id: primary.id, patch: { data: nextData } })
        return
      }
      if (action === 'delete') {
        const idsToDelete = new Set(targetNodes.map((n) => n.id))
        for (const id of idsToDelete) {
          removeNode.mutate({ id, boardId: board.id })
        }
        setNodes((curr) => curr.filter((n) => !idsToDelete.has(n.id)))
      }
    },
    [removeNode, board.id, setRepoArchived, fitGroupsToChildren, updateNode],
  )

  // Apply visual selection ring on the currently-selected repo node, then
  // make sure parents come before their children in the array we hand to
  // React Flow (see `ensureParentsFirst` for the why).
  const decoratedNodes = useMemo(() => {
    const ordered = ensureParentsFirst(nodes)
    if (!selectedRepoId) return ordered
    return ordered.map((n) => {
      if (n.type === 'repo' && (n.data as { repoId: string }).repoId === selectedRepoId) {
        return { ...n, selected: true }
      }
      return n
    })
  }, [nodes, selectedRepoId])

  return (
    <CanvasProvider value={ctxValue}>
      <div className="relative h-full w-full" data-canvas-root>
        <CanvasToolbar boardId={board.id} onNodeAdded={handleNodeAdded} />

        <ReactFlow<GitcanvasFlowNode>
          nodes={decoratedNodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onNodesDelete={handleNodesDelete}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={handleNodeContextMenu}
          onPaneClick={handlePaneClick}
          proOptions={{ hideAttribution: true }}
          snapToGrid
          snapGrid={[8, 8]}
          deleteKeyCode={['Backspace', 'Delete']}
          minZoom={0.2}
          maxZoom={2}
          fitView={nodes.length > 0}
          fitViewOptions={{ padding: 0.4 }}
          // Pan with the middle mouse button only; left-drag is reserved for
          // selection box. Multi-select via left-drag rectangle, then use
          // right-click to act on the whole selection.
          panOnDrag={[1]}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          // Hold shift to add to an existing selection (default).
          multiSelectionKeyCode="Shift"
          // Pan via two-finger trackpad gestures still works on macOS.
          panOnScroll={false}
        >
          <Background gap={24} size={1} color="#1f1f29" variant={BackgroundVariant.Dots} />
          <Controls
            position="bottom-right"
            className="!rounded-lg !border !border-zinc-800 !bg-zinc-900 [&_button]:!border-zinc-800 [&_button]:!bg-zinc-900 [&_button]:!text-zinc-300 [&_button:hover]:!bg-zinc-800"
            showInteractive={false}
          />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            className="!rounded-lg !border !border-zinc-800 !bg-zinc-900"
            nodeColor={(n) => {
              if (n.type === 'group') {
                return ((n.data as { color?: string })?.color as string) ?? '#7c3aed'
              }
              if (n.type === 'note') return '#fbbf24'
              return '#71717a'
            }}
            maskColor="rgba(11, 11, 15, 0.7)"
          />
        </ReactFlow>

        <NodeContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />

        {colorPickerState && (
          <ColorPickerPopover
            value={colorPickerState.currentColor}
            x={colorPickerState.x}
            y={colorPickerState.y}
            onChange={(hex) => {
              const node = nodes.find((n) => n.id === colorPickerState.nodeId)
              if (!node || node.type !== 'group') return
              const nextData = { label: node.data.label, color: hex }
              updateLocalNodeData(node.id, nextData)
              updateNode.mutate({ id: node.id, patch: { data: nextData } })
            }}
            onClose={() => setColorPickerState(null)}
          />
        )}

        {configuringRepoNode && (
          <RepoNodeConfigDialog
            open
            onOpenChange={(next) => {
              if (!next) setConfiguringRepoNode(null)
            }}
            nodeId={configuringRepoNode.nodeId}
            initialData={configuringRepoNode.data}
          />
        )}
      </div>
    </CanvasProvider>
  )
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

export type { Props as CanvasProps }
