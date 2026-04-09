import path from 'node:path'
import fs from 'node:fs/promises'
import { z } from 'zod'
import { BrowserWindow, dialog, shell } from 'electron'
import log from 'electron-log/main.js'
import { registerHandler } from '@main/ipc/util'
import {
  createBackup,
  deleteBackup,
  getBackupsRoot,
  listBackups,
  restoreBackup,
} from '@main/db/backup'

export function registerSystemHandlers(): void {
  registerHandler(
    'system.pickFolder',
    z.object({ title: z.string().max(200).optional() }),
    async ({ title }) => {
      const focused = BrowserWindow.getFocusedWindow() ?? undefined
      const result = await dialog.showOpenDialog(focused as BrowserWindow, {
        title: title ?? 'Choose folder',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Select',
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0] ?? null
    },
  )

  registerHandler(
    'system.openExternal',
    z.object({ url: z.string().url() }),
    async ({ url }) => {
      try {
        await shell.openExternal(url)
      } catch (err) {
        log.warn(`[system] openExternal failed for ${url}`, err)
        throw err
      }
    },
  )

  registerHandler(
    'system.openPath',
    z.object({ path: z.string().min(1).max(2048) }),
    async ({ path: targetPath }) => {
      const result = await shell.openPath(targetPath)
      if (result) {
        // shell.openPath returns an empty string on success, error message on failure
        log.warn(`[system] openPath rejected ${targetPath}: ${result}`)
        throw new Error(result)
      }
    },
  )

  registerHandler(
    'system.createBackup',
    z.object({ label: z.string().max(200).optional() }),
    async ({ label }) => createBackup({ label }),
  )

  registerHandler('system.listBackups', z.void(), async () => listBackups())

  registerHandler(
    'system.restoreBackup',
    z.object({ id: z.string().min(1).max(200) }),
    async ({ id }) => {
      await restoreBackup(id)
    },
  )

  registerHandler(
    'system.deleteBackup',
    z.object({ id: z.string().min(1).max(200) }),
    async ({ id }) => {
      await deleteBackup(id)
    },
  )

  registerHandler('system.getBackupsRoot', z.void(), async () => getBackupsRoot())

  registerHandler(
    'system.saveFile',
    z.object({
      defaultPath: z.string().min(1),
      filters: z.array(
        z.object({
          name: z.string(),
          extensions: z.array(z.string()),
        }),
      ),
      data: z.string(),
    }),
    async ({ defaultPath, filters, data }) => {
      const focused = BrowserWindow.getFocusedWindow() ?? undefined
      const result = await dialog.showSaveDialog(focused as BrowserWindow, {
        defaultPath,
        filters,
      })
      if (result.canceled || !result.filePath) return null

      // Decide whether `data` is a base64-encoded blob or plain text. The
      // renderer prefixes binary payloads with `base64:` so PNG can round-trip
      // through the IPC string boundary without UTF-8 corruption.
      const target = result.filePath
      await fs.mkdir(path.dirname(target), { recursive: true })
      if (data.startsWith('base64:')) {
        await fs.writeFile(target, Buffer.from(data.slice('base64:'.length), 'base64'))
      } else {
        await fs.writeFile(target, data, 'utf8')
      }
      return target
    },
  )
}
