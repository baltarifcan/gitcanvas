import { z } from 'zod'
import { registerHandler } from '@main/ipc/util'
import * as annotationsQ from '@main/db/queries/annotations'

const ulidSchema = z.string().min(10).max(40)

const domainDataSchema = z.object({
  url: z.string().min(1).max(2048),
  environment: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
})

const smartContractDataSchema = z.object({
  chain: z.string().min(1).max(80),
  address: z.string().min(1).max(120),
  name: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
})

export function registerAnnotationHandlers(): void {
  registerHandler(
    'annotations.list',
    z.object({ repoId: ulidSchema }),
    ({ repoId }) => annotationsQ.listByRepo(repoId),
  )

  registerHandler(
    'annotations.addDomain',
    z.object({
      repoId: ulidSchema,
      branchName: z.string().nullable(),
      data: domainDataSchema,
    }),
    (input) => annotationsQ.insertDomain(input),
  )

  registerHandler(
    'annotations.addSmartContract',
    z.object({
      repoId: ulidSchema,
      branchName: z.string().nullable(),
      data: smartContractDataSchema,
    }),
    (input) => annotationsQ.insertSmartContract(input),
  )

  registerHandler('annotations.delete', z.object({ id: ulidSchema }), ({ id }) => {
    annotationsQ.deleteAnnotation(id)
  })
}
