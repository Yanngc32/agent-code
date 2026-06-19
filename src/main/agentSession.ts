import { query, type Options, type PermissionResult, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from './asyncQueue'
import type { BrowserController } from './browserController'
import { createBrowserMcpServer } from './browserTools'
import type { ChatEvent, ImageAttachment, PermissionRequest, PermissionResponse, StartAgentOptions } from '../shared/ipc'

const BROWSER_HINT = `You have an embedded web browser available through the "browser" MCP tools
(browser_navigate, browser_snapshot, browser_screenshot, browser_click, browser_type,
browser_get_text, browser_evaluate, browser_back, browser_reload). When the user asks you
to look something up on the web, open a site, or interact with a page, use these tools — the
page is rendered live inside the app for the user to see.`

// Tools auto-approved without prompting the user.
const READ_ONLY = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'NotebookRead',
  'TodoWrite',
  'WebFetch',
  'WebSearch'
])

let counter = 0
const nextId = (): string => `e${Date.now().toString(36)}-${counter++}`

type AssistantBlock = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }

export class AgentSession {
  private input = new AsyncQueue<SDKUserMessage>()
  private q: ReturnType<typeof query> | null = null
  private pendingPermissions = new Map<
    string,
    { toolName: string; input: Record<string, unknown>; resolve: (r: PermissionResult) => void }
  >()
  private approvedTools = new Set<string>()
  /** "Allow all" — when true every tool is auto-approved without prompting. Toggleable at runtime. */
  private bypassAll = false
  private liveId: string | null = null
  private liveText = ''
  /** Context-window size of the most recent model request (last `assistant`
   *  message's input usage) — the true "context used", not the per-turn sum. */
  private lastContextTokens = 0

  constructor(
    private readonly opts: StartAgentOptions,
    private readonly browser: BrowserController,
    private readonly emit: (e: ChatEvent) => void,
    private readonly askPermission: (req: PermissionRequest) => void
  ) {}

  async start(): Promise<void> {
    this.bypassAll = this.opts.skipPermissions === true
    const options: Options = {
      cwd: this.opts.cwd,
      model: this.opts.model,
      // Resume a previous SDK session (loads its history) when continuing an old chat.
      ...(this.opts.resume ? { resume: this.opts.resume } : {}),
      // Run the bundled Claude Code CLI under system Node rather than the
      // Electron binary, which would otherwise be picked up as the runtime.
      executable: 'node',
      includePartialMessages: true,
      permissionMode: 'default',
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: BROWSER_HINT },
      mcpServers: { browser: createBrowserMcpServer(this.browser) },
      // Always route through our gate. "Allow all" is handled inside
      // handlePermission via the bypassAll flag so it can be toggled live.
      canUseTool: (toolName, input) => this.handlePermission(toolName, input)
    }

    this.q = query({ prompt: this.input, options })

    try {
      for await (const message of this.q) {
        this.handleMessage(message)
      }
    } catch (err) {
      this.emit({ kind: 'error', id: nextId(), text: `Agent stopped: ${String(err)}` })
    }
  }

  send(text: string, images?: ImageAttachment[]): void {
    // With images, send a content-block array (image blocks first, then the
    // text) instead of a plain string — the native Anthropic image format.
    let content: unknown = text
    if (images && images.length > 0) {
      const blocks: unknown[] = images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data }
      }))
      if (text) blocks.push({ type: 'text', text })
      content = blocks
    }
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null
    } as SDKUserMessage
    this.input.push(msg)
  }

  async interrupt(): Promise<void> {
    try {
      await this.q?.interrupt()
    } catch {
      /* not in a turn */
    }
  }

  resolvePermission(res: PermissionResponse): void {
    const pending = this.pendingPermissions.get(res.id)
    if (!pending) return
    this.pendingPermissions.delete(res.id)
    if (res.behavior === 'allow') {
      if (res.always) this.approvedTools.add(pending.toolName)
      pending.resolve({ behavior: 'allow', updatedInput: pending.input })
    } else {
      pending.resolve({ behavior: 'deny', message: res.message ?? 'Denied by user.' })
    }
  }

  /** Toggle "allow all" while the session is running. */
  setBypass(on: boolean): void {
    this.bypassAll = on
    if (on) {
      // Auto-approve anything currently waiting on the user.
      for (const [id, pending] of this.pendingPermissions) {
        pending.resolve({ behavior: 'allow', updatedInput: pending.input })
        this.pendingPermissions.delete(id)
      }
    }
  }

  dispose(): void {
    this.input.close()
  }

  // ---- internals ----

  private handlePermission(toolName: string, input: Record<string, unknown>): Promise<PermissionResult> {
    if (
      this.bypassAll ||
      READ_ONLY.has(toolName) ||
      toolName.startsWith('mcp__browser__') ||
      this.approvedTools.has(toolName)
    ) {
      // IMPORTANT: an "allow" result MUST echo the tool input back as `updatedInput`.
      // The CLI runs the tool with whatever `updatedInput` it receives; omitting it
      // runs the tool with empty input, which then fails its own schema validation
      // ("erro de validação interno") for anything that isn't read-only.
      return Promise.resolve({ behavior: 'allow', updatedInput: input })
    }
    const id = nextId()
    this.askPermission({ id, toolName, input })
    return new Promise<PermissionResult>((resolve) => {
      this.pendingPermissions.set(id, { toolName, input, resolve })
    })
  }

  private handleMessage(message: SDKMessage): void {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          this.emit({
            kind: 'system',
            sessionId: message.session_id,
            model: message.model,
            cwd: message.cwd,
            tools: message.tools
          })
        }
        break

      case 'stream_event':
        this.handleStreamEvent(message.event as { type: string; message?: { id?: string }; delta?: { type?: string; text?: string } })
        break

      case 'assistant': {
        // Each assistant message carries the usage of THAT model request. Its
        // input (fresh + cache read + cache write) is the real context-window
        // occupancy at this point — unlike result.usage, which sums the turn.
        const u = (message.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage
        if (u) {
          this.lastContextTokens =
            (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        }
        this.handleAssistant(message.message.content as unknown as AssistantBlock[])
        break
      }

      case 'user':
        this.handleUser((message.message.content as unknown) as AssistantBlock[] | string)
        break

      case 'result': {
        const r = message as unknown as {
          subtype: string
          is_error: boolean
          result?: string
          duration_ms: number
          total_cost_usd?: number
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
        }
        this.emit({
          kind: 'result',
          id: nextId(),
          isError: r.is_error,
          text: r.result ?? (r.subtype === 'success' ? 'Done.' : r.subtype),
          durationMs: r.duration_ms,
          costUsd: r.total_cost_usd,
          contextTokens: this.lastContextTokens,
          usage: r.usage
            ? {
                input: r.usage.input_tokens ?? 0,
                output: r.usage.output_tokens ?? 0,
                cacheRead: r.usage.cache_read_input_tokens ?? 0,
                cacheWrite: r.usage.cache_creation_input_tokens ?? 0
              }
            : undefined
        })
        break
      }

      default:
        break
    }
  }

  private handleStreamEvent(ev: { type: string; message?: { id?: string }; delta?: { type?: string; text?: string } }): void {
    if (ev.type === 'message_start') {
      this.liveId = ev.message?.id ?? nextId()
      this.liveText = ''
    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      if (!this.liveId) this.liveId = nextId()
      this.liveText += ev.delta.text ?? ''
      this.emit({ kind: 'assistant-text', id: this.liveId, text: this.liveText, final: false })
    }
  }

  private handleAssistant(blocks: AssistantBlock[]): void {
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        this.emit({ kind: 'assistant-text', id: this.liveId ?? nextId(), text: block.text, final: true })
      } else if (block.type === 'thinking' && block.thinking) {
        this.emit({ kind: 'thinking', id: nextId(), text: block.thinking })
      } else if (block.type === 'tool_use') {
        this.emit({
          kind: 'tool-use',
          id: block.id ?? nextId(),
          name: block.name ?? 'tool',
          input: block.input,
          parentToolUseId: null
        })
      }
    }
    this.liveId = null
    this.liveText = ''
  }

  private handleUser(content: AssistantBlock[] | string): void {
    if (typeof content === 'string') return
    for (const block of content) {
      if (block.type === 'tool_result') {
        const raw = (block as unknown as { content?: unknown; tool_use_id?: string; is_error?: boolean })
        this.emit({
          kind: 'tool-result',
          id: nextId(),
          toolUseId: raw.tool_use_id ?? '',
          isError: Boolean(raw.is_error),
          text: stringifyToolResult(raw.content)
        })
      }
    }
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 4000)
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const b = c as { type?: string; text?: string }
        if (b.type === 'text') return b.text ?? ''
        if (b.type === 'image') return '[image]'
        return ''
      })
      .join('\n')
      .slice(0, 4000)
  }
  return ''
}
