import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type IpcChannel } from '@gitcanvas/shared'

const channelSet = new Set<string>(IPC_CHANNELS)

/**
 * The single bridge surface exposed to the renderer.
 *
 * `invoke` is the only door — and it allowlists the channel against
 * {@link IPC_CHANNELS} before forwarding. The renderer never receives
 * `ipcRenderer` itself.
 */
const api = {
  invoke: <C extends IpcChannel>(channel: C, payload?: unknown): Promise<unknown> => {
    if (!channelSet.has(channel)) {
      return Promise.reject(new Error(`Blocked unknown IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, payload)
  },
  /** Process versions for the about dialog / debugging. */
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
}

contextBridge.exposeInMainWorld('gitcanvas', api)

export type GitcanvasBridge = typeof api
