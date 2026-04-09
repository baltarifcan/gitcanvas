import { registerAnnotationHandlers } from '@main/ipc/annotations'
import { registerBoardHandlers } from '@main/ipc/boards'
import { registerChainHandlers } from '@main/ipc/chains'
import { registerListHandlers } from '@main/ipc/lists'
import { registerRepoHandlers } from '@main/ipc/repos'
import { registerSystemHandlers } from '@main/ipc/system'

/**
 * Wires every IPC handler. Called once from `main/index.ts` after the DB
 * is initialized but before the first window is created.
 */
export function registerIpcHandlers(): void {
  registerBoardHandlers()
  registerRepoHandlers()
  registerListHandlers()
  registerAnnotationHandlers()
  registerChainHandlers()
  registerSystemHandlers()
}
