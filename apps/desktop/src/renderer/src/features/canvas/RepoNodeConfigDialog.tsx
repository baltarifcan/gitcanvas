import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { Check, GitBranch, X } from 'lucide-react'
import clsx from 'clsx'
import type { RepoNodeData } from '@gitcanvas/shared'
import { useRepoBranches } from '@renderer/features/repos/useRepos'
import { useUpdateNode } from '@renderer/features/canvas/useBoardNodes'
import { getCachedNode, recordNodeUpdate } from '@renderer/features/canvas/historyActions'
import { useCanvasContext } from '@renderer/features/canvas/CanvasContext'
import { ColorPicker } from '@renderer/components/ColorPicker'
import type { RepoFlowNodeData } from '@renderer/features/canvas/nodeMapping'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The flow node id of the repo node being configured. */
  nodeId: string
  /** Current node data — used to seed the form on open. */
  initialData: RepoFlowNodeData
}

const DEFAULT_BRANCH_COLOR = '#71717a' // zinc-500

/**
 * Per-instance settings for a repo node on the board.
 *
 * Pinned branches: which branches to render as inline rows on the node body.
 * A new repo node has `visibleBranches === undefined`, which RepoNode.tsx
 * interprets as "show all branches". Saving here always emits an explicit
 * array (the user is opting in to a fixed set), so once configured the node
 * stops auto-tracking newly created branches.
 *
 * Each pinned branch can carry an optional color override that tints the
 * branch row + any inline annotations underneath. Useful for distinguishing
 * production vs staging vs feature branches at a glance.
 */
export function RepoNodeConfigDialog({ open, onOpenChange, nodeId, initialData }: Props) {
  const branches = useRepoBranches(initialData.repoId)
  const updateNode = useUpdateNode()
  const qc = useQueryClient()
  const { boardId, updateLocalNodeData } = useCanvasContext()

  const [visibleBranches, setVisibleBranches] = useState<Set<string>>(
    new Set(initialData.visibleBranches ?? []),
  )
  const [branchColors, setBranchColors] = useState<Record<string, string>>(
    initialData.branchColors ?? {},
  )
  const [showBranchDetails, setShowBranchDetails] = useState(initialData.showBranchDetails ?? true)
  const [showAnnotations, setShowAnnotations] = useState(initialData.showAnnotations ?? true)
  const [notes, setNotes] = useState(initialData.notes ?? '')

  useEffect(() => {
    if (!open) return
    setVisibleBranches(new Set(initialData.visibleBranches ?? []))
    setBranchColors(initialData.branchColors ?? {})
    setShowBranchDetails(initialData.showBranchDetails ?? true)
    setShowAnnotations(initialData.showAnnotations ?? true)
    setNotes(initialData.notes ?? '')
  }, [open, initialData])

  /**
   * "Show all" default seeding: when the user opens the dialog on a fresh
   * node (`visibleBranches === undefined`) we pre-select every branch so
   * unchecking is the user's opt-out path, matching the rendered default.
   * Without this, the dialog would open with zero checkboxes and saving
   * would silently switch the node into "show none" mode.
   *
   * Branches load async over IPC, so we re-run when `branches.data` lands.
   */
  useEffect(() => {
    if (!open) return
    if (initialData.visibleBranches !== undefined) return
    if (!branches.data || branches.data.length === 0) return
    setVisibleBranches(new Set(branches.data.map((b) => b.name)))
  }, [open, initialData.visibleBranches, branches.data])

  const toggleBranch = (name: string) => {
    setVisibleBranches((curr) => {
      const next = new Set(curr)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const setBranchColor = (name: string, color: string) => {
    setBranchColors((curr) => ({ ...curr, [name]: color }))
    // Auto-pin if the user picked a color for an unpinned branch.
    setVisibleBranches((curr) => {
      if (curr.has(name)) return curr
      const next = new Set(curr)
      next.add(name)
      return next
    })
  }

  const handleSave = () => {
    // Strip color entries for branches that aren't pinned — keeps the saved
    // data tidy and avoids stale entries.
    const cleanedColors: Record<string, string> = {}
    for (const name of visibleBranches) {
      if (branchColors[name]) cleanedColors[name] = branchColors[name]!
    }

    const trimmedNotes = notes.trim()
    const newData: RepoNodeData = {
      visibleBranches: Array.from(visibleBranches),
      branchColors: Object.keys(cleanedColors).length > 0 ? cleanedColors : undefined,
      showBranchDetails,
      showAnnotations,
      // Drop the field entirely when empty so the JSON column doesn't carry
      // an empty-string for every node — keeps the data tidy.
      notes: trimmedNotes ? trimmedNotes : undefined,
    }
    const before = getCachedNode(qc, boardId, nodeId)?.data
    updateLocalNodeData(nodeId, { ...newData, repoId: initialData.repoId } as RepoFlowNodeData)
    updateNode.mutate({ id: nodeId, patch: { data: newData } })
    if (before !== undefined) {
      recordNodeUpdate(
        qc,
        boardId,
        nodeId,
        { data: before },
        { data: newData },
        'Configure repo node',
      )
    }
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
          <header className="flex items-start justify-between border-b border-zinc-800 px-6 pb-4 pt-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-zinc-100">
                Configure repo node
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-400">
                Pin branches to display, color them, and toggle inline annotations.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X size={16} />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* ── Branches to pin ─────────────────────────────────────── */}
            <section className="px-6 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Pinned branches
              </h3>
              <p className="mt-1 text-[11px] text-zinc-500">
                Click a branch to pin it. Click its color swatch to assign a custom color
                that tints the branch row and its inline annotations.
              </p>

              {branches.isLoading && (
                <div className="mt-3 text-xs text-zinc-600">Loading branches…</div>
              )}

              {branches.data && branches.data.length === 0 && (
                <div className="mt-3 text-xs text-zinc-600">No branches found.</div>
              )}

              {branches.data && branches.data.length > 0 && (
                <ul className="mt-3 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1.5">
                  {branches.data.map((b) => {
                    const checked = visibleBranches.has(b.name)
                    const color = branchColors[b.name] ?? DEFAULT_BRANCH_COLOR
                    return (
                      <li key={b.name} className="flex items-center gap-2 rounded px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleBranch(b.name)}
                          className={clsx(
                            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                            checked
                              ? 'border-violet-500 bg-violet-600'
                              : 'border-zinc-600 bg-zinc-950',
                          )}
                          aria-label={`${checked ? 'Unpin' : 'Pin'} ${b.name}`}
                        >
                          {checked && <Check size={9} className="text-white" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleBranch(b.name)}
                          className="flex flex-1 items-center gap-2 text-left text-xs text-zinc-200 hover:text-white"
                        >
                          <GitBranch size={11} className="shrink-0" style={{ color }} />
                          <span className="truncate" style={{ color: checked ? color : undefined }}>
                            {b.name}
                          </span>
                          {b.isCurrent && (
                            <span className="text-[9px] uppercase tracking-wider text-emerald-400">
                              current
                            </span>
                          )}
                        </button>
                        <ColorPicker
                          value={color}
                          onChange={(hex) => setBranchColor(b.name, hex)}
                          align="end"
                        >
                          <button
                            type="button"
                            className="h-4 w-4 shrink-0 rounded-sm border border-black/30 transition hover:scale-110"
                            style={{ background: color }}
                            aria-label={`Pick color for ${b.name}`}
                            title={`Color for ${b.name}`}
                          />
                        </ColorPicker>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* ── Notes ───────────────────────────────────────────────── */}
            <section className="border-t border-zinc-800 px-6 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Notes
              </h3>
              <p className="mt-1 text-[11px] text-zinc-500">
                Free-form notes shown on this node directly under the title.
                Per-instance — different boards can carry different notes.
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="e.g. handles webhook ingest — talk to @rob before changes"
                className="mt-2 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
              />
            </section>

            {/* ── Display toggles ─────────────────────────────────────── */}
            <section className="border-t border-zinc-800 px-6 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Display
              </h3>
              <div className="mt-2 space-y-1.5">
                <ToggleRow
                  label="Show branch details"
                  hint="Dirty flag, ahead/behind, last commit"
                  value={showBranchDetails}
                  onChange={setShowBranchDetails}
                />
                <ToggleRow
                  label="Show annotations"
                  hint="Inline domain URLs and smart contract addresses, per branch + repo-level"
                  value={showAnnotations}
                  onChange={setShowAnnotations}
                />
              </div>
            </section>
          </div>

          <footer className="flex justify-end gap-2 border-t border-zinc-800 px-6 py-3">
            <Dialog.Close className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-500"
            >
              Save
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs hover:bg-zinc-900">
      <div className="min-w-0">
        <div className="text-zinc-200">{label}</div>
        {hint && <div className="text-[10px] text-zinc-500">{hint}</div>}
      </div>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-violet-500"
      />
    </label>
  )
}
