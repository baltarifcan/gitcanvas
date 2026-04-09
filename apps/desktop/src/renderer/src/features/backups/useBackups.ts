import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BackupSummary } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'

export const backupsKey = ['backups'] as const

export function useBackups() {
  return useQuery({
    queryKey: backupsKey,
    queryFn: () => api.system.listBackups(),
    // Backups change rarely; the dialog refetches on open via React Query.
    staleTime: 30_000,
  })
}

export function useBackupsRoot() {
  return useQuery({
    queryKey: ['backups', 'root'] as const,
    queryFn: () => api.system.getBackupsRoot(),
    staleTime: Infinity,
  })
}

export function useCreateBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { label?: string }) => api.system.createBackup(input),
    onSuccess: (backup) => {
      qc.setQueryData<BackupSummary[]>(backupsKey, (prev) =>
        prev ? [backup, ...prev] : [backup],
      )
    },
  })
}

export function useDeleteBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.system.deleteBackup({ id }),
    onSuccess: (_void, id) => {
      qc.setQueryData<BackupSummary[]>(backupsKey, (prev) =>
        prev ? prev.filter((b) => b.id !== id) : [],
      )
    },
  })
}

/**
 * Restoring swaps the live SQLite file underneath the renderer, so every
 * cached query is now potentially stale. We blow away the entire React
 * Query cache after a successful restore so the UI re-fetches everything
 * against the freshly-loaded database.
 */
export function useRestoreBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.system.restoreBackup({ id }),
    onSuccess: () => {
      qc.clear()
    },
  })
}
