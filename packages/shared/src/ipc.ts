/**
 * IPC contract between the Electron main process and the renderer.
 *
 * Adding a new channel requires THREE things:
 *   1. Add an entry to {@link IpcContract} below.
 *   2. Add the channel name to the {@link IPC_CHANNELS} allowlist (compile-time enforced).
 *   3. Register a handler in `apps/desktop/src/main/ipc/*` that takes `IpcRequest<C>`
 *      and returns `IpcResponse<C>`.
 */

import type {
  BackupSummary,
  Board,
  BoardNode,
  BoardWithNodes,
  BranchStatus,
  Chain,
  CreateBoardInput,
  CreateRepoListInput,
  DiscoveredLocalRepo,
  DomainAnnotationData,
  GroupNodeData,
  ID,
  LocalGitStatus,
  NoteNodeData,
  Position,
  Repo,
  RepoAnnotation,
  RepoList,
  RepoListWithRepos,
  SmartContractAnnotationData,
  UpdateBoardInput,
  UpdateNodePatch,
  UpdateRepoListInput,
} from './models.js'

/** Single flat map: channel → request/response shape. One source of truth. */
export type IpcContract = {
  // ── Boards ─────────────────────────────────────────────────────────────────
  'boards.list': { request: void; response: Board[] }
  'boards.get': { request: { id: ID }; response: BoardWithNodes }
  'boards.create': { request: CreateBoardInput; response: Board }
  'boards.update': { request: { id: ID; patch: UpdateBoardInput }; response: Board }
  'boards.delete': { request: { id: ID }; response: void }

  'boards.addRepoNode': {
    request: { boardId: ID; repoId: ID; position: Position }
    response: BoardNode
  }
  /**
   * Link a board to a repo list. Adds nodes for any list repos that are not
   * already present on the board (marking them as list-managed), and tags
   * existing manual nodes for those repos as list-managed in-place.
   * Returns the refreshed board (with its updated node list).
   */
  'boards.linkList': {
    request: { boardId: ID; listId: ID }
    response: BoardWithNodes
  }
  /**
   * Unlink a board from its currently-linked list. Leaves existing
   * list-managed nodes in place (they become loose / manually-owned).
   */
  'boards.unlinkList': {
    request: { boardId: ID }
    response: BoardWithNodes
  }
  'boards.addNoteNode': {
    request: { boardId: ID; position: Position; data: NoteNodeData }
    response: BoardNode
  }
  'boards.addGroupNode': {
    request: { boardId: ID; position: Position; data: GroupNodeData }
    response: BoardNode
  }
  'boards.updateNode': {
    request: { id: ID; patch: UpdateNodePatch }
    response: BoardNode
  }
  'boards.removeNode': { request: { id: ID }; response: void }

  // ── Repositories ───────────────────────────────────────────────────────────
  'repos.list': { request: void; response: Repo[] }
  'repos.get': { request: { id: ID }; response: Repo | null }
  'repos.addLocal': { request: { folderPath: string }; response: Repo }
  /**
   * Batch import. When `listId` is set, every successfully-imported repo
   * is also added to that list (and any boards synced to the list are
   * updated in the same transaction).
   */
  'repos.addLocalBatch': {
    request: { folderPaths: string[]; listId?: ID }
    response: Repo[]
  }
  'repos.scanLocal': {
    request: { parentPath: string; respectGitignore?: boolean }
    response: DiscoveredLocalRepo[]
  }
  'repos.localStatus': { request: { repoId: ID }; response: LocalGitStatus }
  'repos.branches': { request: { repoId: ID }; response: BranchStatus[] }
  'repos.delete': { request: { id: ID }; response: void }

  // ── Repository lists (org-level collections) ──────────────────────────────
  'lists.list': { request: void; response: RepoList[] }
  'lists.get': { request: { id: ID }; response: RepoListWithRepos }
  'lists.create': { request: CreateRepoListInput; response: RepoList }
  'lists.update': {
    request: { id: ID; patch: UpdateRepoListInput }
    response: RepoList
  }
  'lists.delete': { request: { id: ID }; response: void }
  /**
   * Add a repo to a list. Also propagates to every board synced with the
   * list (adds a list-managed node if the board doesn't already have one
   * for that repo, otherwise flips the existing node's source_list_id).
   */
  'lists.addRepo': { request: { listId: ID; repoId: ID }; response: void }
  /**
   * Remove a repo from a list. On synced boards, deletes the list-managed
   * node for that repo (leaves any manually-added nodes for the same repo
   * untouched).
   */
  'lists.removeRepo': { request: { listId: ID; repoId: ID }; response: void }

  // ── Repo annotations (domains, smart contracts) ────────────────────────────
  'annotations.list': { request: { repoId: ID }; response: RepoAnnotation[] }
  'annotations.addDomain': {
    request: { repoId: ID; branchName: string | null; data: DomainAnnotationData }
    response: RepoAnnotation
  }
  'annotations.addSmartContract': {
    request: { repoId: ID; branchName: string | null; data: SmartContractAnnotationData }
    response: RepoAnnotation
  }
  'annotations.delete': { request: { id: ID }; response: void }

  // ── Chains (block explorer settings) ───────────────────────────────────────
  'chains.list': { request: void; response: Chain[] }
  'chains.create': {
    request: { name: string; explorerUrlTemplate: string }
    response: Chain
  }
  'chains.update': {
    request: { id: ID; patch: { name?: string; explorerUrlTemplate?: string } }
    response: Chain
  }
  'chains.delete': { request: { id: ID }; response: void }

  // ── System ─────────────────────────────────────────────────────────────────
  'system.pickFolder': { request: { title?: string }; response: string | null }
  'system.openExternal': { request: { url: string }; response: void }
  'system.openPath': { request: { path: string }; response: void }
  'system.saveFile': {
    request: { defaultPath: string; filters: { name: string; extensions: string[] }[]; data: string }
    response: string | null
  }

  // ── Backups (DB snapshot / restore) ────────────────────────────────────────
  /** Snapshot the live SQLite DB into ~/Documents/GitCanvas/backups. */
  'system.createBackup': { request: { label?: string }; response: BackupSummary }
  /** List every backup folder under ~/Documents/GitCanvas/backups, newest first. */
  'system.listBackups': { request: void; response: BackupSummary[] }
  /**
   * Restore a backup by id. Closes the live DB, swaps files, re-opens, and
   * runs forward migrations. Always saves a pre-restore safety snapshot
   * first so the user can roll back.
   */
  'system.restoreBackup': { request: { id: string }; response: void }
  /** Delete a single backup folder (non-recoverable). */
  'system.deleteBackup': { request: { id: string }; response: void }
  /** Returns the absolute backups root folder so the UI can show / open it. */
  'system.getBackupsRoot': { request: void; response: string }
}

/**
 * Allowlist of every IPC channel exposed to the renderer.
 *
 * The preload bridge MUST verify channels against this list before forwarding
 * to `ipcRenderer.invoke`. The `satisfies` clause guarantees this list and
 * {@link IpcContract} stay in sync at compile time.
 */
export const IPC_CHANNELS = [
  'boards.list',
  'boards.get',
  'boards.create',
  'boards.update',
  'boards.delete',
  'boards.addRepoNode',
  'boards.addNoteNode',
  'boards.addGroupNode',
  'boards.updateNode',
  'boards.removeNode',
  'boards.linkList',
  'boards.unlinkList',
  'repos.list',
  'repos.get',
  'repos.addLocal',
  'repos.addLocalBatch',
  'repos.scanLocal',
  'repos.localStatus',
  'repos.branches',
  'repos.delete',
  'lists.list',
  'lists.get',
  'lists.create',
  'lists.update',
  'lists.delete',
  'lists.addRepo',
  'lists.removeRepo',
  'annotations.list',
  'annotations.addDomain',
  'annotations.addSmartContract',
  'annotations.delete',
  'chains.list',
  'chains.create',
  'chains.update',
  'chains.delete',
  'system.pickFolder',
  'system.openExternal',
  'system.openPath',
  'system.saveFile',
  'system.createBackup',
  'system.listBackups',
  'system.restoreBackup',
  'system.deleteBackup',
  'system.getBackupsRoot',
] as const satisfies ReadonlyArray<keyof IpcContract>

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/**
 * Compile-time assertion that {@link IPC_CHANNELS} covers every key in
 * {@link IpcContract}. If you add a new channel to the contract and forget
 * to add it here, this type errors.
 */
type _ContractCoverageCheck = Exclude<keyof IpcContract, IpcChannel> extends never
  ? true
  : { error: 'IPC_CHANNELS is missing entries from IpcContract'; missing: Exclude<keyof IpcContract, IpcChannel> }
const _coverage: _ContractCoverageCheck = true
void _coverage
