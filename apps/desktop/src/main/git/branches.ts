import { simpleGit } from 'simple-git'
import log from 'electron-log/main.js'
import type { BranchStatus } from '@gitcanvas/shared'

/**
 * Returns one row per local branch with as much status as we can capture
 * without checking out the branch. The trick:
 *
 *   git for-each-ref refs/heads \
 *     --format='%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname)|%(authordate:iso-strict)|%(contents:subject)'
 *
 * `%(upstream:track)` returns strings like "[ahead 2]", "[behind 1]",
 * "[ahead 3, behind 2]", or "[gone]" — we parse those into structured ints.
 *
 * The current branch is detected via `git symbolic-ref HEAD` and only that
 * branch can be flagged dirty (working tree state is global, not per branch).
 */
export async function getBranchStatuses(repoPath: string): Promise<BranchStatus[]> {
  try {
    const git = simpleGit({
      baseDir: repoPath,
      binary: 'git',
      maxConcurrentProcesses: 1,
      timeout: { block: 5_000 },
    })

    const SEP = '|'
    const FORMAT =
      '%(refname:short)' +
      SEP +
      '%(upstream:short)' +
      SEP +
      '%(upstream:track)' +
      SEP +
      '%(objectname)' +
      SEP +
      '%(authordate:iso-strict)' +
      SEP +
      '%(contents:subject)'

    const [forEachRaw, headRaw, statusSummary] = await Promise.all([
      git.raw(['for-each-ref', `--format=${FORMAT}`, 'refs/heads']),
      git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
      git.status().catch(() => null),
    ])

    const currentBranch = headRaw.trim()
    const isDirty = statusSummary ? !statusSummary.isClean() : false

    const branches: BranchStatus[] = []
    for (const line of forEachRaw.split('\n')) {
      if (!line.trim()) continue
      const [name, upstream, track, sha, authoredAt, ...rest] = line.split(SEP)
      if (!name) continue

      const message = rest.join(SEP) // subjects can contain the separator char
      const { ahead, behind } = parseTrack(track ?? '')
      const isCurrent = name === currentBranch

      branches.push({
        name,
        isCurrent,
        isDirty: isCurrent ? isDirty : false,
        ahead,
        behind,
        upstream: upstream && upstream.length > 0 ? upstream : null,
        lastCommit: sha
          ? {
              sha,
              message: message ?? '',
              authoredAt: authoredAt ?? '',
            }
          : null,
      })
    }

    // Sort: current first, then alphabetical
    branches.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return branches
  } catch (err) {
    log.warn(`[git] branches read failed for ${repoPath}`, err)
    return []
  }
}

/**
 * Parses git's `%(upstream:track)` output:
 *   ""                    → ahead 0, behind 0
 *   "[ahead 2]"           → ahead 2, behind 0
 *   "[behind 1]"          → ahead 0, behind 1
 *   "[ahead 3, behind 2]" → ahead 3, behind 2
 *   "[gone]"              → ahead 0, behind 0 (treat as no tracking info)
 */
function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
  }
}
