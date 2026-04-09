import { Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Builds and installs the application menu.
 *
 * Why this exists: in development, Electron runs from its prebuilt
 * `Electron.app` bundle whose `Info.plist` declares `CFBundleName=Electron`.
 * macOS reads the menu bar app title from the running bundle's Info.plist,
 * NOT from `app.setName()` or `productName`. So even though the rest of the
 * app is correctly named GitCanvas, the menu bar still says "Electron".
 *
 * The fix is to install a custom application menu whose first item label is
 * "GitCanvas" — macOS uses that label as the app menu name in the menu bar.
 * In a packaged build the .app bundle's Info.plist gets the right
 * CFBundleName from electron-builder, so this also stays correct there.
 */
export function installApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      // This label is what shows up as the bold app name in the macOS menu bar.
      label: 'GitCanvas',
      submenu: [
        { role: 'about', label: 'About GitCanvas' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide GitCanvas' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit GitCanvas' },
      ],
    })
  }

  template.push({
    label: 'File',
    submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
  })

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  })

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  })

  template.push({
    label: 'Window',
    submenu: isMac
      ? [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
        ]
      : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
