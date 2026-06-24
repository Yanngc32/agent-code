// Drives the Claude Code OAuth login WITHOUT the user typing /login. We open a
// throwaway SDK session, send "/login" (the same command the CLI uses), open the
// OAuth URL it surfaces in the system browser, and wait until credentials appear
// on disk. The chat session then starts already authenticated.
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from './asyncQueue'
import { homedir } from 'node:os'
import { isAuthenticated } from './auth'

/** Pull any human-readable text out of an SDK message (for URL scanning/logging). */
function collectText(m: unknown): string {
  const msg = m as { type?: string; message?: { content?: unknown }; event?: { delta?: { text?: string } }; result?: unknown }
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    return (msg.message!.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
  }
  if (msg.type === 'stream_event' && typeof msg.event?.delta?.text === 'string') return msg.event.delta.text
  if (msg.type === 'result' && typeof msg.result === 'string') return msg.result
  return ''
}

/**
 * Run the login flow. `openUrl` gets the OAuth URL to open in the browser; `log`
 * receives diagnostic lines. Resolves true once credentials exist on disk.
 */
export async function runClaudeLogin(openUrl: (url: string) => void, log: (line: string) => void): Promise<boolean> {
  if (isAuthenticated()) return true

  const input = new AsyncQueue<SDKUserMessage>()
  const q = query({
    prompt: input,
    options: { executable: 'node', cwd: homedir(), permissionMode: 'default' }
  })
  input.push({
    type: 'user',
    message: { role: 'user', content: '/login' },
    parent_tool_use_id: null
  } as SDKUserMessage)
  log('sent /login')

  let opened = false
  const urlRe = /(https?:\/\/[^\s"')]+)/gi
  // When credentials land on disk the flow is done — close the input to end the loop.
  const poll = setInterval(() => {
    if (isAuthenticated()) {
      log('credentials detected on disk')
      input.close()
    }
  }, 1500)
  const timeout = setTimeout(() => {
    log('timeout (3 min) — closing')
    input.close()
  }, 180_000)

  try {
    for await (const m of q) {
      const sub = (m as { subtype?: string }).subtype
      log(`msg: ${(m as { type?: string }).type}${sub ? '/' + sub : ''}`)
      const text = collectText(m)
      if (text) {
        log(`text: ${text.slice(0, 400)}`)
        if (!opened) {
          const urls = text.match(urlRe) ?? []
          const oauth = urls.find((u) => /oauth|authorize|\/login|claude\.ai|anthropic\.com/i.test(u))
          if (oauth) {
            opened = true
            log(`opening browser: ${oauth}`)
            openUrl(oauth)
          }
        }
      }
    }
  } catch (err) {
    log(`error: ${String(err instanceof Error ? err.message : err)}`)
  } finally {
    clearInterval(poll)
    clearTimeout(timeout)
  }
  return isAuthenticated()
}
