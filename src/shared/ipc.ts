// Shared IPC contract between the Electron main process and the renderer.
// Keep this file type-only so it can be imported from main, preload and renderer.

/** A normalized chat event the renderer renders. Produced in main from SDKMessage. */
export type ChatEvent =
  | { kind: 'system'; sessionId: string; model: string; cwd: string; tools: string[] }
  | { kind: 'assistant-text'; id: string; text: string; final: boolean }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'tool-use'; id: string; name: string; input: unknown; parentToolUseId: string | null }
  | { kind: 'tool-result'; id: string; toolUseId: string; isError: boolean; text: string }
  | {
      kind: 'result'
      id: string
      isError: boolean
      text: string
      durationMs: number
      costUsd?: number
      /** Real context-window size after this turn (last model request input). */
      contextTokens?: number
      usage?: TokenUsage
    }
  | { kind: 'status'; id: string; text: string }
  | { kind: 'error'; id: string; text: string }

/** An image attached to a user message, sent to the agent as a base64 block. */
export interface ImageAttachment {
  /** MIME type, e.g. "image/png" / "image/jpeg". */
  mediaType: string
  /** Base64 payload, without the `data:...;base64,` prefix. */
  data: string
}

/** Agent asks the user to approve a tool call. */
export interface PermissionRequest {
  id: string
  toolName: string
  input: Record<string, unknown>
}

/** A chat event tagged with the conversation whose agent produced it. Each
 *  conversation runs its own independent agent session in the main process. */
export interface AgentEventMsg {
  convId: string
  event: ChatEvent
}

/** A permission request tagged with the conversation that needs it. */
export interface PermissionRequestMsg {
  convId: string
  req: PermissionRequest
}

export interface PermissionResponse {
  id: string
  behavior: 'allow' | 'deny'
  /** When true, remember the decision for this tool name for the rest of the session. */
  always?: boolean
  message?: string
}

/** A live frame from the embedded Playwright browser (CDP screencast). */
export interface BrowserFrame {
  /** base64-encoded JPEG (no data: prefix). */
  data: string
  /** Natural pixel size of the captured page. */
  width: number
  height: number
}

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  launched: boolean
}

/** Element captured by the "select on page" picker, forwarded to the chat composer. */
export interface PickedElement {
  selector: string
  tagName: string
  id: string
  classes: string
  text: string
  html: string
  url: string
}

/** Input event forwarded from the renderer canvas back into the page. */
export type BrowserInput =
  | { type: 'move'; nx: number; ny: number }
  | { type: 'click'; nx: number; ny: number; button: 'left' | 'right' | 'middle' }
  | { type: 'wheel'; nx: number; ny: number; dx: number; dy: number }
  | { type: 'key'; key: string; text?: string }

/** Per-turn token usage reported by the agent. */
export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface StartAgentOptions {
  /** Conversation this agent serves — also keys its dedicated browser instance. */
  convId: string
  cwd: string
  model?: string
  /** Start the agent with permission prompts disabled (--dangerously-skip-permissions). */
  skipPermissions?: boolean
  /** SDK session id to resume — loads the prior conversation history so an old chat can continue. */
  resume?: string
}

// Channel name constants — single source of truth.
export const Channels = {
  // renderer -> main (invoke)
  agentStart: 'agent:start',
  agentSend: 'agent:send',
  agentInterrupt: 'agent:interrupt',
  agentSetBypass: 'agent:set-bypass',
  agentPermissionResponse: 'agent:permission-response',
  /** Dispose a conversation's agent session (e.g. when the chat is deleted). */
  agentDispose: 'agent:dispose',
  pickDirectory: 'app:pick-directory',
  pickFile: 'app:pick-file',
  browserLaunch: 'browser:launch',
  browserNavigate: 'browser:navigate',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserReload: 'browser:reload',
  browserSetSelectMode: 'browser:set-select-mode',
  browserInput: 'browser:input',
  browserClose: 'browser:close',
  /** Tell main which conversation's browser the panel is currently showing. */
  browserSetActive: 'browser:set-active',
  /** Close and discard a conversation's browser (e.g. when the chat is deleted). */
  browserDispose: 'browser:dispose',
  // main -> renderer (send)
  agentEvent: 'agent:event',
  agentPermissionRequest: 'agent:permission-request',
  browserFrame: 'browser:frame',
  browserStateChanged: 'browser:state',
  browserPicked: 'browser:picked'
} as const
