import path from 'node:path'
import fs from 'node:fs/promises'
import fg from 'fast-glob'
import ignore, { type Ignore } from 'ignore'
import log from 'electron-log/main.js'
import type { DiscoveredLocalRepo } from '@gitcanvas/shared'

/**
 * Directories that should never be descended into. We rely on this list more
 * than depth limits because some real repos sit deep inside monorepos
 * (e.g. `~/work/clients/foo/services/bar`) and we want to find them, while
 * skipping the things that just bloat scan time.
 */
const IGNORE_DIRS = [
  '**/node_modules/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.tox/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/target/**',
  '**/Pods/**',
  '**/DerivedData/**',
  '**/Library/**',
]

const DEFAULT_MAX_DEPTH = 8

export type ScanOptions = {
  maxDepth?: number
  /**
   * When true, walk every `.gitignore` file from the scan root down toward
   * each candidate `.git` directory and skip any that are excluded by an
   * ancestor's gitignore. Catches the common pattern of vendoring a nested
   * repo and gitignoring it from the parent.
   */
  respectGitignore?: boolean
}

/**
 * Recursively walks `parentPath` looking for `.git` directories. Returns one
 * preview row per discovered repository — these are not yet persisted; callers
 * pass the user-selected subset to `addLocalBatch` to commit them.
 *
 * `existingRepoId` is left null here; the IPC handler enriches it after the
 * scan by joining against the `repos` table.
 */
export async function scanForLocalRepos(
  parentPath: string,
  options: ScanOptions = {},
): Promise<DiscoveredLocalRepo[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const respectGitignore = options.respectGitignore ?? false

  const stat = await fs.stat(parentPath).catch(() => null)
  if (!stat || !stat.isDirectory()) {
    log.warn(`[scan] not a directory: ${parentPath}`)
    return []
  }

  const matches = await fg('**/.git', {
    cwd: parentPath,
    onlyDirectories: true,
    deep: maxDepth,
    ignore: IGNORE_DIRS,
    followSymbolicLinks: false,
    suppressErrors: true,
    dot: true,
  })

  let candidatePaths = matches.map((match) => {
    // `match` is a relative posix path like `foo/bar/.git`. The repo lives
    // one directory up from that.
    const gitDirAbs = path.join(parentPath, match)
    return path.dirname(gitDirAbs)
  })

  if (respectGitignore) {
    candidatePaths = await filterByGitignore(parentPath, candidatePaths)
  }

  log.info(
    `[scan] ${parentPath} → ${candidatePaths.length} repos${respectGitignore ? ' (gitignore-respected)' : ''}`,
  )

  return candidatePaths.map((repoPath) => ({
    absolutePath: repoPath,
    name: path.basename(repoPath),
    ownerHint: path.basename(path.dirname(repoPath)),
    existingRepoId: null,
  }))
}

/**
 * For each candidate repo path, walk every directory from the scan root
 * toward the candidate looking for `.gitignore` files. Apply the rules in
 * order, scoping each rule to the directory it lives in (gitignore semantics).
 * If any ancestor's gitignore matches the relative path, exclude the candidate.
 *
 * Implementation note: a clean recursive walk would be more efficient than
 * re-reading .gitignore files for every candidate, but the candidate count
 * after fast-glob is typically small (dozens, not thousands) and gitignore
 * files are tiny, so the simpler approach is fine.
 */
async function filterByGitignore(
  scanRoot: string,
  candidates: string[],
): Promise<string[]> {
  // Cache parsed gitignore Ignore instances per directory.
  const cache = new Map<string, Ignore | null>()

  const loadIgnoreAt = async (dir: string): Promise<Ignore | null> => {
    if (cache.has(dir)) return cache.get(dir) ?? null
    try {
      const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf8')
      const ig = ignore().add(content)
      cache.set(dir, ig)
      return ig
    } catch {
      cache.set(dir, null)
      return null
    }
  }

  const isIgnored = async (candidatePath: string): Promise<boolean> => {
    // Walk every directory from scanRoot UP TO (but not including) the
    // candidate itself, looking for a `.gitignore` that excludes the
    // candidate. We stop one step short because checking the candidate
    // against its own gitignore is meaningless (and `ignore` throws on an
    // empty path).
    const candidateRel = path.relative(scanRoot, candidatePath)
    if (candidateRel.startsWith('..')) return false // outside scan root

    const segments = candidateRel.split(path.sep).filter(Boolean)
    // segments.length === N means N hops from scanRoot to candidate. We
    // visit scanRoot, scanRoot/seg0, ..., scanRoot/seg0/.../segN-2 — i.e.
    // N positions, all parents of the candidate.
    let cursor = scanRoot
    for (let i = 0; i < segments.length; i++) {
      const ig = await loadIgnoreAt(cursor)
      if (ig) {
        // Path of the candidate relative to THIS gitignore's directory.
        const relFromIg = path.relative(cursor, candidatePath)
        if (relFromIg && (ig.ignores(relFromIg) || ig.ignores(relFromIg + '/'))) {
          return true
        }
      }
      cursor = path.join(cursor, segments[i]!)
    }
    return false
  }

  const out: string[] = []
  for (const candidate of candidates) {
    if (!(await isIgnored(candidate))) out.push(candidate)
  }
  return out
}

/**
 * Light-touch validation that the given path exists and contains a `.git`
 * directory (or file, in the worktree case). Used before persisting a
 * single-folder add.
 */
export async function isLocalGitRepo(folderPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(folderPath, '.git')
    const stat = await fs.stat(gitPath)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}
