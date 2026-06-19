import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'node:path'
import { BrowserController } from './browserController'
import { AgentSession } from './agentSession'
import { Channels } from '../shared/ipc'
import type {
  BrowserInput,
  ImageAttachment,
  PermissionResponse,
  StartAgentOptions
} from '../shared/ipc'

let mainWindow: BrowserWindow | null = null

// One independent agent session per conversation — they run concurrently, so
// switching/sending in one conversation never cancels another's running task.
const sessions = new Map<string, AgentSession>()

// One independent browser per conversation. Only the conversation currently
// shown in the panel (`activeConvId`) streams its frames/state to the renderer;
// the others keep their page alive in the background.
const browsers = new Map<string, BrowserController>()
let activeConvId: string | null = null
// Panel size (CSS px) the renderer last reported; every browser adopts it so the
// visible page always matches the panel the user is looking at.
let desiredViewport = { width: 1280, height: 800 }

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
    void b.setViewport(desiredViewport.width, desiredViewport.height)
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
    const { convId } = opts
    // Replace only THIS conversation's session; others keep running.
    sessions.get(convId)?.dispose()
    const s = new AgentSession(
      opts,
      getBrowser(convId),
      // Tag every event/permission with the conversation so the renderer can
      // route it to the right chat, even across concurrent sessions.
      (event) => send(Channels.agentEvent, { convId, event }),
      (req) => send(Channels.agentPermissionRequest, { convId, req })
    )
    sessions.set(convId, s)
    void s.start()
    return { ok: true }
  })

  ipcMain.handle(Channels.agentSend, (_e, convId: string, text: string, images?: ImageAttachment[]) => {
    sessions.get(convId)?.send(text, images)
  })

  ipcMain.handle(Channels.agentInterrupt, async (_e, convId: string) => {
    await sessions.get(convId)?.interrupt()
  })

  ipcMain.handle(Channels.agentSetBypass, (_e, convId: string, on: boolean) => {
    sessions.get(convId)?.setBypass(on)
  })

  ipcMain.handle(Channels.agentPermissionResponse, (_e, convId: string, res: PermissionResponse) => {
    sessions.get(convId)?.resolvePermission(res)
  })

  ipcMain.handle(Channels.agentDispose, (_e, convId: string) => {
    sessions.get(convId)?.dispose()
    sessions.delete(convId)
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

  ipcMain.handle(Channels.browserSetViewport, (_e, width: number, height: number) => {
    desiredViewport = { width, height }
    void activeBrowser()?.setViewport(width, height)
  })

  ipcMain.handle(Channels.browserSetActive, async (_e, convId: string | null) => {
    activeConvId = convId
    const b = convId ? browsers.get(convId) : null
    // Repaint the panel for the newly-shown conversation: either its live page
    // (resized to the current panel) or the empty placeholder if it has none yet.
    if (b) {
      await b.setViewport(desiredViewport.width, desiredViewport.height)
      await b.refreshView()
    } else send(Channels.browserStateChanged, EMPTY_BROWSER_STATE)
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
  for (const s of sessions.values()) s.dispose()
  sessions.clear()
  if (process.platform !== 'darwin') app.quit()
})
