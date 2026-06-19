import type { Conversation } from './types'

// Local persistence for the conversation history sidebar. The agent's own
// transcript is also stored by the SDK under ~/.claude/projects (used for
// `resume`); this keeps the rendered history + sidebar metadata across restarts.

const CONV_KEY = 'agentcode.conversations.v1'
const UI_KEY = 'agentcode.ui.v1'

export interface UiState {
  collapsed: boolean
  activeId: string | null
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONV_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Conversation[]) : []
  } catch {
    return []
  }
}

export function saveConversations(list: Conversation[]): void {
  try {
    localStorage.setItem(CONV_KEY, JSON.stringify(list))
  } catch {
    /* localStorage quota — ignore, history is best-effort */
  }
}

export function loadUi(): UiState {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (raw) return { collapsed: false, activeId: null, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { collapsed: false, activeId: null }
}

export function saveUi(ui: UiState): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui))
  } catch {
    /* ignore */
  }
}
