// Claude Code authentication state. The CLI (which the Agent SDK runs) stores its
// OAuth login in ~/.claude/.credentials.json under "claudeAiOauth". We only need to
// know whether a login exists so the app can trigger /login itself instead of
// telling the user to type it. Token refresh is the CLI's job — presence is enough.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

export function credentialsPath(): string {
  return join(homedir(), '.claude', '.credentials.json')
}

/** True when a Claude OAuth login is present on this machine. */
export function isAuthenticated(): boolean {
  try {
    const raw = readFileSync(credentialsPath(), 'utf8')
    const data = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } }
    return typeof data.claudeAiOauth?.accessToken === 'string' && data.claudeAiOauth.accessToken.length > 0
  } catch {
    return false
  }
}
