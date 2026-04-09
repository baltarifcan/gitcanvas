import { simpleGit, type SimpleGit } from 'simple-git'
import log from 'electron-log/main.js'
import type { LocalGitStatus } from '@gitcanvas/shared'

const EMPTY_STATUS: LocalGitStatus = {
  branch: null,
  isDirty: false,
  ahead: 0,
  behind: 0,
  lastCommit: null,
}

function client(repoPath: string): SimpleGit {
  return simpleGit({
    baseDir: repoPath,
    binary: 'git',
    maxConcurrentProcesses: 1,
    timeout: { block: 5_000 },
  })
}

/**
 * Reads working-tree status + the most recent commit. Designed to be called
 * frequently from the renderer (on focus, on demand) without throwing — any
 * git failure (corrupt repo, permission denied, missing binary) collapses to
 * an empty status that the UI renders as "unknown".
 */
export async function getLocalGitStatus(repoPath: string): Promise<LocalGitStatus> {
  try {
    const git = client(repoPath)
    const [status, log1] = await Promise.all([
      git.status(),
      git.log({ maxCount: 1 }).catch(() => ({ latest: null })),
    ])

    return {
      branch: status.current,
      isDirty: !status.isClean(),
      ahead: status.ahead ?? 0,
      behind: status.behind ?? 0,
      lastCommit: log1.latest
        ? {
            sha: log1.latest.hash,
            message: log1.latest.message,
            authoredAt: log1.latest.date,
          }
        : null,
    }
  } catch (err) {
    log.warn(`[git] status failed for ${repoPath}`, err)
    return EMPTY_STATUS
  }
}

/**
 * Reads metadata that's safe to capture once at import time: default branch
 * (best-effort) and remote URL (used to derive owner/name for GitHub-cloned
 * local repos).
 */
export async function getLocalRepoMetadata(repoPath: string): Promise<{
  defaultBranch: string | null
  remoteUrl: string | null
}> {
  try {
    const git = client(repoPath)
    const [branchSummary, remotes] = await Promise.all([
      git.branch().catch(() => null),
      git.getRemotes(true).catch(() => []),
    ])
    const origin = remotes.find((r) => r.name === 'origin')
    return {
      defaultBranch: branchSummary?.current ?? null,
      remoteUrl: origin?.refs.fetch ?? null,
    }
  } catch (err) {
    log.warn(`[git] metadata read failed for ${repoPath}`, err)
    return { defaultBranch: null, remoteUrl: null }
  }
}

/**
 * Best-effort owner/name extraction from a remote URL. Handles both
 * `git@github.com:owner/name.git` and `https://github.com/owner/name(.git)`.
 */
export function parseRemoteOwnerName(
  remoteUrl: string | null,
): { owner: string; name: string } | null {
  if (!remoteUrl) return null
  const ssh = /^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return { owner: ssh[1]!, name: ssh[2]! }
  const https = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl)
  if (https) return { owner: https[1]!, name: https[2]! }
  return null
}
