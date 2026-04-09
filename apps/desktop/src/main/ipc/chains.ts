import { z } from 'zod'
import { registerHandler } from '@main/ipc/util'
import * as chainsQ from '@main/db/queries/chains'

const ulidSchema = z.string().min(10).max(40)

const nameSchema = z
  .string()
  .min(1, 'Chain name is required')
  .max(80, 'Chain name is too long')

const templateSchema = z
  .string()
  .min(1, 'Explorer URL template is required')
  .max(2048, 'Explorer URL template is too long')
  .refine(
    (s) => s.includes('{address}'),
    'Template must contain `{address}` as the substitution placeholder',
  )

const addressPatternSchema = z
  .string()
  .max(512, 'Address pattern is too long')
  .nullable()
  .refine(
    (s) => {
      if (s === null || s.trim() === '') return true
      try {
         
        new RegExp(s)
        return true
      } catch {
        return false
      }
    },
    'Address pattern must be a valid regular expression',
  )

export function registerChainHandlers(): void {
  registerHandler('chains.list', z.void(), () => chainsQ.listChains())

  registerHandler(
    'chains.create',
    z.object({
      name: nameSchema,
      explorerUrlTemplate: templateSchema,
      addressPattern: addressPatternSchema.optional(),
    }),
    (input) => chainsQ.createChain(input),
  )

  registerHandler(
    'chains.update',
    z.object({
      id: ulidSchema,
      patch: z.object({
        name: nameSchema.optional(),
        explorerUrlTemplate: templateSchema.optional(),
        addressPattern: addressPatternSchema.optional(),
      }),
    }),
    ({ id, patch }) => chainsQ.updateChain(id, patch),
  )

  registerHandler('chains.delete', z.object({ id: ulidSchema }), ({ id }) => {
    chainsQ.deleteChain(id)
  })
}
