/**
 * Typed renderer wrapper around the preload bridge.
 *
 * Usage:
 *
 *   import { api } from '@renderer/lib/api'
 *
 *   const boards = await api.boards.list()
 *   const board = await api.boards.create({ name: 'WEB3' })
 *
 * The shape of `api` is derived purely from {@link IpcContract} in
 * `@gitcanvas/shared`, so adding a new channel there is enough to make it
 * callable here with full type-safety. No per-channel boilerplate.
 *
 * Runtime: a thin two-level Proxy maps `api.<namespace>.<method>(payload)` to
 * `window.gitcanvas.invoke('<namespace>.<method>', payload)`.
 */

import type { IpcChannel, IpcContract, IpcRequest, IpcResponse } from '@gitcanvas/shared'

// ─── Type plumbing ───────────────────────────────────────────────────────────

type Namespaces = {
  [C in IpcChannel as C extends `${infer N}.${string}` ? N : never]: never
}

type ChannelsInNamespace<N extends string> = Extract<IpcChannel, `${N}.${string}`>

type MethodNameOf<C extends string, N extends string> = C extends `${N}.${infer M}` ? M : never

type ApiMethod<C extends IpcChannel> =
  IpcContract[C]['request'] extends void
    ? () => Promise<IpcResponse<C>>
    : (request: IpcRequest<C>) => Promise<IpcResponse<C>>

export type Api = {
  [N in keyof Namespaces & string]: {
    [C in ChannelsInNamespace<N> as MethodNameOf<C, N>]: ApiMethod<C>
  }
}

// ─── Runtime ─────────────────────────────────────────────────────────────────

function makeApi(): Api {
  return new Proxy({} as Api, {
    get(_target, namespaceKey) {
      if (typeof namespaceKey !== 'string') return undefined
      return new Proxy({} as Record<string, unknown>, {
        get(_t, methodKey) {
          if (typeof methodKey !== 'string') return undefined
          const channel = `${namespaceKey}.${methodKey}` as IpcChannel
          return (request?: unknown) => window.gitcanvas.invoke(channel, request)
        },
      })
    },
  })
}

export const api = makeApi()
