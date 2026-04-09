import { BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import log from 'electron-log/main.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type CreateWindowOptions = {
  preloadPath: string
}

export function createMainWindow({ preloadPath }: CreateWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    title: 'GitCanvas',
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0b0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: false,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
    if (process.env.ELECTRON_RENDERER_URL) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL).catch((err) =>
      log.error('Failed to load renderer URL', err),
    )
  } else {
    const indexHtml = path.join(__dirname, '../renderer/index.html')
    win.loadFile(indexHtml).catch((err) => log.error('Failed to load renderer file', err))
  }

  return win
}
