import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'node:path'
import { BrowserController } from './browserController'
import { AgentSession } from './agentSession'
import { Channels } from '../shared/ipc'
import type {
  BrowserInput,
  PermissionResponse,
  StartAgentOptions
} from '../shared/ipc'

let mainWindow: BrowserWindow | null = null
let session: AgentSession | null = null

// One independent browser per conversation. Only the conversation currently
// shown in the panel (`activeConvId`) streams its frames/state to the renderer;
// the others keep their page alive in the background.
const browsers = new Map<string, BrowserController>()
let activeConvId: string | null = null

const EMPTY_BROWSER_STATE = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  launched: false
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

/** Get (creating if needed) the browser dedicated to a conversation. */
function getBrowser(convId: string): BrowserController {
  let b = browsers.get(convId)
  if (!b) {
    // Callbacks are gated on `activeConvId` so a background conversation's
    // browser never paints over the one the user is looking at.
    b = new BrowserController({
      onFrame: (frame) => convId === activeConvId && send(Channels.browserFrame, frame),
      onState: (state) => convId === activeConvId && send(Channels.browserStateChanged, state),
      onPicked: (el) => convId === activeConvId && send(Channels.browserPicked, el)
    })
    browsers.set(convId, b)
  }
  return b
}

/** The browser shown in the panel right now, if any (does not create one). */
function activeBrowser(): BrowserController | null {
  return activeConvId ? browsers.get(activeConvId) ?? null : null
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#1f1e1d',
    title: 'Agent Code',
    icon: join(
      import.meta.dirname,
      '../../build',
      process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    ),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#262624',
      symbolColor: '#e8e6e3',
      height: 52
    },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc(): void {
  ipcMain.handle(Channels.pickDirectory, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(Channels.pickFile, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'] })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(Channels.agentStart, async (_e, opts: StartAgentOptions) => {
    session?.dispose()
    session = new AgentSession(
      opts,
      getBrowser(opts.convId),
      (event) => send(Channels.agentEvent, event),
      (req) => send(Channels.agentPermissionRequest, req)
    )
    void session.start()
    return { ok: true }
  })

  ipcMain.handle(Channels.agentSend, (_e, text: string) => {
    session?.send(text)
  })

  ipcMain.handle(Channels.agentInterrupt, async () => {
    await session?.interrupt()
  })

  ipcMain.handle(Channels.agentSetBypass, (_e, on: boolean) => {
    session?.setBypass(on)
  })

  ipcMain.handle(Channels.agentPermissionResponse, (_e, res: PermissionResponse) => {
    session?.resolvePermission(res)
  })

  // Manual panel controls act on the browser of the conversation being viewed.
  ipcMain.handle(Channels.browserLaunch, async () => {
    if (activeConvId) await getBrowser(activeConvId).ensureLaunched()
  })
  ipcMain.handle(Channels.browserNavigate, (_e, url: string) =>
    activeConvId ? getBrowser(activeConvId).navigate(url) : ''
  )
  ipcMain.handle(Channels.browserBack, () => activeBrowser()?.back())
  ipcMain.handle(Channels.browserForward, () => activeBrowser()?.forward())
  ipcMain.handle(Channels.browserReload, () => activeBrowser()?.reload())
  ipcMain.handle(Channels.browserSetSelectMode, (_e, on: boolean) => activeBrowser()?.setSelectMode(on))
  ipcMain.handle(Channels.browserInput, (_e, ev: BrowserInput) => activeBrowser()?.forwardInput(ev))
  ipcMain.handle(Channels.browserClose, () => activeBrowser()?.close())

  ipcMain.handle(Channels.browserSetActive, async (_e, convId: string | null) => {
    activeConvId = convId
    const b = convId ? browsers.get(convId) : null
    // Repaint the panel for the newly-shown conversation: either its live page
    // or the empty placeholder if it has no browser yet.
    if (b) await b.refreshView()
    else send(Channels.browserStateChanged, EMPTY_BROWSER_STATE)
  })

  ipcMain.handle(Channels.browserDispose, async (_e, convId: string) => {
    const b = browsers.get(convId)
    if (!b) return
    browsers.delete(convId)
    await b.close()
    if (activeConvId === convId) {
      activeConvId = null
      send(Channels.browserStateChanged, EMPTY_BROWSER_STATE)
    }
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const b of browsers.values()) void b.close()
  browsers.clear()
  session?.dispose()
  if (process.platform !== 'darwin') app.quit()
})
