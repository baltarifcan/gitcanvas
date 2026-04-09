import { memo, useMemo } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { Circle, Coins, ExternalLink, FolderGit2, GitBranch, Globe } from 'lucide-react'
import clsx from 'clsx'
import type { BranchStatus, Chain, RepoAnnotation } from '@gitcanvas/shared'
import { useLocalStatus, useRepo, useRepoBranches } from '@renderer/features/repos/useRepos'
import { useAnnotations } from '@renderer/features/repos/useAnnotations'
import { buildExplorerUrl, useChains } from '@renderer/features/chains/useChains'
import { api } from '@renderer/lib/api'
import { displayUrl, normalizeUrl } from '@renderer/lib/url'
import type { RepoFlowNode } from '@renderer/features/canvas/nodeMapping'

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  if (Number.isNaN(diff)) return ''
  const sec = Math.max(0, Math.floor(diff / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.floor(day / 7)
  if (wk < 4) return `${wk}w`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(day / 365)}y`
}

function shortenAddress(addr: string): string {
  if (addr.length <= 14) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function RepoNodeImpl({ data, selected }: NodeProps<RepoFlowNode>) {
  const repo = useRepo(data.repoId)

  const showBranchDetails = data.showBranchDetails ?? true
  const showAnnotations = data.showAnnotations ?? true
  /**
   * Branch visibility semantics:
   *
   *   undefined → show ALL branches (default for fresh nodes)
   *   []         → explicit opt-out, header only
   *   [a, b]     → show only the listed branches
   *
   * Distinguishing undefined from [] lets the user click "save" in the
   * config dialog without losing the "show all" default — only nodes the
   * user has actively narrowed down end up with an explicit array.
   */
  const showAllBranches = data.visibleBranches === undefined
  const explicitBranches = data.visibleBranches ?? []
  const branchColors = data.branchColors ?? {}
  const hasExplicitBranches = !showAllBranches && explicitBranches.length > 0
  const shouldRenderBranches = showAllBranches || hasExplicitBranches

  // Fetch branches whenever we plan to render them — either because the user
  // hasn't configured this node yet (show-all default) or because they pinned
  // a specific set. Skip the git call only when they explicitly opted out.
  const branches = useRepoBranches(shouldRenderBranches ? data.repoId : null)
  const annotations = useAnnotations(showAnnotations ? data.repoId : null)
  const localStatus = useLocalStatus(repo.data ? data.repoId : null)
  // Chains list is shared/global; the React Query cache dedupes across nodes.
  const chains = useChains()

  const pinnedBranches = useMemo<BranchStatus[]>(() => {
    if (!branches.data) return []
    if (showAllBranches) return branches.data
    if (!hasExplicitBranches) return []
    const set = new Set(explicitBranches)
    return branches.data.filter((b) => set.has(b.name))
  }, [branches.data, explicitBranches, hasExplicitBranches, showAllBranches])

  const annotationsByBranch = useMemo(() => {
    const map = new Map<string, RepoAnnotation[]>()
    if (!annotations.data) return map
    for (const a of annotations.data) {
      if (!a.branchName) continue
      const arr = map.get(a.branchName) ?? []
      arr.push(a)
      map.set(a.branchName, arr)
    }
    return map
  }, [annotations.data])

  const repoLevelAnnotations = useMemo<RepoAnnotation[]>(() => {
    if (!annotations.data) return []
    return annotations.data.filter((a) => a.branchName === null)
  }, [annotations.data])

  if (repo.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-xs text-zinc-600">
        Loading…
      </div>
    )
  }

  if (!repo.data) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-red-900 bg-red-950/30 text-xs text-red-400">
        Repo missing
      </div>
    )
  }

  const r = repo.data

  return (
    <div className="relative h-full w-full">
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={80}
        lineClassName="!border-violet-400"
        handleClassName="!h-3 !w-3 !rounded-sm !border-violet-500 !bg-violet-200"
      />

      {/* Inner clipping layer — keeps the colored chrome inside the node bounds
          but lets NodeResizer's handles render at the corners outside any clip. */}
      <div
        className={clsx(
          'absolute inset-0 flex flex-col overflow-hidden rounded-xl border bg-zinc-900 text-zinc-200 shadow-md transition',
          selected ? 'border-violet-500 ring-2 ring-violet-500/30' : 'border-zinc-800',
        )}
      >
        <header className="flex items-start gap-2 px-3 pb-1.5 pt-2">
          <div className="mt-0.5 shrink-0 text-zinc-500">
            <FolderGit2 size={14} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight text-zinc-100">
              {r.name}
            </div>
            <div className="truncate text-[11px] text-zinc-500">{r.owner}</div>
          </div>
        </header>

        {/* Pinned branches with optional inline annotations under each. */}
        {shouldRenderBranches && (
          <ul className="space-y-0.5 border-t border-zinc-800 px-3 py-1.5">
            {branches.isLoading && (
              <li className="text-[10px] text-zinc-600">loading branches…</li>
            )}
            {pinnedBranches.length === 0 && !branches.isLoading && (
              <li className="text-[10px] text-zinc-600">
                {showAllBranches ? 'no branches' : 'no matching branches'}
              </li>
            )}
            {pinnedBranches.map((b) => {
              const branchColor = branchColors[b.name]
              return (
                <li key={b.name}>
                  <BranchLine
                    branch={b}
                    showDetails={showBranchDetails}
                    status={b.isCurrent ? localStatus.data ?? null : null}
                    color={branchColor}
                  />
                  {showAnnotations && (annotationsByBranch.get(b.name)?.length ?? 0) > 0 && (
                    <ul
                      className="mt-0.5 ml-3 space-y-0.5 border-l pl-2"
                      style={{
                        borderColor: branchColor ? `${branchColor}55` : '#27272a',
                      }}
                    >
                      {annotationsByBranch.get(b.name)!.map((a) => (
                        <AnnotationDetailRow
                          key={a.id}
                          annotation={a}
                          accentColor={branchColor}
                          chains={chains.data}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* Repo-level annotations (not tied to any branch). */}
        {showAnnotations && repoLevelAnnotations.length > 0 && (
          <div className="border-t border-zinc-800 px-3 py-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
              Repo-level
            </div>
            <ul className="mt-0.5 space-y-0.5">
              {repoLevelAnnotations.map((a) => (
                <AnnotationDetailRow key={a.id} annotation={a} chains={chains.data} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function BranchLine({
  branch,
  showDetails,
  status,
  color,
}: {
  branch: BranchStatus
  showDetails: boolean
  status: { isDirty: boolean; ahead: number; behind: number } | null
  /** Per-branch user-chosen tint, if any. */
  color?: string
}) {
  // For the current branch, prefer the live `git status` numbers when we have
  // them — `git for-each-ref` doesn't catch uncommitted changes.
  const isDirty = status?.isDirty ?? branch.isDirty
  const ahead = status?.ahead ?? branch.ahead
  const behind = status?.behind ?? branch.behind
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <GitBranch
        size={10}
        className="shrink-0"
        style={{ color: color ?? '#71717a' }}
      />
      <span
        className={clsx('truncate', !color && (branch.isCurrent ? 'text-zinc-100' : 'text-zinc-300'))}
        style={color ? { color } : undefined}
      >
        {branch.name}
      </span>
      {branch.isCurrent && (
        <span className="text-[8px] uppercase tracking-wider text-emerald-400">●</span>
      )}
      {showDetails && (
        <>
          {isDirty && <Circle size={6} fill="#fbbf24" stroke="none" aria-label="dirty" />}
          {(ahead > 0 || behind > 0) && (
            <span className="text-[9px] text-zinc-500">
              {ahead > 0 ? `↑${ahead}` : ''}
              {behind > 0 ? `↓${behind}` : ''}
            </span>
          )}
        </>
      )}
      {showDetails && branch.lastCommit && (
        <span className="ml-auto text-[9px] text-zinc-600">
          {relativeTime(branch.lastCommit.authoredAt)}
        </span>
      )}
    </div>
  )
}

function AnnotationDetailRow({
  annotation,
  accentColor,
  chains,
}: {
  annotation: RepoAnnotation
  /** Optional tint inherited from the parent branch's configured color. */
  accentColor?: string
  /** Chain definitions used to resolve smart contract → explorer URLs. */
  chains: Chain[] | undefined
}) {
  // Default kind colors when no per-branch override is set.
  const defaultIconColor = annotation.kind === 'domain' ? '#34d399' : '#fbbf24' // emerald / amber
  const iconColor = accentColor ?? defaultIconColor
  const chipBg = accentColor ? `${accentColor}1a` : annotation.kind === 'domain' ? '#10b9811a' : '#f59e0b1a'
  const chipFg = accentColor ?? (annotation.kind === 'domain' ? '#6ee7b7' : '#fcd34d')

  if (annotation.kind === 'domain') {
    return (
      <li className="group/anno flex items-center gap-1 text-[10px] leading-tight">
        <Globe size={9} className="shrink-0" style={{ color: iconColor }} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void api.system.openExternal({ url: normalizeUrl(annotation.data.url) })
          }}
          className="truncate text-zinc-300 hover:underline"
          style={accentColor ? { color: accentColor } : undefined}
          title={annotation.data.url}
        >
          {displayUrl(annotation.data.url)}
        </button>
        {annotation.data.environment && (
          <span
            className="rounded px-1 text-[8px] uppercase tracking-wider"
            style={{ backgroundColor: chipBg, color: chipFg }}
          >
            {annotation.data.environment}
          </span>
        )}
        <ExternalLink size={8} className="shrink-0 text-zinc-700 opacity-0 group-hover/anno:opacity-100" />
      </li>
    )
  }
  // Smart contract case — try to resolve a clickable explorer URL.
  const explorerUrl = buildExplorerUrl(chains, annotation.data.chain, annotation.data.address)
  const addressEl = (
    <span
      className="truncate font-mono text-[9px] text-zinc-500"
      title={annotation.data.address}
    >
      {shortenAddress(annotation.data.address)}
    </span>
  )

  return (
    <li className="flex items-center gap-1 text-[10px] leading-tight">
      <Coins size={9} className="shrink-0" style={{ color: iconColor }} />
      <span
        className="rounded px-1 text-[8px] uppercase tracking-wider"
        style={{ backgroundColor: chipBg, color: chipFg }}
      >
        {annotation.data.chain}
      </span>
      {annotation.data.name && (
        <span
          className="truncate text-zinc-300"
          style={accentColor ? { color: accentColor } : undefined}
        >
          {annotation.data.name}
        </span>
      )}
      {explorerUrl ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void api.system.openExternal({ url: explorerUrl })
          }}
          className="ml-auto truncate hover:underline"
          title={`Open ${annotation.data.address} on ${annotation.data.chain} explorer`}
        >
          {addressEl}
        </button>
      ) : (
        <span className="ml-auto" title={`Add a chain named "${annotation.data.chain}" in Settings to enable explorer links`}>
          {addressEl}
        </span>
      )}
    </li>
  )
}

export const RepoNode = memo(RepoNodeImpl)
