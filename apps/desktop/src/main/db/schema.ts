/**
 * Drizzle schema — single source of truth for the SQLite database.
 *
 * Conventions:
 *  - Primary keys are ULID strings (sortable, URL-safe, 26 chars).
 *  - Timestamps are ISO-8601 strings stored as TEXT — matches the
 *    `ISODateString` type in `@gitcanvas/shared/models` and is human-readable
 *    when poking at the DB with `sqlite3` or drizzle-studio.
 *  - JSON-shaped columns use `text({ mode: 'json' })`.
 *  - All FKs are `ON DELETE CASCADE` so deleting a board takes its nodes
 *    with it, and deleting a repo removes its node from any boards that
 *    referenced it (and any annotations attached to its branches).
 *
 * NOTE: GitHub integration was removed in migration 0001 along with the
 * `accounts` and `board_sources` tables. Local-only.
 */

import { sql } from 'drizzle-orm'
import { index, sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

// ─── Repositories ────────────────────────────────────────────────────────────

export const repos = sqliteTable(
  'repos',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    description: text('description'),
    primaryLanguage: text('primary_language'),
    defaultBranch: text('default_branch'),
    /** Absolute filesystem path. Local-only — every repo has one. */
    localPath: text('local_path').notNull(),
    topics: text('topics', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /**
     * Archived state — reflects whether the user has retired this repo. The
     * flag is global (not per-board-instance) so it propagates to every node
     * referencing the repo. Stored as 0/1; converted to a JS boolean at the
     * IPC boundary in `queries/repos.ts` (rowToRepo + setRepoArchived). We
     * keep this as a plain integer rather than `mode: 'boolean'` so the
     * write/read paths are explicit and unambiguous — easier to debug and
     * matches the rest of the schema's "TEXT/INT only" convention.
     */
    archived: integer('archived').notNull().default(0),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (t) => ({
    fullNameIdx: index('repos_full_name_idx').on(t.fullName),
    localPathIdx: index('repos_local_path_idx').on(t.localPath),
  }),
)

// ─── Repo annotations (per repo, optionally per branch) ─────────────────────

export const repoAnnotations = sqliteTable(
  'repo_annotations',
  {
    id: text('id').primaryKey(),
    repoId: text('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /**
     * NULL → annotation applies to the whole repo regardless of branch.
     * Otherwise, scoped to a single branch by name. We don't FK to a
     * branches table because branches are not persisted — they're read live
     * from `git for-each-ref`.
     */
    branchName: text('branch_name'),
    /** 'domain' | 'smart_contract' (extensible). */
    kind: text('kind', { enum: ['domain', 'smart_contract'] }).notNull(),
    /**
     * Per-kind payload:
     *   - domain: { url: string; environment?: string; note?: string }
     *   - smart_contract: { chain: string; address: string; name?: string; note?: string }
     */
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (t) => ({
    repoIdx: index('repo_annotations_repo_id_idx').on(t.repoId),
    branchIdx: index('repo_annotations_branch_idx').on(t.repoId, t.branchName),
  }),
)

// ─── Repository lists (org-level named collections) ─────────────────────────

/**
 * Named, org-level collections of repositories. Lists let the user organise
 * their global repository library into buckets (e.g. "Frontend", "Infra")
 * and import a whole list into a board with one action.
 *
 * A board can optionally be linked to at most one list via `boards.synced_list_id`;
 * adding/removing repos on that list then syncs through to the board's nodes
 * automatically. Nodes that originated from the list are tagged via
 * `board_nodes.source_list_id` so we can distinguish list-managed nodes from
 * manually-added ones on the same board.
 */
export const repoLists = sqliteTable(
  'repo_lists',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    nameIdx: index('repo_lists_name_idx').on(t.name),
  }),
)

export const repoListItems = sqliteTable(
  'repo_list_items',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => repoLists.id, { onDelete: 'cascade' }),
    repoId: text('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    addedAt: text('added_at').notNull().default(nowIso),
  },
  (t) => ({
    listIdx: index('repo_list_items_list_id_idx').on(t.listId),
    repoIdx: index('repo_list_items_repo_id_idx').on(t.repoId),
    // Unique per (list, repo) — a repo can only appear once in a given list.
    uniquePair: index('repo_list_items_list_repo_unique').on(t.listId, t.repoId),
  }),
)

// ─── Boards ──────────────────────────────────────────────────────────────────

export const boards = sqliteTable('boards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  /**
   * Optional link to a {@link repoLists} row. When set, adding/removing
   * repos in the list propagates to this board's nodes automatically.
   * ON DELETE SET NULL so deleting a list doesn't cascade and blow away
   * the board — the board keeps its (now loose) nodes.
   */
  syncedListId: text('synced_list_id').references(() => repoLists.id, {
    onDelete: 'set null',
  }),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
})

// ─── Board nodes (polymorphic) ───────────────────────────────────────────────

export const boardNodes = sqliteTable(
  'board_nodes',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** 'repo' | 'note' | 'group' */
    kind: text('kind', { enum: ['repo', 'note', 'group'] }).notNull(),
    /** Required when kind === 'repo'. */
    repoId: text('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    /**
     * Set when this node was materialised from a {@link repoLists} import/sync.
     * Used to distinguish list-managed repo nodes (which get added/removed in
     * lockstep with list membership) from manually-added ones on the same
     * board. ON DELETE SET NULL so deleting a list leaves the node intact.
     */
    sourceListId: text('source_list_id').references(() => repoLists.id, {
      onDelete: 'set null',
    }),
    /** Self-FK for nesting inside a group node. */
    parentId: text('parent_id'),
    x: real('x').notNull().default(0),
    y: real('y').notNull().default(0),
    width: real('width').notNull().default(240),
    height: real('height').notNull().default(140),
    zIndex: integer('z_index').notNull().default(0),
    /** Polymorphic per-kind extras: `{ content }` for note, `{ label, color }` for group. */
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    boardIdx: index('board_nodes_board_id_idx').on(t.boardId),
    repoIdx: index('board_nodes_repo_id_idx').on(t.repoId),
    parentIdx: index('board_nodes_parent_id_idx').on(t.parentId),
    sourceListIdx: index('board_nodes_source_list_id_idx').on(t.sourceListId),
  }),
)

// ─── Chains (smart contract explorer URLs) ──────────────────────────────────

export const chains = sqliteTable(
  'chains',
  {
    id: text('id').primaryKey(),
    /** Chain name as the user picks it on a smart contract annotation. */
    name: text('name').notNull().unique(),
    /**
     * Explorer URL template containing `{address}` as the placeholder for
     * the contract address. Example: `https://etherscan.io/address/{address}`.
     */
    explorerUrlTemplate: text('explorer_url_template').notNull(),
    /**
     * Optional regex pattern (no flags, no anchors normalization — store as
     * the user typed it) used to validate contract addresses for this chain.
     * Null means "use the EVM default" (`^0x[a-fA-F0-9]{40}$`) — most
     * chains in the wild are EVM-compatible.
     */
    addressPattern: text('address_pattern'),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (t) => ({
    nameIdx: index('chains_name_idx').on(t.name),
  }),
)

// ─── Inferred row types ──────────────────────────────────────────────────────

export type RepoRow = typeof repos.$inferSelect
export type RepoInsert = typeof repos.$inferInsert
export type RepoAnnotationRow = typeof repoAnnotations.$inferSelect
export type RepoAnnotationInsert = typeof repoAnnotations.$inferInsert
export type BoardRow = typeof boards.$inferSelect
export type BoardInsert = typeof boards.$inferInsert
export type BoardNodeRow = typeof boardNodes.$inferSelect
export type BoardNodeInsert = typeof boardNodes.$inferInsert
export type RepoListRow = typeof repoLists.$inferSelect
export type RepoListInsert = typeof repoLists.$inferInsert
export type RepoListItemRow = typeof repoListItems.$inferSelect
export type RepoListItemInsert = typeof repoListItems.$inferInsert
export type ChainRow = typeof chains.$inferSelect
export type ChainInsert = typeof chains.$inferInsert
