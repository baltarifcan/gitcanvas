import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Board, CreateBoardInput, UpdateBoardInput } from '@gitcanvas/shared'
import { api } from '@renderer/lib/api'

export const boardsKey = ['boards'] as const
export const boardKey = (id: string) => ['boards', id] as const

export function useBoards() {
  return useQuery({
    queryKey: boardsKey,
    queryFn: () => api.boards.list(),
  })
}

export function useBoard(id: string | null) {
  return useQuery({
    queryKey: id ? boardKey(id) : ['boards', 'none'],
    queryFn: () => api.boards.get({ id: id! }),
    enabled: !!id,
  })
}

export function useCreateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBoardInput) => api.boards.create(input),
    onSuccess: (board) => {
      qc.setQueryData<Board[]>(boardsKey, (prev) => (prev ? [board, ...prev] : [board]))
      qc.invalidateQueries({ queryKey: boardsKey })
    },
  })
}

export function useUpdateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateBoardInput }) =>
      api.boards.update({ id, patch }),
    onSuccess: (board) => {
      qc.setQueryData<Board[]>(boardsKey, (prev) =>
        prev ? prev.map((b) => (b.id === board.id ? board : b)) : [board],
      )
      qc.invalidateQueries({ queryKey: boardKey(board.id) })
    },
  })
}

export function useDeleteBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.boards.delete({ id }),
    onSuccess: (_void, id) => {
      qc.setQueryData<Board[]>(boardsKey, (prev) => (prev ? prev.filter((b) => b.id !== id) : []))
    },
  })
}
