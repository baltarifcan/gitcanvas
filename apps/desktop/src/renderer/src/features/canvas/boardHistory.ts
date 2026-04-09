/**
 * Per-board undo / redo history.
 *
 * Design notes
 * ────────────
 *
 * • Each user action pushes a `Command` onto the active board's stack. A
 *   command is *post-hoc*: the action has already happened by the time it's
 *   pushed, so we only store inverse + replay closures (`undo` / `redo`),
 *   never an "execute initially" function.
 *
 * • Commands talk to the same React Query mutation hooks the rest of the
 *   canvas uses. They never re-implement persistence themselves — they capture
 *   *what to call with what arguments* at the moment the user did the thing,
 *   then re-fire those calls in reverse on undo and forward on redo.
 *
 * • Compound user gestures (a drag that triggers a group fit cascade, a
 *   multi-select delete, etc.) are wrapped in a `beginBatch` / `commitBatch`
 *   pair. While a batch is open, every push is buffered into the batch
 *   instead of going onto the main stack — committing emits one composite
 *   entry that undoes/redoes the whole gesture atomically.
 *
 * • History lives in module-level state, keyed by `boardId`, so it survives
 *   component remounts (e.g. when the user toggles the right-hand details
 *   panel). It does NOT persist across app restarts — that's intentional: a
 *   redo across a restart would need to be authoritative against whatever
 *   else changed in the meantime, which is more complexity than warranted.
 *
 * • Capacity is capped per board (`HISTORY_CAP`) so a long session with lots
 *   of micro-edits can't blow up the heap. Old entries fall off the bottom.
 *
 * • The Canvas component subscribes to `subscribeAfterApply` and uses the
 *   notification to re-pull its local React Flow state from the freshly-
 *   updated React Query cache. Without this, undo/redo of a position or
 *   data-only change would update the DB + cache but leave React Flow's
 *   in-memory copy of the canvas stale until the next board switch.
 */

import { useEffect, useSyncExternalStore } from 'react'

/** Per-board cap. Bigger than typical, small enough that worst-case memory is bounded. */
const HISTORY_CAP = 200

export type Command = {
  /**
   * Short human-readable label for debugging / future menu items
   * (e.g. "Move 3 nodes", "Delete repo node").
   */
  label: string
  /** Reverse the action. May be async because mutations are IPC-backed. */
  undo: () => Promise<void> | void
  /** Re-apply the action after an undo. */
  redo: () => Promise<void> | void
}

type Listener = () => void

/**
 * One per board. Holds the undo/redo stacks and the in-flight batch (if any).
 *
 * Mutating methods notify two sets of listeners:
 *
 *   • `stateListeners`: fired whenever `canUndo` / `canRedo` change. Used by
 *     React hooks via `useSyncExternalStore` so menu items / button state can
 *     re-render.
 *
 *   • `applyListeners`: fired AFTER an undo or redo finishes. Used by the
 *     Canvas to re-sync its local React Flow state from the React Query
 *     cache (which the command's mutation hooks just updated).
 */
class BoardHistory {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  /** When non-null, `push` appends here instead of `undoStack`. */
  private batch: Command[] | null = null
  /** Optional label snapshot for the in-flight batch. */
  private batchLabel: string | null = null

  private stateListeners = new Set<Listener>()
  private applyListeners = new Set<Listener>()

  // ── Subscriptions ────────────────────────────────────────────────────────

  subscribeState(fn: Listener): () => void {
    this.stateListeners.add(fn)
    return () => this.stateListeners.delete(fn)
  }

  subscribeAfterApply(fn: Listener): () => void {
    this.applyListeners.add(fn)
    return () => this.applyListeners.delete(fn)
  }

  private notifyState(): void {
    for (const fn of this.stateListeners) fn()
  }

  private notifyApplied(): void {
    for (const fn of this.applyListeners) fn()
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  /**
   * Add a command to the history. Pushing a fresh command always invalidates
   * the redo stack — once you do something new, the old "future" timeline is
   * gone. (Same semantics as every text editor / IDE.)
   *
   * If a batch is open, the command is buffered into the batch instead.
   */
  push(cmd: Command): void {
    if (this.batch) {
      this.batch.push(cmd)
      // Don't notify state listeners during a batch — `canUndo` only changes
      // when the batch commits. Avoids spurious re-renders mid-gesture.
      return
    }
    this.undoStack.push(cmd)
    if (this.undoStack.length > HISTORY_CAP) {
      // Drop the oldest entry. The user can no longer undo back to before
      // this point — that's the trade-off for an in-memory history.
      this.undoStack.shift()
    }
    if (this.redoStack.length > 0) this.redoStack = []
    this.notifyState()
  }

  /**
   * Open a batch. While a batch is open, every `push` collects into the
   * batch buffer. Calling `commitBatch` rolls the buffer into a single
   * composite command on the main stack.
   *
   * Nesting is intentionally NOT supported — opening a batch while one is
   * already open simply continues the existing batch (label is preserved
   * from the outer call). This keeps callers from having to track depth.
   */
  beginBatch(label: string): void {
    if (this.batch) return
    this.batch = []
    this.batchLabel = label
  }

  /**
   * Commit the in-flight batch as one composite command. No-op (and clears
   * the batch) if the batch ended up empty — e.g. an early-return path in
   * the gesture handler that opened a batch but never pushed anything.
   */
  commitBatch(): void {
    const subs = this.batch
    const label = this.batchLabel ?? 'Edit'
    this.batch = null
    this.batchLabel = null
    if (!subs || subs.length === 0) return

    // Single-item batches don't need the composite wrapper. Unwrap them so
    // the undo stack stays readable and we don't pay an extra closure
    // dispatch on undo.
    if (subs.length === 1) {
      const only = subs[0]!
      this.undoStack.push(only)
    } else {
      this.undoStack.push({
        label,
        // Undo in REVERSE order so dependent operations come back in the
        // right sequence (e.g. an "add node" pushed before "set parent" must
        // be reversed by removing the parent FIRST then deleting the node).
        undo: async () => {
          for (let i = subs.length - 1; i >= 0; i--) {
            await subs[i]!.undo()
          }
        },
        redo: async () => {
          for (const c of subs) {
            await c.redo()
          }
        },
      })
    }
    if (this.undoStack.length > HISTORY_CAP) this.undoStack.shift()
    if (this.redoStack.length > 0) this.redoStack = []
    this.notifyState()
  }

  /**
   * Discard the in-flight batch without committing. Use when a gesture
   * aborts midway (e.g. drag cancelled, dialog dismissed).
   */
  cancelBatch(): void {
    this.batch = null
    this.batchLabel = null
  }

  async undo(): Promise<void> {
    // Refuse undo while a batch is mid-flight. The state would be
    // half-captured and we'd corrupt the history.
    if (this.batch) return
    const cmd = this.undoStack.pop()
    if (!cmd) return
    try {
      await cmd.undo()
      this.redoStack.push(cmd)
    } catch (err) {
      // Drop this entry on failure rather than re-pushing — the world
      // moved underneath us (e.g. node already deleted by another path).
      // Logging keeps us aware of regressions without breaking the UX.
      console.error('Undo failed:', cmd.label, err)
    }
    this.notifyState()
    this.notifyApplied()
  }

  async redo(): Promise<void> {
    if (this.batch) return
    const cmd = this.redoStack.pop()
    if (!cmd) return
    try {
      await cmd.redo()
      this.undoStack.push(cmd)
    } catch (err) {
      console.error('Redo failed:', cmd.label, err)
    }
    this.notifyState()
    this.notifyApplied()
  }
}

// ── Singleton registry ─────────────────────────────────────────────────────

const histories = new Map<string, BoardHistory>()

/**
 * Returns the (lazily-created) history for a board. Always returns the same
 * instance for a given id, so module consumers can subscribe without worrying
 * about referential identity.
 */
export function getBoardHistory(boardId: string): BoardHistory {
  let h = histories.get(boardId)
  if (!h) {
    h = new BoardHistory()
    histories.set(boardId, h)
  }
  return h
}

/** Drop the in-memory history for a board (e.g. after the board is deleted). */
export function clearBoardHistory(boardId: string): void {
  histories.delete(boardId)
}

// ── React glue ─────────────────────────────────────────────────────────────

/**
 * React hook returning the BoardHistory instance for the current board PLUS
 * reactive `canUndo` / `canRedo` flags. The flags re-render the consumer
 * whenever the underlying stacks change (via `subscribeState`).
 */
export function useBoardHistory(boardId: string): {
  history: BoardHistory
  canUndo: boolean
  canRedo: boolean
} {
  const history = getBoardHistory(boardId)

  // useSyncExternalStore returns the same snapshot identity unless something
  // actually changed, so consumers don't re-render on no-op state notifies.
  const canUndo = useSyncExternalStore(
    (cb) => history.subscribeState(cb),
    () => history.canUndo(),
  )
  const canRedo = useSyncExternalStore(
    (cb) => history.subscribeState(cb),
    () => history.canRedo(),
  )

  return { history, canUndo, canRedo }
}

/**
 * Subscribe to "an undo or redo just ran" notifications for a board. Used by
 * the Canvas component to re-sync local React Flow state from the React
 * Query cache after the mutation hooks invoked by an undo/redo have updated
 * the cache.
 *
 * The callback is invoked with no arguments — the listener is expected to
 * pull fresh state from wherever its source-of-truth lives.
 */
export function useAfterHistoryApply(boardId: string, fn: () => void): void {
  useEffect(() => {
    const history = getBoardHistory(boardId)
    return history.subscribeAfterApply(fn)
  }, [boardId, fn])
}
