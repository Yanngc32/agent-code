import type {
  AgentEventMsg,
  AndroidProgressMsg,
  BrowserFrame,
  BrowserInput,
  BrowserState,
  ImageAttachment,
  PermissionRequestMsg,
  PermissionResponse,
  PickedElement,
  StartAgentOptions,
  TabKind
} from './ipc'

/** The surface exposed on `window.api` by the preload script. */
export interface AgentCodeApi {
  pickDirectory(): Promise<string | null>
  /** Native file picker — returns the absolute path, or null if canceled. */
  pickFile(): Promise<string | null>

  startAgent(opts: StartAgentOptions): Promise<{ ok: boolean }>
  sendMessage(convId: string, text: string, images?: ImageAttachment[]): Promise<void>
  interrupt(convId: string): Promise<void>
  /** Toggle "allow all" on a conversation's running session. */
  setBypass(convId: string, on: boolean): Promise<void>
  respondPermission(convId: string, res: PermissionResponse): Promise<void>
  /** Dispose a conversation's agent session (on chat deletion). */
  disposeAgent(convId: string): Promise<void>
  onAgentEvent(cb: (e: AgentEventMsg) => void): () => void
  onPermissionRequest(cb: (m: PermissionRequestMsg) => void): () => void

  launchBrowser(): Promise<void>
  navigate(url: string): Promise<string>
  browserBack(): Promise<void>
  browserForward(): Promise<void>
  browserReload(): Promise<void>
  setSelectMode(on: boolean): Promise<void>
  sendBrowserInput(ev: BrowserInput): Promise<void>
  closeBrowser(): Promise<void>
  /** Resize the active browser's viewport (CSS px) to match the panel. */
  setBrowserViewport(width: number, height: number): Promise<void>
  /** Switch the panel to a conversation's browser (null = none). */
  setActiveBrowser(convId: string | null): Promise<void>
  /** Close and forget a conversation's browser. */
  disposeBrowser(convId: string): Promise<void>
  /** Open a new preview tab (defaults to web) on the active browser. Returns a
   *  status string (success message, or why it failed — e.g. Android toolchain missing). */
  newTab(kind?: TabKind): Promise<string>
  /** Make a tab the active (controlled/streamed) one. */
  selectTab(tabId: string): Promise<void>
  /** Close a preview tab. */
  closeTab(tabId: string): Promise<void>
  /** Set the active Android preview's screen size (px) — a device model or custom. */
  setAndroidSize(width: number, height: number, dpi?: number): Promise<string>
  onBrowserFrame(cb: (f: BrowserFrame) => void): () => void
  onBrowserState(cb: (s: BrowserState) => void): () => void
  onBrowserPicked(cb: (el: PickedElement) => void): () => void
  /** Boot-progress lines while a conversation's Android device/emulator starts. */
  onAndroidProgress(cb: (m: AndroidProgressMsg) => void): () => void
}
