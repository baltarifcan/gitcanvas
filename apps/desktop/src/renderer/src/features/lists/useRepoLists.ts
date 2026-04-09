import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BoardWithNodes,
  CreateRepoListInput,
  RepoList,
  UpdateRepoListInput,
} from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'
import { boardKey, boardsKey } from '@renderer/features/boards/useBoards'

/**
 * React Query hooks for org-level repository lists.
 *
 * Cache strategy:
 *
 *  - `listsKey` holds the flat RepoList[] for the sidebar.
 *  - `listKey(id)` holds the detailed RepoListWithRepos for the manage dialog.
 *  - Any mutation that can affect a board (linking, membership changes
 *    while a board is linked) invalidates the relevant boardKey(...) cache
 *    so the canvas picks up freshly-added/removed nodes on next view.
 */

export const listsKey = ['lists'] as const
export const listKey = (id: string) => ['lists', id] as const

export function useRepoLists() {
  return useQuery({
    queryKey: listsKey,
    queryFn: () => api.lists.list(),
  })
}

export function useRepoList(id: string | null | undefined) {
  return useQuery({
    queryKey: id ? listKey(id) : ['lists', 'none'],
    queryFn: () => api.lists.get({ id: id! }),
    enabled: !!id,
  })
}

export function useCreateRepoList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRepoListInput) => api.lists.create(input),
    onSuccess: (list) => {
      qc.setQueryData<RepoList[]>(listsKey, (prev) => (prev ? [...prev, list] : [list]))
      qc.invalidateQueries({ queryKey: listsKey })
    },
  })
}

export function useUpdateRepoList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateRepoListInput }) =>
      api.lists.update(input),
    onSuccess: (list) => {
      qc.setQueryData<RepoList[]>(listsKey, (prev) =>
        prev ? prev.map((l) => (l.id === list.id ? list : l)) : [list],
      )
      qc.invalidateQueries({ queryKey: listKey(list.id) })
    },
  })
}

export function useDeleteRepoList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.lists.delete({ id }),
    onSuccess: (_void, id) => {
      qc.setQueryData<RepoList[]>(listsKey, (prev) =>
        prev ? prev.filter((l) => l.id !== id) : [],
      )
      // Any linked board's cache might now be stale (its syncedListId is
      // nulled out by the SET NULL FK). Nuke the whole boards subtree —
      // cheap and correct.
      qc.invalidateQueries({ queryKey: boardsKey })
    },
  })
}

export function useAddRepoToList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { listId: string; repoId: string }) =>
      api.lists.addRepo(input),
    onSuccess: (_void, { listId }) => {
      qc.invalidateQueries({ queryKey: listsKey })
      qc.invalidateQueries({ queryKey: listKey(listId) })
      // Synced boards may have just gained a node — refetch lazily.
      qc.invalidateQueries({ queryKey: boardsKey })
    },
  })
}

export function useRemoveRepoFromList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { listId: string; repoId: string }) =>
      api.lists.removeRepo(input),
    onSuccess: (_void, { listId }) => {
      qc.invalidateQueries({ queryKey: listsKey })
      qc.invalidateQueries({ queryKey: listKey(listId) })
      qc.invalidateQueries({ queryKey: boardsKey })
    },
  })
}

export function useLinkBoardToList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { boardId: string; listId: string }) =>
      api.boards.linkList(input),
    onSuccess: (board) => {
      qc.setQueryData<BoardWithNodes>(boardKey(board.id), board)
      qc.invalidateQueries({ queryKey: boardsKey })
    },
  })
}

export function useUnlinkBoardFromList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { boardId: string }) => api.boards.unlinkList(input),
    onSuccess: (board) => {
      qc.setQueryData<BoardWithNodes>(boardKey(board.id), board)
      qc.invalidateQueries({ queryKey: boardsKey })
    },
  })
}
