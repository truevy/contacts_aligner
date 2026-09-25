import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'

export const APP_NAME = 'Contacts Aligner'

// Must run before 'ready' so menus, the About panel and userData all use the product name
// instead of the host binary's ("Electron", or whichever app launched us in development).
app.setName(APP_NAME)
process.title = APP_NAME
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  applicationVersion: app.getVersion(),
  copyright: 'Reconcile your contacts across every account.'
})

function buildMenu() {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac
        ? [{
            label: APP_NAME,
            submenu: [
              { role: 'about' as const, label: `About ${APP_NAME}` },
              { type: 'separator' as const },
              { role: 'hide' as const, label: `Hide ${APP_NAME}` },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: `Quit ${APP_NAME}` }
            ]
          }]
        : []),
      { role: 'editMenu' as const },
      { role: 'viewMenu' as const },
      { role: 'windowMenu' as const }
    ])
  )
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())
  // Never navigate the app window away; external links go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  buildMenu()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
