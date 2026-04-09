import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, FolderOpen, FolderTree, Search, X } from 'lucide-react'
import clsx from 'clsx'
import type { DiscoveredLocalRepo } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'
import { useAddLocalRepo, useAddLocalRepoBatch, useScanLocal } from './useRepos'
import { useAddRepoToList, useRepoLists } from '@renderer/features/lists/useRepoLists'

type Mode = 'single' | 'scan'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const RESPECT_GITIGNORE_KEY = 'gitcanvas:scan:respectGitignore'

function loadRespectGitignorePreference(): boolean {
  try {
    return window.localStorage.getItem(RESPECT_GITIGNORE_KEY) !== 'false'
  } catch {
    return true
  }
}

function persistRespectGitignorePreference(value: boolean) {
  try {
    window.localStorage.setItem(RESPECT_GITIGNORE_KEY, value ? 'true' : 'false')
  } catch {
    // localStorage may be disabled in some sandbox configs — silently ignore.
  }
}

export function AddLocalRepoDialog({ open, onOpenChange }: Props) {
  const [mode, setMode] = useState<Mode>('single')
  const [scanResults, setScanResults] = useState<DiscoveredLocalRepo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scanRoot, setScanRoot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Optional target list for imports. When set, imported repos are funneled
   * into the list and sync through to any boards linked to it. Applies to
   * both the single-folder and scan-directory flows.
   */
  const [targetListId, setTargetListId] = useState<string | null>(null)
  // Default ON — most users want gitignored vendored repos skipped.
  // Persisted across sessions.
  const [respectGitignore, setRespectGitignore] = useState(() => loadRespectGitignorePreference())

  const addLocal = useAddLocalRepo()
  const addBatch = useAddLocalRepoBatch()
  const scan = useScanLocal()
  const lists = useRepoLists()
  const addRepoToList = useAddRepoToList()

  const reset = () => {
    setMode('single')
    setScanResults([])
    setSelected(new Set())
    setScanRoot(null)
    setError(null)
    setTargetListId(null)
    addLocal.reset()
    addBatch.reset()
    scan.reset()
    addRepoToList.reset()
  }

  const handlePickSingle = async () => {
    setError(null)
    const folder = await api.system.pickFolder({ title: 'Choose a local git repository' })
    if (!folder) return
    try {
      const repo = await addLocal.mutateAsync({ folderPath: folder })
      if (targetListId) {
        // Single-folder flow doesn't take a listId directly (the IPC is
        // `repos.addLocal`, not `addLocalBatch`), so follow up with a
        // membership insert. The list's sync fan-out happens in the same
        // handler as the multi-select flow.
        try {
          await addRepoToList.mutateAsync({
            listId: targetListId,
            repoId: repo.id,
          })
        } catch (err) {
          // If list add fails, the repo is still imported — surface the
          // error but don't roll back.
          setError(`Imported repo but failed to add to list: ${(err as Error).message}`)
          return
        }
      }
      reset()
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handlePickScanRoot = async () => {
    setError(null)
    const parent = await api.system.pickFolder({ title: 'Choose a parent directory to scan' })
    if (!parent) return
    setScanRoot(parent)
    setScanResults([])
    setSelected(new Set())
    try {
      const results = await scan.mutateAsync({ parentPath: parent, respectGitignore })
      setScanResults(results)
      // Pre-select all repos that aren't already imported.
      setSelected(new Set(results.filter((r) => !r.existingRepoId).map((r) => r.absolutePath)))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleToggleRespectGitignore = (next: boolean) => {
    setRespectGitignore(next)
    persistRespectGitignorePreference(next)
  }

  const toggle = (path: string) => {
    setSelected((curr) => {
      const next = new Set(curr)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleBatchImport = async () => {
    if (selected.size === 0) return
    setError(null)
    try {
      await addBatch.mutateAsync({
        folderPaths: Array.from(selected),
        listId: targetListId ?? undefined,
      })
      reset()
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const eligible = scanResults.filter((r) => !r.existingRepoId)

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
          <div className="flex items-start justify-between border-b border-zinc-800 px-6 pb-4 pt-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-zinc-100">
                Add local repositories
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-zinc-400">
                Pick a single folder or scan a parent directory for git repos.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="flex gap-1 px-6 pt-3">
            <ModeTab active={mode === 'single'} onClick={() => setMode('single')}>
              Single folder
            </ModeTab>
            <ModeTab active={mode === 'scan'} onClick={() => setMode('scan')}>
              Scan a directory
            </ModeTab>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-4">
            {mode === 'single' && (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-6 text-center">
                <FolderOpen size={28} className="mx-auto text-zinc-600" />
                <p className="mt-3 text-sm text-zinc-300">
                  Pick the root folder of a git repository.
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  We&apos;ll detect the branch, last commit, and remote so it shows up everywhere.
                </p>
                <button
                  type="button"
                  onClick={handlePickSingle}
                  disabled={addLocal.isPending}
                  className="mt-4 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {addLocal.isPending ? 'Adding…' : 'Choose folder…'}
                </button>
              </div>
            )}

            {mode === 'scan' && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePickScanRoot}
                    disabled={scan.isPending}
                    className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <Search size={14} />
                    {scan.isPending ? 'Scanning…' : scanRoot ? 'Scan another' : 'Choose parent…'}
                  </button>
                  {scanRoot && (
                    <span className="truncate text-xs text-zinc-500" title={scanRoot}>
                      {scanRoot}
                    </span>
                  )}
                </div>

                <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={respectGitignore}
                    onChange={(e) => handleToggleRespectGitignore(e.target.checked)}
                    className="h-3.5 w-3.5 accent-violet-500"
                  />
                  <span>
                    <span className="text-zinc-200">Respect .gitignore files</span>
                    <span className="block text-[10px] text-zinc-500">
                      Skip nested vendored repos that the parent&apos;s .gitignore excludes.
                    </span>
                  </span>
                </label>

                {scan.isPending && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-center text-xs text-zinc-500">
                    Walking the tree…
                  </div>
                )}

                {!scan.isPending && scanResults.length === 0 && scanRoot && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-center text-xs text-zinc-500">
                    No git repositories found below {scanRoot}.
                  </div>
                )}

                {scanResults.length > 0 && (
                  <ul className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800">
                    {scanResults.map((r) => {
                      const already = !!r.existingRepoId
                      const checked = selected.has(r.absolutePath)
                      return (
                        <li key={r.absolutePath}>
                          <label
                            className={clsx(
                              'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm',
                              already
                                ? 'cursor-not-allowed bg-zinc-900/40 text-zinc-600'
                                : 'hover:bg-zinc-800/40',
                            )}
                          >
                            <span
                              className={clsx(
                                'flex h-4 w-4 items-center justify-center rounded border',
                                already
                                  ? 'border-zinc-700 bg-zinc-800'
                                  : checked
                                    ? 'border-violet-500 bg-violet-600'
                                    : 'border-zinc-600 bg-zinc-950',
                              )}
                            >
                              {(checked || already) && (
                                <Check size={11} className="text-white" />
                              )}
                            </span>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              disabled={already}
                              onChange={() => toggle(r.absolutePath)}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-zinc-200">{r.name}</div>
                              <div className="truncate text-[11px] text-zinc-500">
                                {r.absolutePath}
                              </div>
                            </div>
                            {already && (
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                                imported
                              </span>
                            )}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {eligible.length > 0 && (
                  <div className="mt-3 text-xs text-zinc-500">
                    {selected.size} of {eligible.length} new repositories selected
                  </div>
                )}
              </div>
            )}

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
          </div>

          {(lists.data?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950/40 px-6 py-2.5">
              <FolderTree size={12} className="text-zinc-500" />
              <label
                htmlFor="target-list"
                className="text-[11px] uppercase tracking-wider text-zinc-500"
              >
                Add to list
              </label>
              <select
                id="target-list"
                value={targetListId ?? ''}
                onChange={(e) => setTargetListId(e.target.value || null)}
                className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-600"
              >
                <option value="">— None —</option>
                {lists.data!.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.repoCount})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-zinc-800 px-6 py-3">
            <Dialog.Close className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
              Cancel
            </Dialog.Close>
            {mode === 'scan' && scanResults.length > 0 && (
              <button
                type="button"
                onClick={handleBatchImport}
                disabled={selected.size === 0 || addBatch.isPending}
                className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {addBatch.isPending ? 'Importing…' : `Import ${selected.size}`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-md px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300',
      )}
    >
      {children}
    </button>
  )
}
