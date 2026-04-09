import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Archive,
  Coins,
  Database,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import type { BackupSummary, Chain } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'
import {
  useBackups,
  useBackupsRoot,
  useCreateBackup,
  useDeleteBackup,
  useRestoreBackup,
} from '@renderer/features/backups/useBackups'
import {
  DEFAULT_ADDRESS_PATTERN,
  useChains,
  useCreateChain,
  useDeleteChain,
  useUpdateChain,
} from './useChains'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Global app settings — currently houses the chains list (block explorer
 * URL templates used by smart contract annotations). Designed to grow with
 * additional sections as more global preferences accrue.
 */
export function SettingsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
          <header className="flex items-start justify-between border-b border-zinc-800 px-6 pb-4 pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-zinc-800 p-2 text-zinc-300">
                <Settings size={16} />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-zinc-100">
                  Settings
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                  Define chains so smart contract annotations link to their explorers.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
              <X size={16} />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChainsSection />
            <BackupsSection />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ChainsSection() {
  const chains = useChains()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Chain | null>(null)

  return (
    <section className="px-6 py-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins size={14} className="text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-200">Chains</h3>
          {chains.data && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {chains.data.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <Plus size={12} /> Add chain
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-zinc-500">
        Each entry maps a chain name (case-insensitive, as you type it on smart contract
        annotations) to an explorer URL template.{' '}
        <code className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-300">{'{address}'}</code>{' '}
        is replaced with the contract address at link time.
      </p>

      {adding && (
        <ChainForm
          onCancel={() => setAdding(false)}
          onDone={() => setAdding(false)}
          mode="create"
        />
      )}

      {editing && (
        <ChainForm
          existing={editing}
          onCancel={() => setEditing(null)}
          onDone={() => setEditing(null)}
          mode="edit"
        />
      )}

      <ul className="mt-3 divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        {chains.isLoading && (
          <li className="px-3 py-3 text-xs text-zinc-600">Loading…</li>
        )}
        {!chains.isLoading && (chains.data?.length ?? 0) === 0 && (
          <li className="px-3 py-3 text-xs text-zinc-600">No chains configured yet.</li>
        )}
        {chains.data?.map((c) => <ChainRow key={c.id} chain={c} onEdit={() => setEditing(c)} />)}
      </ul>
    </section>
  )
}

function ChainRow({ chain, onEdit }: { chain: Chain; onEdit: () => void }) {
  const del = useDeleteChain()
  return (
    <li className="group flex items-center gap-2 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate text-zinc-100">{chain.name}</div>
        <div
          className="truncate font-mono text-[10px] text-zinc-500"
          title={chain.explorerUrlTemplate}
        >
          {chain.explorerUrlTemplate}
        </div>
        <div className="truncate font-mono text-[10px] text-zinc-600" title={chain.addressPattern ?? DEFAULT_ADDRESS_PATTERN}>
          addr: {chain.addressPattern ?? `${DEFAULT_ADDRESS_PATTERN} (default)`}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="rounded p-1 text-zinc-500 opacity-0 hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100"
        aria-label={`Edit ${chain.name}`}
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        onClick={() => del.mutate(chain.id)}
        className="rounded p-1 text-zinc-600 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
        aria-label={`Delete ${chain.name}`}
      >
        <Trash2 size={12} />
      </button>
    </li>
  )
}

function ChainForm({
  existing,
  mode,
  onCancel,
  onDone,
}: {
  existing?: Chain
  mode: 'create' | 'edit'
  onCancel: () => void
  onDone: () => void
}) {
  const create = useCreateChain()
  const update = useUpdateChain()
  const [name, setName] = useState(existing?.name ?? '')
  const [template, setTemplate] = useState(existing?.explorerUrlTemplate ?? '')
  const [pattern, setPattern] = useState(existing?.addressPattern ?? '')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !template.trim()) return
    if (!template.includes('{address}')) {
      setError('Template must contain `{address}` as the placeholder.')
      return
    }
    // Validate the regex compiles before sending it to main.
    if (pattern.trim()) {
      try {
         
        new RegExp(pattern.trim())
      } catch {
        setError('Address pattern must be a valid regular expression.')
        return
      }
    }
    try {
      const addressPattern = pattern.trim() === '' ? null : pattern.trim()
      if (mode === 'edit' && existing) {
        await update.mutateAsync({
          id: existing.id,
          patch: {
            name: name.trim(),
            explorerUrlTemplate: template.trim(),
            addressPattern,
          },
        })
      } else {
        await create.mutateAsync({
          name: name.trim(),
          explorerUrlTemplate: template.trim(),
          addressPattern,
        })
      }
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const pending = create.isPending || update.isPending

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3"
    >
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Chain name
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ethereum"
          maxLength={80}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
        />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Explorer URL template
        </label>
        <input
          type="text"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="https://etherscan.io/address/{address}"
          maxLength={2048}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-zinc-600"
        />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Address pattern (optional regex)
        </label>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={`${DEFAULT_ADDRESS_PATTERN} (default — EVM)`}
          maxLength={512}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-zinc-600"
        />
        <p className="mt-1 text-[10px] text-zinc-500">
          Used to validate contract addresses. Leave empty for the EVM default.
        </p>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-1 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !name.trim() || !template.trim()}
          className="rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {pending ? 'Saving…' : mode === 'edit' ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  )
}

// ─── Backups ───────────────────────────────────────────────────────────────

/**
 * Backups section — wraps the `system.createBackup` / `restoreBackup` IPC
 * handlers. Backups land in `~/Documents/GitCanvas/backups/<timestamp>/`
 * with a manifest.json that records the schema version (Drizzle migration
 * journal) so older / newer builds can refuse to clobber each other.
 */
function BackupsSection() {
  const backups = useBackups()
  const root = useBackupsRoot()
  const create = useCreateBackup()
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    setError(null)
    try {
      await create.mutateAsync({ label: label.trim() || undefined })
      setLabel('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const openFolder = async () => {
    if (!root.data) return
    try {
      await api.system.openPath({ path: root.data })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="border-t border-zinc-800 px-6 py-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Archive size={14} className="text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-200">Backups</h3>
          {backups.data && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {backups.data.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={openFolder}
          disabled={!root.data}
          className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          title={root.data ?? ''}
        >
          <FolderOpen size={12} /> Open folder
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-zinc-500">
        Snapshots of the local SQLite database, stored in{' '}
        <code className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-300">
          {root.data ?? '~/Documents/GitCanvas/backups'}
        </code>
        . Restoring will replace your current data — a safety snapshot is taken
        automatically before every restore.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Optional label (e.g. 'before refactor')"
          maxLength={200}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={create.isPending}
          className="flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          <Plus size={12} /> {create.isPending ? 'Backing up…' : 'Back up now'}
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

      <ul className="mt-3 divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        {backups.isLoading && (
          <li className="px-3 py-3 text-xs text-zinc-600">Loading…</li>
        )}
        {!backups.isLoading && (backups.data?.length ?? 0) === 0 && (
          <li className="px-3 py-3 text-xs text-zinc-600">
            No backups yet. Click <em>Back up now</em> to create one.
          </li>
        )}
        {backups.data?.map((b) => <BackupRow key={b.id} backup={b} />)}
      </ul>
    </section>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatRelative(iso: string): string {
  if (!iso) return 'unknown date'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diffSec = Math.round((Date.now() - t) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`
  if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)}d ago`
  return new Date(iso).toLocaleString()
}

function BackupRow({ backup }: { backup: BackupSummary }) {
  const restore = useRestoreBackup()
  const del = useDeleteBackup()
  const [confirmingRestore, setConfirmingRestore] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  const handleRestore = async () => {
    setRowError(null)
    try {
      await restore.mutateAsync(backup.id)
      setConfirmingRestore(false)
    } catch (err) {
      setRowError((err as Error).message)
    }
  }

  const handleDelete = async () => {
    setRowError(null)
    try {
      await del.mutateAsync(backup.id)
    } catch (err) {
      setRowError((err as Error).message)
    }
  }

  return (
    <li className="group flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Database size={12} className="shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-zinc-100">
              {backup.label ?? backup.id}
            </span>
            {backup.corrupt && (
              <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-red-400">
                corrupt
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-zinc-500" title={backup.folderPath}>
            {formatRelative(backup.createdAt)} · {formatBytes(backup.dbBytes)} · schema
            v{backup.schemaVersion} · app {backup.appVersion || '—'}
          </div>
          {backup.corruptReason && (
            <div className="truncate text-[10px] text-red-400">{backup.corruptReason}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setConfirmingRestore(true)}
          disabled={backup.corrupt || restore.isPending}
          className="flex items-center gap-1 rounded p-1 text-zinc-500 opacity-0 hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Restore ${backup.id}`}
          title="Restore this backup"
        >
          <RefreshCw size={12} />
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={del.isPending}
          className="rounded p-1 text-zinc-600 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 disabled:opacity-30"
          aria-label={`Delete ${backup.id}`}
          title="Delete this backup"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {confirmingRestore && (
        <div className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
          Replace your current database with this backup? Your current data will be
          auto-saved to a new pre-restore backup before the swap.
          <div className="mt-1.5 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setConfirmingRestore(false)}
              className="rounded px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRestore}
              disabled={restore.isPending}
              className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {restore.isPending ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div className="mt-1 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-200">
          Permanently delete this backup folder? This cannot be undone.
          <div className="mt-1.5 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={del.isPending}
              className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {rowError && <p className="text-[10px] text-red-400">{rowError}</p>}
    </li>
  )
}
