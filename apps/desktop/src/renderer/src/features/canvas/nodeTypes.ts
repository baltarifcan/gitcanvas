import type { NodeTypes } from '@xyflow/react'
import { NoteNode } from './nodes/NoteNode'
import { GroupNode } from './nodes/GroupNode'
import { RepoNode } from './nodes/RepoNode'

/**
 * Registry passed to <ReactFlow nodeTypes={...} />. Keys must match the
 * `kind` discriminator in {@link BoardNode}.
 */
export const nodeTypes: NodeTypes = {
  note: NoteNode,
  group: GroupNode,
  repo: RepoNode,
}
