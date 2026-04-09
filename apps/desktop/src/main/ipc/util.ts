import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import log from 'electron-log/main.js'
import type { IpcChannel, IpcRequest, IpcResponse } from '@gitcanvas/shared'

type Handler<C extends IpcChannel> = (
  payload: IpcRequest<C>,
  event: IpcMainInvokeEvent,
) => Promise<IpcResponse<C>> | IpcResponse<C>

/**
 * Register a typed `ipcMain.handle` for a channel.
 *
 *  - The channel name and handler signature are checked against
 *    {@link IpcContract} via the `C extends IpcChannel` generic constraint.
 *  - Every payload is validated with the supplied Zod schema before the
 *    handler runs. Validation failures throw a structured error back over
 *    IPC instead of running the handler with malformed input.
 *  - Handler exceptions are logged and re-thrown so the renderer's
 *    `Promise.reject` lands in React Query's error path.
 */
export function registerHandler<C extends IpcChannel>(
  channel: C,
  schema: ZodType<IpcRequest<C>>,
  handler: Handler<C>,
): void {
  ipcMain.handle(channel, async (event, rawPayload: unknown) => {
    log.info(`[ipc] ← ${channel}`)
    const parsed = schema.safeParse(rawPayload)
    if (!parsed.success) {
      log.warn(`[ipc] ${channel} payload rejected`, parsed.error.issues)
      throw new Error(
        `Invalid payload for ${channel}: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`,
      )
    }

    try {
      return await handler(parsed.data, event)
    } catch (err) {
      log.error(`[ipc] ${channel} handler threw`, err)
      throw err
    }
  })
}
