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
import type { BoardWithNodes, Position } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'
import { boardNodeToFlowNode, type GitcanvasFlowNode, type RepoFlowNodeData } from './nodeMapping'
import { nodeTypes } from './nodeTypes'
import { CanvasToolbar } from './CanvasToolbar'
import { useRemoveNode, useUpdateNode } from './useBoardNodes'
import { CanvasProvider, type CanvasContextValue } from './CanvasContext'
import { NodeContextMenu, type NodeContextMenuState, type NodeContextAction } from './NodeContextMenu'
import { RepoNodeConfigDialog } from './RepoNodeConfigDialog'
import { ColorPickerPopover } from './ColorPickerPopover'

/**
 * React Flow requires that parent nodes appear before their children in the
 * `nodes` array — otherwise it logs:
 *
 *   "Parent node X not found. Please make sure that parent nodes are in front
 *    of their child nodes in the nodes array."
 *
 * Our query layer orders by `createdAt`, which is great for stable rendering
 * but breaks this rule when a group is created AFTER the repos that later
 * get dragged into it (the group ends up after its children in the array).
 *
 * Groups never nest into other groups in this app, so a single roots-first
 * partition is enough — no full topological sort. We early-return the input
 * untouched when the order is already valid to preserve referential identity
 * (and let React Flow's reconciliation skip work).
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

  // Stable partition: roots first, then children. Preserves relative order
  // within each bucket so the user's original layout intent stays intact.
  const roots: GitcanvasFlowNode[] = []
  const children: GitcanvasFlowNode[] = []
  for (const n of nodes) {
    if (n.parentId) children.push(n)
    else roots.push(n)
  }
  return [...roots, ...children]
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
   */
  const findGroupAtPointer = useCallback(
    (
      evt: { clientX: number; clientY: number },
      pool: GitcanvasFlowNode[],
    ): GitcanvasFlowNode | null => {
      const flowPos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY })
      let smallest: GitcanvasFlowNode | null = null
      let smallestArea = Infinity
      for (const n of pool) {
        if (n.type !== 'group') continue
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
   * Walks every group and expands its bounds in any direction needed to
   * contain all of its direct children with inner padding.
   *
   * Right/bottom expansion is straightforward: bump width/height.
   *
   * Left/top expansion is trickier because group children are positioned
   * RELATIVE to the parent. To extend a group to the left we have to:
   *   1. Shift the group's own position left/up by the deficit.
   *   2. Bump the group's width/height by the same deficit.
   *   3. Offset every child's relative position by +deficit so they stay
   *      visually still while their parent's coordinate system slides.
   *
   * The function returns the patched node array plus a list of changes to
   * persist via `boards.updateNode` — both the group's new size+position and
   * each shifted child's new position.
   *
   * Only EXPANDS — never shrinks. The user said "no overflow", not "tight fit".
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

      // Index direct children by parent id.
      const childrenByParent = new Map<string, GitcanvasFlowNode[]>()
      for (const n of pool) {
        if (n.parentId) {
          const arr = childrenByParent.get(n.parentId) ?? []
          arr.push(n)
          childrenByParent.set(n.parentId, arr)
        }
      }

      let nextNodes = pool
      const changes: Array<{
        id: string
        position?: { x: number; y: number }
        size?: { width: number; height: number }
      }> = []

      for (const group of pool) {
        if (group.type !== 'group') continue
        const children = childrenByParent.get(group.id) ?? []
        if (children.length === 0) continue

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

        const currentWidth =
          group.measured?.width ?? (group.width as number | undefined) ?? 380
        const currentHeight =
          group.measured?.height ?? (group.height as number | undefined) ?? 240

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
        nextNodes = nextNodes.map((n) => {
          if (n.id === group.id) {
            return { ...n, position: newGroupPos, width: newWidth, height: newHeight }
          }
          if (positionChanged && n.parentId === group.id) {
            return {
              ...n,
              position: { x: n.position.x + shiftLeft, y: n.position.y + shiftUp },
            }
          }
          return n
        })

        changes.push({
          id: group.id,
          position: positionChanged ? newGroupPos : undefined,
          size: { width: newWidth, height: newHeight },
        })

        if (positionChanged) {
          for (const c of children) {
            changes.push({
              id: c.id,
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
      if (node.type === 'group') {
        setHighlightedGroupId(null)
        return
      }
      // Live highlight of the group the cursor is currently hovering over.
      const target = findGroupAtPointer(evt, nodes)
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

      // Groups themselves stay flat — they don't nest into other groups.
      if (node.type === 'group') {
        updateNode.mutate({ id: node.id, patch: { position: node.position } })
        const fit = fitGroupsToChildren(nodes)
        if (fit.changes.length > 0) {
          setNodes(fit.nodes)
          persistFitChanges(fit.changes)
        }
        return
      }

      const targetGroup = findGroupAtPointer(evt, nodes)

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

      setContextMenu({
        x: evt.clientX,
        y: evt.clientY,
        nodes: targets,
        primary: node,
      })
    },
    [nodes],
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
      if (action === 'delete') {
        const idsToDelete = new Set(targetNodes.map((n) => n.id))
        for (const id of idsToDelete) {
          removeNode.mutate({ id, boardId: board.id })
        }
        setNodes((curr) => curr.filter((n) => !idsToDelete.has(n.id)))
      }
    },
    [removeNode, board.id],
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
