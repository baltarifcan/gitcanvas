import { z } from 'zod'
import { registerHandler } from '@main/ipc/util'
import * as boardsQ from '@main/db/queries/boards'
import * as nodesQ from '@main/db/queries/boardNodes'
import * as listsQ from '@main/db/queries/repoLists'

const ulidSchema = z.string().min(10).max(40)

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const sizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
})

const noteDataSchema = z.object({
  content: z.string().max(10_000),
})

const groupDataSchema = z.object({
  label: z.string().min(1).max(120),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected hex color like #7c3aed'),
})

const repoNodeDataSchema = z.object({
  visibleBranches: z.array(z.string().max(255)).max(40).optional(),
  branchColors: z
    .record(z.string().max(255), z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .optional(),
  showBranchDetails: z.boolean().optional(),
  showAnnotations: z.boolean().optional(),
})

const createInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
})

const updateInput = z.object({
  id: ulidSchema,
  patch: z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
  }),
})

const updateNodeInput = z.object({
  id: ulidSchema,
  patch: z.object({
    position: positionSchema.optional(),
    size: sizeSchema.optional(),
    parentId: ulidSchema.nullable().optional(),
    zIndex: z.number().int().optional(),
    // Whichever data shape applies to the node's kind.
    data: z.union([noteDataSchema, groupDataSchema, repoNodeDataSchema]).optional(),
  }),
})

export function registerBoardHandlers(): void {
  registerHandler('boards.list', z.void(), () => {
    return boardsQ.listBoards()
  })

  registerHandler('boards.get', z.object({ id: ulidSchema }), ({ id }) => {
    return boardsQ.getBoard(id)
  })

  registerHandler('boards.create', createInput, (input) => {
    return boardsQ.createBoard(input)
  })

  registerHandler('boards.update', updateInput, ({ id, patch }) => {
    return boardsQ.updateBoard(id, patch)
  })

  registerHandler('boards.delete', z.object({ id: ulidSchema }), ({ id }) => {
    boardsQ.deleteBoard(id)
  })

  // ── Node handlers ──────────────────────────────────────────────────────────

  registerHandler(
    'boards.addRepoNode',
    z.object({
      boardId: ulidSchema,
      repoId: ulidSchema,
      position: positionSchema,
    }),
    (input) => nodesQ.insertRepoNode(input),
  )

  registerHandler(
    'boards.addNoteNode',
    z.object({
      boardId: ulidSchema,
      position: positionSchema,
      data: noteDataSchema,
    }),
    (input) => nodesQ.insertNoteNode(input),
  )

  registerHandler(
    'boards.addGroupNode',
    z.object({
      boardId: ulidSchema,
      position: positionSchema,
      data: groupDataSchema,
    }),
    (input) => nodesQ.insertGroupNode(input),
  )

  registerHandler('boards.updateNode', updateNodeInput, ({ id, patch }) =>
    nodesQ.updateBoardNode(id, patch),
  )

  registerHandler('boards.removeNode', z.object({ id: ulidSchema }), ({ id }) => {
    nodesQ.deleteBoardNode(id)
  })

  // ── List linking ───────────────────────────────────────────────────────────

  registerHandler(
    'boards.linkList',
    z.object({ boardId: ulidSchema, listId: ulidSchema }),
    ({ boardId, listId }) => {
      listsQ.linkBoardToList(boardId, listId)
      return boardsQ.getBoard(boardId)
    },
  )

  registerHandler(
    'boards.unlinkList',
    z.object({ boardId: ulidSchema }),
    ({ boardId }) => {
      listsQ.unlinkBoardFromList(boardId)
      return boardsQ.getBoard(boardId)
    },
  )
}
