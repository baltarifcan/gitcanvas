import { createContext, useContext } from 'react'
import type { GitcanvasFlowNode } from './nodeMapping'

/**
 * Bridge between custom node components (NoteNode, GroupNode, ...) and the
 * outer Canvas state.
 *
 * Custom nodes need to do a handful of things that controlled React Flow
 * makes awkward without lifting state up:
 *   1. Update their own `data` after an inline edit (so the new label/text
 *      shows immediately, instead of after a refetch we never trigger).
 *   2. Know when they're being targeted by an in-flight drag (drop-into-group cue).
 *   3. Be told from outside to enter rename mode (right-click → Rename).
 *   4. Switch to a non-interactive render shape during PNG/SVG export so the
 *      capture doesn't include live textareas / focus rings.
 *
 * The Canvas owns these states and exposes them via this context.
 */
export type CanvasContextValue = {
  /** Id of the board this canvas is rendering. Custom node components need
   * this to record undo/redo entries scoped to the right history stack. */
  boardId: string
  /** Patch a node's `data` field locally — does not persist. */
  updateLocalNodeData: (id: string, data: GitcanvasFlowNode['data']) => void
  /** id of the group currently being dragged-over, or null. */
  highlightedGroupId: string | null
  /** id of the group that should enter inline-rename mode, or null. */
  renamingGroupId: string | null
  /** Called by a GroupNode after it has consumed the rename signal. */
  clearRenamingGroupId: () => void
  /**
   * True while a PNG/SVG export is in progress. Custom nodes should render
   * static (non-editable) content during export — e.g. NoteNode swaps its
   * textarea for a div so the captured image doesn't show a blinking cursor
   * or focus ring.
   */
  exportMode: boolean
}

const CanvasContext = createContext<CanvasContextValue | null>(null)

export function useCanvasContext(): CanvasContextValue {
  const ctx = useContext(CanvasContext)
  if (!ctx) {
    throw new Error('useCanvasContext must be used inside <CanvasProvider>')
  }
  return ctx
}

export const CanvasProvider = CanvasContext.Provider
