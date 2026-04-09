import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BranchStatus, LocalGitStatus, Repo } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'

export const reposKey = ['repos'] as const
export const repoKey = (id: string) => ['repos', id] as const
export const localStatusKey = (id: string) => ['repos', id, 'localStatus'] as const
export const branchesKey = (id: string) => ['repos', id, 'branches'] as const

export function useRepos() {
  return useQuery({
    queryKey: reposKey,
    queryFn: () => api.repos.list(),
  })
}

export function useRepo(id: string | null | undefined) {
  return useQuery({
    queryKey: id ? repoKey(id) : ['repos', 'none'],
    queryFn: () => api.repos.get({ id: id! }),
    enabled: !!id,
  })
}

export function useLocalStatus(repoId: string | null | undefined) {
  return useQuery({
    queryKey: repoId ? localStatusKey(repoId) : ['repos', 'none', 'localStatus'],
    queryFn: () => api.repos.localStatus({ repoId: repoId! }),
    enabled: !!repoId,
    // Status is moderately stale-tolerant; the focus listener invalidates
    // these on window focus, see RepoFocusRefresher.
    staleTime: 60_000,
  })
}

export function useRepoBranches(repoId: string | null | undefined) {
  return useQuery<BranchStatus[]>({
    queryKey: repoId ? branchesKey(repoId) : ['repos', 'none', 'branches'],
    queryFn: () => api.repos.branches({ repoId: repoId! }),
    enabled: !!repoId,
    staleTime: 30_000,
  })
}

export function useAddLocalRepo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { folderPath: string }) => api.repos.addLocal(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reposKey })
    },
  })
}

export function useAddLocalRepoBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { folderPaths: string[]; listId?: string }) =>
      api.repos.addLocalBatch(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: reposKey })
      // If the import targeted a list, its cache and any synced boards
      // need to repaint too.
      if (vars.listId) {
        qc.invalidateQueries({ queryKey: ['lists'] })
        qc.invalidateQueries({ queryKey: ['boards'] })
      }
    },
  })
}

export function useScanLocal() {
  return useMutation({
    mutationFn: (input: { parentPath: string; respectGitignore?: boolean }) =>
      api.repos.scanLocal(input),
  })
}

export function useDeleteRepo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.repos.delete({ id }),
    onSuccess: (_void, id) => {
      qc.setQueryData<Repo[]>(reposKey, (prev) => (prev ? prev.filter((r) => r.id !== id) : []))
      qc.invalidateQueries({ queryKey: reposKey })
    },
  })
}

/** Imperative refresh helper for "refresh local statuses" button on the canvas. */
export function useRefreshLocalStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (repoId: string) => {
      const status = await api.repos.localStatus({ repoId })
      return { repoId, status }
    },
    onSuccess: ({ repoId, status }) => {
      qc.setQueryData<LocalGitStatus>(localStatusKey(repoId), status)
    },
  })
}
