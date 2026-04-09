import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import log from 'electron-log/main.js'
import { createMainWindow } from '@main/window'
import { initDb, closeDb } from '@main/db/client'
import { registerIpcHandlers } from '@main/ipc'
import { installApplicationMenu } from '@main/menu'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Set the user-visible app name BEFORE app.whenReady so the macOS menu bar
// and window title show "GitCanvas" instead of the package name "@gitcanvas/desktop"
// (or "Electron" in dev). app.setName() must be called early; setting it after
// ready has no effect on the menu bar.
app.setName('GitCanvas')

log.initialize()
log.transports.file.level = 'info'
log.info(`GitCanvas starting — Electron ${process.versions.electron}, Node ${process.versions.node}`)

// Single-instance lock — second launches focus the existing window.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    // 1. Open the database and run migrations BEFORE registering IPC handlers,
    //    so the first renderer query never races the schema setup.
    try {
      initDb()
    } catch (err) {
      log.error('Failed to initialize database', err)
      app.quit()
      return
    }

    // 2. Register every IPC handler against the now-initialized DB.
    registerIpcHandlers()

    // 3. Install the custom application menu so the macOS menu bar shows
    //    "GitCanvas" instead of "Electron" in dev. (Packaged builds get the
    //    right name from electron-builder's productName.)
    installApplicationMenu()

    // Hardening: deny new-window requests, route external links to the OS browser.
    app.on('web-contents-created', (_event, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url).catch((err) => log.error('Failed to open external URL', err))
        return { action: 'deny' }
      })
      contents.on('will-navigate', (event, url) => {
        const parsed = new URL(url)
        const allowed = process.env.ELECTRON_RENDERER_URL
          ? new URL(process.env.ELECTRON_RENDERER_URL).origin
          : 'file://'
        if (parsed.origin !== allowed) {
          event.preventDefault()
          shell.openExternal(url).catch(() => {})
        }
      })
    })

    // NOTE: preload is built as CommonJS (.cjs), not ESM, because Electron's
    // sandboxed preload (sandbox: true) does not support ESM preload scripts.
    // See electron.vite.config.ts → preload.build.rollupOptions.output for details.
    const preloadPath = path.join(__dirname, '../preload/index.cjs')

    createMainWindow({ preloadPath })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow({ preloadPath })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    closeDb()
  })

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception in main process', err)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection in main process', reason)
  })
}
