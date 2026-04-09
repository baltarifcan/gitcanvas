import type { Node as FlowNode } from '@xyflow/react'
import type {
  BoardNode,
  GroupNodeData,
  NoteNodeData,
  RepoNodeData,
} from '@gitcanvas/shared'

/**
 * Per-kind React Flow node aliases — narrow `data` so each custom node
 * component can be typed precisely via `NodeProps<RepoFlowNode>` etc.
 *
 * Repo nodes carry both the repoId (for the data lookup) and the per-instance
 * RepoNodeData (visibleBranches + display toggles).
 */
export type RepoFlowNodeData = RepoNodeData & { repoId: string }
export type RepoFlowNode = FlowNode<RepoFlowNodeData, 'repo'>
export type NoteFlowNode = FlowNode<NoteNodeData, 'note'>
export type GroupFlowNode = FlowNode<GroupNodeData, 'group'>

export type GitcanvasFlowNode = RepoFlowNode | NoteFlowNode | GroupFlowNode

export function boardNodeToFlowNode(n: BoardNode): GitcanvasFlowNode {
  const base = {
    id: n.id,
    position: n.position,
    parentId: n.parentId ?? undefined,
    width: n.size.width,
    height: n.size.height,
    zIndex: n.zIndex,
  }
  switch (n.kind) {
    case 'repo':
      return {
        ...base,
        type: 'repo',
        data: { ...n.data, repoId: n.repoId },
      }
    case 'note':
      return {
        ...base,
        type: 'note',
        data: n.data,
      }
    case 'group':
      return {
        ...base,
        type: 'group',
        data: n.data,
        // Group containers act as drop targets for children, so make them
        // selectable but lower in the stack so child nodes layer above.
        selectable: true,
      }
  }
}
