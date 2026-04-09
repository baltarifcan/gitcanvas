/**
 * Domain models for GitCanvas.
 *
 * IMPORTANT: This file must remain runtime-dependency-free so it can be imported
 * from both the Electron main process (Node) and the renderer (browser).
 */

/** ULID — sortable, URL-safe, 26 chars. */
export type ID = string

/** ISO-8601 timestamp string. */
export type ISODateString = string

// ─── Repositories ────────────────────────────────────────────────────────────

export type Repo = {
  id: ID
  owner: string
  name: string
  /** `${owner}/${name}` — derived from local path or git remote. */
  fullName: string
  description: string | null
  primaryLanguage: string | null
  defaultBranch: string | null
  /** Absolute filesystem path. Required — every repo is local. */
  localPath: string
  topics: string[]
  /**
   * User-flagged "this repo is retired". Global to the repo (not per
   * board-instance) so it propagates everywhere the repo is referenced.
   * Repo nodes render with an accessible orange treatment when true.
   */
  archived: boolean
  createdAt: ISODateString
}

export type LocalGitStatus = {
  branch: string | null
  isDirty: boolean
  ahead: number
  behind: number
  lastCommit: {
    sha: string
    message: string
    authoredAt: ISODateString
  } | null
}

/**
 * Per-branch status row used by the repo details panel. `git for-each-ref`
 * gives us all of these in a single call without checking out the branch.
 */
export type BranchStatus = {
  name: string
  isCurrent: boolean
  /** Only meaningful when isCurrent === true. */
  isDirty: boolean
  ahead: number
  behind: number
  upstream: string | null
  lastCommit: {
    sha: string
    message: string
    authoredAt: ISODateString
  } | null
}

/**
 * Preview row returned by `repos.scanLocal` — not yet persisted. The renderer
 * lets the user multi-select which discoveries to import; selected rows then
 * become real {@link Repo} entries via `repos.addLocalBatch`.
 */
export type DiscoveredLocalRepo = {
  absolutePath: string
  name: string
  /** Parent directory name — useful as a heuristic owner label. */
  ownerHint: string
  /** Set when this path is already in the DB so the UI can mark it as imported. */
  existingRepoId: ID | null
}

// ─── Repo annotations ────────────────────────────────────────────────────────

export type AnnotationKind = 'domain' | 'smart_contract'

export type DomainAnnotationData = {
  url: string
  environment?: string
  note?: string
}

export type SmartContractAnnotationData = {
  chain: string
  address: string
  name?: string
  note?: string
}

type BaseAnnotation = {
  id: ID
  repoId: ID
  /** NULL → applies to the whole repo regardless of branch. */
  branchName: string | null
  createdAt: ISODateString
}

export type DomainAnnotation = BaseAnnotation & {
  kind: 'domain'
  data: DomainAnnotationData
}

export type SmartContractAnnotation = BaseAnnotation & {
  kind: 'smart_contract'
  data: SmartContractAnnotationData
}

export type RepoAnnotation = DomainAnnotation | SmartContractAnnotation

// ─── Chains ──────────────────────────────────────────────────────────────────

/**
 * User-defined chain with its block explorer URL template. The template
 * contains `{address}` as the substitution placeholder; the renderer turns
 * `https://etherscan.io/address/{address}` + `0xabc...` into a link.
 *
 * `addressPattern` is an optional regex (without delimiters or flags) used
 * to validate contract addresses entered against this chain. When null, the
 * renderer falls back to the EVM default (`^0x[a-fA-F0-9]{40}$`).
 */
export type Chain = {
  id: ID
  name: string
  explorerUrlTemplate: string
  addressPattern: string | null
  createdAt: ISODateString
}

// ─── Repository lists (org-level named collections) ─────────────────────────

/**
 * A named, org-level collection of repositories. Lists let the user carve up
 * their global repository library into buckets (e.g. "Frontend apps",
 * "Infra repos") and then import a whole list into a board in a single click.
 *
 * A board can optionally be linked to at most one list via
 * {@link Board.syncedListId}. When linked, adding or removing repos from the
 * list propagates to that board's nodes automatically — see
 * {@link RepoBoardNode.sourceListId}.
 */
export type RepoList = {
  id: ID
  name: string
  description: string | null
  /** Number of repos currently in the list. */
  repoCount: number
  createdAt: ISODateString
  updatedAt: ISODateString
}

/** Full list with its repo membership expanded — used by the manage dialog. */
export type RepoListWithRepos = RepoList & {
  repos: Repo[]
}

export type CreateRepoListInput = {
  name: string
  description?: string
}

export type UpdateRepoListInput = {
  name?: string
  description?: string | null
}

// ─── Boards ──────────────────────────────────────────────────────────────────

export type Board = {
  id: ID
  name: string
  description: string | null
  /**
   * Optional link to a {@link RepoList}. When set, adding/removing repos
   * from the list propagates to this board's nodes automatically.
   */
  syncedListId: ID | null
  createdAt: ISODateString
  updatedAt: ISODateString
}

export type BoardNodeKind = 'repo' | 'note' | 'group'

export type Position = { x: number; y: number }
export type Size = { width: number; height: number }

export type NoteNodeData = {
  /** Markdown content. */
  content: string
}

/**
 * How a group arranges its direct children:
 *
 *   `free`       — children float freely; user positions each one (default).
 *   `vertical`   — children stack top-to-bottom inside the group.
 *   `horizontal` — children stack left-to-right inside the group.
 *
 * For `vertical` / `horizontal`, child positions are recomputed by the canvas
 * layout pass on every fit, so dragging a child within a directed group is
 * effectively a "no-op" — the user reorders by dragging children past each
 * other along the layout axis.
 */
export type GroupLayoutMode = 'free' | 'vertical' | 'horizontal'

export type GroupNodeData = {
  label: string
  /** Hex color, e.g. `#7c3aed`. */
  color: string
  /**
   * Layout strategy for direct children. Defaults to `free` when omitted so
   * pre-existing groups keep their freeform behavior.
   */
  layoutMode?: GroupLayoutMode
}

/**
 * Per-instance configuration for a repo node on a board. Two instances of
 * the same repo can be configured differently — e.g. one pins three feature
 * branches with their statuses, another shows nothing but the repo header.
 *
 * Stored in the polymorphic `board_nodes.data` JSON column. All fields are
 * optional with sensible runtime defaults so existing nodes continue to work.
 *
 * Branches are NOT shown by default — pin them explicitly. This keeps fresh
 * repo nodes minimal and lets the user opt in to detail.
 */
export type RepoNodeData = {
  /** Branch names to render as inline rows on the node. Empty/undefined → no branches shown. */
  visibleBranches?: string[]
  /**
   * Optional color override per branch. Keys are branch names, values are
   * hex color strings (e.g. `#7c3aed`). The branch label, status icons, and
   * any inline annotations under that branch are tinted with this color.
   * Branches without an entry use a neutral default.
   */
  branchColors?: Record<string, string>
  /** Show the per-branch status line (dirty/ahead/behind/last commit). Default true. */
  showBranchDetails?: boolean
  /** Render annotations (domain url, smart contract chain+address, etc.) inline. Default false. */
  showAnnotations?: boolean
  /**
   * Free-form per-instance notes shown on the node directly under the title /
   * folder header. Per-instance (not on `Repo`) so the same repo can carry
   * board-specific commentary on different boards.
   */
  notes?: string
}

type BaseNode = {
  id: ID
  boardId: ID
  parentId: ID | null
  position: Position
  size: Size
  zIndex: number
  createdAt: ISODateString
  updatedAt: ISODateString
}

export type RepoBoardNode = BaseNode & {
  kind: 'repo'
  repoId: ID
  /**
   * Set when this node was materialised from a {@link RepoList} import/sync.
   * Null for manually-added repo nodes. Used by the sync logic so that
   * removing a repo from the linked list only deletes the list-managed
   * node, not any manually-placed instances of the same repo.
   */
  sourceListId: ID | null
  data: RepoNodeData
}

export type NoteBoardNode = BaseNode & {
  kind: 'note'
  repoId: null
  data: NoteNodeData
}

export type GroupBoardNode = BaseNode & {
  kind: 'group'
  repoId: null
  data: GroupNodeData
}

export type BoardNode = RepoBoardNode | NoteBoardNode | GroupBoardNode

export type BoardWithNodes = Board & {
  nodes: BoardNode[]
}

// ─── Patches / inputs ────────────────────────────────────────────────────────

export type CreateBoardInput = {
  name: string
  description?: string
}

export type UpdateBoardInput = {
  name?: string
  description?: string | null
}

export type UpdateNodePatch = {
  position?: Position
  size?: Size
  parentId?: ID | null
  zIndex?: number
  data?: NoteNodeData | GroupNodeData | RepoNodeData
}

// ─── Backups ─────────────────────────────────────────────────────────────────

/**
 * Metadata for a single DB backup folder under `~/Documents/GitCanvas/backups`.
 * The shape is shared between the main process (which writes the manifest)
 * and the renderer (which lists / restores them).
 *
 * `formatVersion` is the manifest's *own* schema version — bumped if the
 * manifest layout itself ever changes. `migrations` is the Drizzle migration
 * journal at the time the backup was taken; restore validates that every
 * tag in this list is also present in the current build before swapping
 * the live DB, so older builds can't accidentally clobber a newer schema.
 */
export type BackupSummary = {
  formatVersion: number
  /** Folder name. ISO-8601 timestamp with `:` swapped for `-` (FS-safe). */
  id: ID
  createdAt: ISODateString
  label?: string
  appVersion: string
  migrations: string[]
  /** Convenience — `migrations.length`. */
  schemaVersion: number
  dbFile: string
  dbBytes: number
  /** Absolute path to the backup folder, useful for "open in Finder". */
  folderPath: string
  /** True when the manifest is unparseable or the .db file is missing. */
  corrupt?: boolean
  corruptReason?: string
}
