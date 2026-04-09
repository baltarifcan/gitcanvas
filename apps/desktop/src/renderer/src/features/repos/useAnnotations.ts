import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  DomainAnnotationData,
  RepoAnnotation,
  SmartContractAnnotationData,
} from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'

export const annotationsKey = (repoId: string) => ['repos', repoId, 'annotations'] as const

export function useAnnotations(repoId: string | null | undefined) {
  return useQuery({
    queryKey: repoId ? annotationsKey(repoId) : ['repos', 'none', 'annotations'],
    queryFn: () => api.annotations.list({ repoId: repoId! }),
    enabled: !!repoId,
  })
}

export function useAddDomainAnnotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      repoId: string
      branchName: string | null
      data: DomainAnnotationData
    }) => api.annotations.addDomain(input),
    onSuccess: (annotation) => {
      qc.setQueryData<RepoAnnotation[]>(annotationsKey(annotation.repoId), (prev) =>
        prev ? [...prev, annotation] : [annotation],
      )
    },
  })
}

export function useAddSmartContractAnnotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      repoId: string
      branchName: string | null
      data: SmartContractAnnotationData
    }) => api.annotations.addSmartContract(input),
    onSuccess: (annotation) => {
      qc.setQueryData<RepoAnnotation[]>(annotationsKey(annotation.repoId), (prev) =>
        prev ? [...prev, annotation] : [annotation],
      )
    },
  })
}

export function useDeleteAnnotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; repoId: string }) =>
      api.annotations.delete({ id: input.id }),
    onSuccess: (_void, vars) => {
      qc.setQueryData<RepoAnnotation[]>(annotationsKey(vars.repoId), (prev) =>
        prev ? prev.filter((a) => a.id !== vars.id) : [],
      )
    },
  })
}
