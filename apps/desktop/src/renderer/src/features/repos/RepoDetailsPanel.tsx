import { useState } from 'react'
import {
  Circle,
  Coins,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import type { BranchStatus, RepoAnnotation } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'
import { displayUrl, normalizeUrl } from '@renderer/lib/url'
import {
  buildExplorerUrl,
  findChainByName,
  getAddressRegex,
  useChains,
} from '@renderer/features/chains/useChains'
import { useRepo, useRepoBranches } from './useRepos'
import {
  useAddDomainAnnotation,
  useAddSmartContractAnnotation,
  useAnnotations,
  useDeleteAnnotation,
} from './useAnnotations'

type Props = {
  repoId: string
  onClose: () => void
}

const REPO_LEVEL_BRANCH = '__all__'

/**
 * Right-side panel that opens when a repo node is selected. Shows the repo's
 * branches with statuses, plus per-branch annotations (domains and smart
 * contracts) with inline add/remove forms. Also exposes "Open in Finder" and
 * "Refresh" actions.
 */
export function RepoDetailsPanel({ repoId, onClose }: Props) {
  const repo = useRepo(repoId)
  const branches = useRepoBranches(repoId)
  const annotations = useAnnotations(repoId)

  // Currently selected branch (or "__all__" for repo-level annotations).
  const [activeBranch, setActiveBranch] = useState<string>(REPO_LEVEL_BRANCH)
  const [adding, setAdding] = useState<'domain' | 'smart_contract' | null>(null)

  if (!repo.data) {
    return (
      <aside className="flex w-[380px] shrink-0 items-center justify-center border-l border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
        Loading…
      </aside>
    )
  }
  const r = repo.data

  const branchScope = activeBranch === REPO_LEVEL_BRANCH ? null : activeBranch
  const annotationsForActive = (annotations.data ?? []).filter((a) => {
    if (branchScope === null) return a.branchName === null
    return a.branchName === branchScope
  })

  const handleOpenFolder = () => {
    void api.system.openPath({ path: r.localPath })
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <header className="flex items-start justify-between border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-zinc-100">{r.name}</h2>
          <p className="truncate text-xs text-zinc-500" title={r.localPath}>
            {r.owner} · {r.localPath}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close panel"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <button
          type="button"
          onClick={handleOpenFolder}
          className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <FolderOpen size={12} /> Open folder
        </button>
        <button
          type="button"
          onClick={() => branches.refetch()}
          disabled={branches.isFetching}
          className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw
            size={12}
            className={branches.isFetching ? 'animate-spin' : ''}
          />
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── Branches ─────────────────────────────────────────────────── */}
        <section className="px-4 py-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Branches
          </h3>

          {branches.isLoading && (
            <div className="mt-2 text-xs text-zinc-600">Loading branches…</div>
          )}

          {!branches.isLoading && (branches.data?.length ?? 0) === 0 && (
            <div className="mt-2 text-xs text-zinc-600">No branches found.</div>
          )}

          <ul className="mt-2 space-y-0.5">
            <BranchRow
              label="All branches"
              isAggregate
              isActive={activeBranch === REPO_LEVEL_BRANCH}
              onClick={() => setActiveBranch(REPO_LEVEL_BRANCH)}
            />
            {branches.data?.map((b) => (
              <BranchRow
                key={b.name}
                branch={b}
                isActive={activeBranch === b.name}
                onClick={() => setActiveBranch(b.name)}
              />
            ))}
          </ul>
        </section>

        {/* ── Annotations for active branch ────────────────────────────── */}
        <section className="border-t border-zinc-800 px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {branchScope === null ? 'Repo-level annotations' : `On ${branchScope}`}
            </h3>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setAdding('domain')}
                className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                <Globe size={10} /> Domain
              </button>
              <button
                type="button"
                onClick={() => setAdding('smart_contract')}
                className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                <Coins size={10} /> Contract
              </button>
            </div>
          </div>

          {adding === 'domain' && (
            <DomainForm
              repoId={r.id}
              branchName={branchScope}
              onDone={() => setAdding(null)}
            />
          )}

          {adding === 'smart_contract' && (
            <SmartContractForm
              repoId={r.id}
              branchName={branchScope}
              onDone={() => setAdding(null)}
            />
          )}

          <ul className="mt-3 space-y-1.5">
            {annotationsForActive.length === 0 && !adding && (
              <li className="text-[11px] text-zinc-600">
                Nothing here yet. Add a domain or smart contract above.
              </li>
            )}
            {annotationsForActive.map((a) => (
              <AnnotationRow key={a.id} annotation={a} />
            ))}
          </ul>
        </section>
      </div>
    </aside>
  )
}

// ─── Branch row ──────────────────────────────────────────────────────────────

function BranchRow({
  branch,
  label,
  isActive,
  isAggregate,
  onClick,
}: {
  branch?: BranchStatus
  label?: string
  isActive: boolean
  isAggregate?: boolean
  onClick: () => void
}) {
  const display = label ?? branch?.name ?? ''
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition',
          isActive
            ? 'bg-violet-600/15 text-violet-100 ring-1 ring-inset ring-violet-500/30'
            : 'text-zinc-300 hover:bg-zinc-800/50',
        )}
      >
        <GitBranch size={11} className="shrink-0 text-zinc-500" />
        <span className="flex-1 truncate">
          {display}
          {branch?.isCurrent && (
            <span className="ml-1 text-[9px] uppercase tracking-wider text-emerald-400">
              current
            </span>
          )}
        </span>
        {!isAggregate && branch && (
          <span className="flex items-center gap-1 text-[10px] text-zinc-500">
            {branch.isDirty && (
              <Circle size={6} fill="#fbbf24" stroke="none" aria-label="dirty" />
            )}
            {branch.ahead > 0 && <span>↑{branch.ahead}</span>}
            {branch.behind > 0 && <span>↓{branch.behind}</span>}
          </span>
        )}
      </button>
    </li>
  )
}

// ─── Annotation row ──────────────────────────────────────────────────────────

function AnnotationRow({ annotation }: { annotation: RepoAnnotation }) {
  const del = useDeleteAnnotation()
  const chains = useChains()

  if (annotation.kind === 'domain') {
    return (
      <li className="group flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-2">
        <Globe size={12} className="mt-0.5 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                void api.system.openExternal({ url: normalizeUrl(annotation.data.url) })
              }}
              className="truncate text-xs text-zinc-100 hover:underline"
              title={annotation.data.url}
            >
              {displayUrl(annotation.data.url)}
            </a>
            <ExternalLink size={10} className="shrink-0 text-zinc-600" />
          </div>
          {annotation.data.environment && (
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {annotation.data.environment}
            </div>
          )}
          {annotation.data.note && (
            <div className="mt-0.5 text-[11px] text-zinc-400">{annotation.data.note}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => del.mutate({ id: annotation.id, repoId: annotation.repoId })}
          className="rounded p-1 text-zinc-600 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
          aria-label="Delete annotation"
        >
          <Trash2 size={11} />
        </button>
      </li>
    )
  }

  const explorerUrl = buildExplorerUrl(
    chains.data,
    annotation.data.chain,
    annotation.data.address,
  )

  return (
    <li className="group flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-2">
      <Coins size={12} className="mt-0.5 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-300">
            {annotation.data.chain}
          </span>
          {annotation.data.name && (
            <span className="text-xs font-medium text-zinc-100">{annotation.data.name}</span>
          )}
        </div>
        {explorerUrl ? (
          <button
            type="button"
            onClick={() => void api.system.openExternal({ url: explorerUrl })}
            className="mt-0.5 flex w-full items-center gap-1 truncate text-left font-mono text-[11px] text-zinc-400 hover:text-emerald-300 hover:underline"
            title={`Open ${annotation.data.address} on ${annotation.data.chain} explorer`}
          >
            <span className="truncate">{annotation.data.address}</span>
            <ExternalLink size={10} className="shrink-0 text-zinc-600" />
          </button>
        ) : (
          <div
            className="mt-0.5 truncate font-mono text-[11px] text-zinc-400"
            title={`Add chain "${annotation.data.chain}" in Settings to enable explorer links`}
          >
            {annotation.data.address}
          </div>
        )}
        {annotation.data.note && (
          <div className="mt-0.5 text-[11px] text-zinc-400">{annotation.data.note}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => del.mutate({ id: annotation.id, repoId: annotation.repoId })}
        className="rounded p-1 text-zinc-600 opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
        aria-label="Delete annotation"
      >
        <Trash2 size={11} />
      </button>
    </li>
  )
}

// ─── Inline add forms ────────────────────────────────────────────────────────

function DomainForm({
  repoId,
  branchName,
  onDone,
}: {
  repoId: string
  branchName: string | null
  onDone: () => void
}) {
  const add = useAddDomainAnnotation()
  const [url, setUrl] = useState('')
  const [environment, setEnvironment] = useState('')
  const [note, setNote] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    await add.mutateAsync({
      repoId,
      branchName,
      data: {
        // Always store normalized URLs so we never have to guess at click time.
        url: normalizeUrl(url),
        environment: environment.trim() || undefined,
        note: note.trim() || undefined,
      },
    })
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-2">
      <FormInput placeholder="https://example.com" value={url} onChange={setUrl} autoFocus />
      <FormInput placeholder="Environment (production, staging…)" value={environment} onChange={setEnvironment} />
      <FormInput placeholder="Note (optional)" value={note} onChange={setNote} />
      <FormActions onCancel={onDone} pending={add.isPending} disabled={!url.trim()} />
    </form>
  )
}

function SmartContractForm({
  repoId,
  branchName,
  onDone,
}: {
  repoId: string
  branchName: string | null
  onDone: () => void
}) {
  const add = useAddSmartContractAnnotation()
  const chains = useChains()
  // Default to the first chain in the list once it loads.
  const [chain, setChain] = useState('')
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Once chains have loaded, pre-pick the first one so the user doesn't have
  // to think about it for the common case.
  if (!chain && chains.data && chains.data.length > 0) {
    setChain(chains.data[0]!.name)
  }

  const selectedChain = findChainByName(chains.data, chain)
  const addressRegex = getAddressRegex(selectedChain)
  const trimmedAddress = address.trim()
  const addressInvalid = trimmedAddress.length > 0 && addressRegex !== null && !addressRegex.test(trimmedAddress)
  const canSubmit =
    chain.trim().length > 0 &&
    trimmedAddress.length > 0 &&
    !addressInvalid &&
    (chains.data?.length ?? 0) > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!canSubmit) return
    try {
      await add.mutateAsync({
        repoId,
        branchName,
        data: {
          chain: chain.trim(),
          address: trimmedAddress,
          name: name.trim() || undefined,
          note: note.trim() || undefined,
        },
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // No chains configured yet — push the user to Settings instead of letting
  // them type a freeform chain.
  if (chains.data && chains.data.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-[11px] text-amber-200">
        No chains configured. Open <span className="font-semibold">Settings</span> from the
        titlebar to add a chain before attaching smart contract annotations.
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onDone}
            className="rounded px-2 py-0.5 text-[11px] text-amber-300 hover:bg-amber-500/10"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-2"
    >
      <div>
        <label className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
          Chain
        </label>
        <select
          autoFocus
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-zinc-600"
        >
          {chains.data?.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <input
          type="text"
          value={address}
          placeholder="Contract address"
          onChange={(e) => setAddress(e.target.value)}
          className={clsx(
            'w-full rounded border bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 outline-none',
            addressInvalid
              ? 'border-red-700 focus:border-red-600'
              : 'border-zinc-800 focus:border-zinc-600',
          )}
        />
        {addressInvalid && (
          <p className="mt-0.5 text-[10px] text-red-400">
            Address doesn&apos;t match the {selectedChain?.name ?? 'chain'} pattern.
          </p>
        )}
      </div>

      <FormInput placeholder="Name (optional)" value={name} onChange={setName} />
      <FormInput placeholder="Note (optional)" value={note} onChange={setNote} />

      {error && <p className="text-[10px] text-red-400">{error}</p>}

      <FormActions onCancel={onDone} pending={add.isPending} disabled={!canSubmit} />
    </form>
  )
}

function FormInput({
  placeholder,
  value,
  onChange,
  autoFocus,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <input
      autoFocus={autoFocus}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
    />
  )
}

function FormActions({
  onCancel,
  pending,
  disabled,
}: {
  onCancel: () => void
  pending: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex justify-end gap-1 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled || pending}
        className="flex items-center gap-1 rounded bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
      >
        <Plus size={10} />
        {pending ? 'Adding…' : 'Add'}
      </button>
    </div>
  )
}
