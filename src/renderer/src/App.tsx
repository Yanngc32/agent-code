import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserState, ChatEvent, PermissionRequest, PickedElement } from '@shared/ipc'
import type { Conversation, UIMessage } from './types'
import { DEFAULT_TITLE } from './types'
import { loadConversations, loadUi, saveConversations, saveUi } from './storage'
import { ChatPanel } from './components/ChatPanel'
import { BrowserPanel } from './components/BrowserPanel'
import { Sidebar, type SidebarProject } from './components/Sidebar'
import { useUI } from './ui/UiProvider'
import { PermissionModal } from './ui/PermissionModal'

export type { UserMessage, UIMessage } from './types'

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }
]

const EMPTY_TOKENS = { context: 0, output: 0, cost: 0 }

function basename(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || p
}

function deriveTitle(text: string): string {
  const first = text.trim().split('\n')[0].trim()
  if (!first) return DEFAULT_TITLE
  return first.length > 48 ? first.slice(0, 48) + '…' : first
}

function uid(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** Pure reducer for a conversation's message list (system events handled by the caller). */
function reduceMessages(prev: UIMessage[], e: ChatEvent): UIMessage[] {
  if (e.kind === 'assistant-text') {
    const i = prev.findIndex((m) => m.kind === 'assistant-text' && m.id === e.id)
    if (i >= 0) {
      const copy = [...prev]
      copy[i] = { ...e }
      return copy
    }
  }
  if (e.kind === 'tool-result') {
    const i = prev.findIndex((m) => m.kind === 'tool-use' && m.id === e.toolUseId)
    if (i >= 0) {
      const copy = [...prev]
      copy[i] = { ...copy[i], result: { isError: e.isError, text: e.text } }
      return copy
    }
  }
  if (e.kind === 'result') {
    // The result text duplicates the final answer and the cost is in the header,
    // so we don't render it — we only mark the last assistant text as the answer.
    const copy = [...prev]
    for (let i = copy.length - 1; i >= 0; i--) {
      if (copy[i].kind === 'assistant-text') {
        copy[i] = { ...copy[i], answer: true }
        break
      }
    }
    return copy
  }
  return [...prev, e as UIMessage]
}

export function App(): JSX.Element {
  const { notify } = useUI()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Which conversation the live (main-process) agent is currently serving.
  const [connectedId, setConnectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [skipPerms, setSkipPerms] = useState(false)
  const [permission, setPermission] = useState<PermissionRequest | null>(null)
  const [chips, setChips] = useState<PickedElement[]>([])
  const [browserState, setBrowserState] = useState<BrowserState>({
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    launched: false
  })
  const composerRef = useRef<HTMLTextAreaElement>(null)

  // Refs so async handlers / the once-registered event listener see current values.
  const convsRef = useRef(conversations)
  convsRef.current = conversations
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const connectedRef = useRef<string | null>(connectedId)
  connectedRef.current = connectedId
  const skipPermsRef = useRef(skipPerms)
  skipPermsRef.current = skipPerms
  const chipsRef = useRef(chips)
  chipsRef.current = chips

  const getActive = (): Conversation | null =>
    convsRef.current.find((c) => c.id === activeIdRef.current) ?? null

  const patchConv = useCallback((id: string, fn: (c: Conversation) => Conversation): void => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)))
  }, [])

  // ---- agent event stream (routed to the connected conversation) ----
  const onEvent = useCallback(
    (e: ChatEvent) => {
      const cid = connectedRef.current
      if (cid) {
        patchConv(cid, (c) => {
          let next: Conversation
          if (e.kind === 'system') {
            next = {
              ...c,
              sdkSessionId: e.sessionId,
              model: e.model || c.model,
              // Only keep one "session ready" note even across resumes.
              messages: c.messages.some((m) => m.kind === 'system')
                ? c.messages
                : [...c.messages, e as UIMessage]
            }
          } else {
            next = { ...c, messages: reduceMessages(c.messages, e), updatedAt: Date.now() }
          }
          if (e.kind === 'result' && e.usage) {
            const u = e.usage
            next = {
              ...next,
              tokens: {
                context: u.input + u.cacheRead + u.cacheWrite,
                output: c.tokens.output + u.output,
                cost: c.tokens.cost + (e.costUsd ?? 0)
              }
            }
          }
          return next
        })
      }
      if (e.kind === 'result' || e.kind === 'error') setBusy(false)
      if (e.kind === 'error') notify('erro', e.text)
    },
    [patchConv, notify]
  )

  useEffect(() => {
    const offEvent = window.api.onAgentEvent(onEvent)
    const offPerm = window.api.onPermissionRequest((r) => setPermission(r))
    const offState = window.api.onBrowserState(setBrowserState)
    const offPicked = window.api.onBrowserPicked((el) => {
      setChips((c) => [...c, el])
      composerRef.current?.focus()
    })
    return () => {
      offEvent()
      offPerm()
      offState()
      offPicked()
    }
  }, [onEvent])

  // ---- load persisted history once ----
  useEffect(() => {
    const loaded = loadConversations()
    const ui = loadUi()
    setConversations(loaded)
    setCollapsed(ui.collapsed)
    setActiveId(
      ui.activeId && loaded.some((c) => c.id === ui.activeId)
        ? ui.activeId
        : loaded[0]?.id ?? null
    )
    setHydrated(true)
  }, [])

  // ---- persist (debounced for the rapidly-changing message stream) ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!hydrated) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveConversations(convsRef.current), 400)
    return () => clearTimeout(saveTimer.current)
  }, [conversations, hydrated])
  useEffect(() => {
    if (hydrated) saveUi({ collapsed, activeId })
  }, [collapsed, activeId, hydrated])

  // ---- conversation management ----
  const createConversation = (folder: string): void => {
    const conv: Conversation = {
      id: uid('c'),
      title: DEFAULT_TITLE,
      cwd: folder,
      model: getActive()?.model || MODELS[0].id,
      sdkSessionId: null,
      messages: [],
      tokens: { ...EMPTY_TOKENS },
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    setConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
  }

  const newChat = useCallback(async (): Promise<void> => {
    let folder = getActive()?.cwd || convsRef.current[0]?.cwd || ''
    if (!folder) {
      folder = (await window.api.pickDirectory()) || ''
      if (!folder) {
        notify('aviso', 'Nenhuma pasta selecionada.')
        return
      }
    }
    createConversation(folder)
  }, [notify])

  const newProject = useCallback(async (): Promise<void> => {
    const folder = (await window.api.pickDirectory()) || ''
    if (folder) createConversation(folder)
    else notify('aviso', 'Nenhuma pasta selecionada.')
  }, [notify])

  const selectConversation = useCallback((id: string): void => {
    setActiveId(id)
    setPermission(null)
  }, [])

  const renameConversation = useCallback(
    (id: string, title: string): void => patchConv(id, (c) => ({ ...c, title: title.trim() || c.title })),
    [patchConv]
  )

  const deleteConversation = useCallback((id: string): void => {
    const next = convsRef.current.filter((c) => c.id !== id)
    if (connectedRef.current === id) setConnectedId(null)
    setConversations(next)
    if (activeIdRef.current === id) setActiveId(next[0]?.id ?? null)
  }, [])

  // ---- agent connection ----
  const connect = useCallback(async (conv: Conversation): Promise<void> => {
    await window.api.startAgent({
      cwd: conv.cwd,
      model: conv.model,
      skipPermissions: skipPermsRef.current,
      resume: conv.sdkSessionId ?? undefined
    })
    setConnectedId(conv.id)
    connectedRef.current = conv.id
    setBusy(false)
    setPermission(null)
  }, [])

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const conv = getActive()
      if (!conv) return
      let full = text.trim()
      if (chipsRef.current.length) {
        const refs = chipsRef.current
          .map(
            (c, i) =>
              `[#${i + 1} ${c.tagName}${c.id ? '#' + c.id : ''}] selector: ${c.selector}\n` +
              `text: ${c.text.slice(0, 400)}\nhtml: ${c.html.slice(0, 600)}`
          )
          .join('\n\n')
        full = `${full}\n\n--- Selected page elements ---\n${refs}`
      }
      if (!full) return

      // Lazily (re)start the agent for this conversation, resuming if possible.
      if (connectedRef.current !== conv.id) await connect(conv)

      patchConv(conv.id, (c) => ({
        ...c,
        title: c.title === DEFAULT_TITLE && text.trim() ? deriveTitle(text) : c.title,
        messages: [...c.messages, { kind: 'user', id: uid('u'), text }],
        updatedAt: Date.now()
      }))
      setBusy(true)
      setChips([])
      await window.api.sendMessage(full)
    },
    [connect, patchConv]
  )

  const respond = useCallback(
    async (behavior: 'allow' | 'deny', always: boolean): Promise<void> => {
      if (!permission) return
      await window.api.respondPermission({ id: permission.id, behavior, always })
      setPermission(null)
    },
    [permission]
  )

  // ---- derived view state ----
  const active = conversations.find((c) => c.id === activeId) ?? null
  const activeConnected = connectedId !== null && connectedId === activeId
  const showBusy = busy && activeConnected
  const messages = active?.messages ?? []
  const tokens = active?.tokens ?? EMPTY_TOKENS

  const projects = useMemo<SidebarProject[]>(() => {
    const map = new Map<string, Conversation[]>()
    for (const c of conversations) {
      const arr = map.get(c.cwd)
      if (arr) arr.push(c)
      else map.set(c.cwd, [c])
    }
    const recency = (cs: Conversation[]): number => Math.max(...cs.map((c) => c.updatedAt))
    return [...map.entries()]
      .map(([path, cs]) => ({
        path,
        name: basename(path),
        conversations: [...cs].sort((a, b) => b.updatedAt - a.updatedAt)
      }))
      .sort((a, b) => recency(b.conversations) - recency(a.conversations))
  }, [conversations])

  const recents = useMemo<Conversation[]>(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 15),
    [conversations]
  )

  return (
    <div className="app">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        projects={projects}
        recents={recents}
        activeId={activeId}
        onSelect={selectConversation}
        onNewChat={newChat}
        onNewProject={newProject}
        onRename={renameConversation}
        onDelete={deleteConversation}
      />

      <div className="main-area">
        <header className="topbar">
          <div className="project readonly" title={active?.cwd || ''}>
            <span className="project-label">Projeto</span>
            <span className="project-path">{active ? basename(active.cwd) : 'Nenhuma conversa'}</span>
          </div>
          <select
            className="model-select"
            value={active?.model ?? MODELS[0].id}
            disabled={!active || activeConnected}
            onChange={(e) => active && patchConv(active.id, (c) => ({ ...c, model: e.target.value }))}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <label
            className="skip-perms"
            title="Permite todas as ferramentas sem pedir permissão. Pode ligar/desligar a qualquer momento."
          >
            <input
              type="checkbox"
              checked={skipPerms}
              onChange={(e) => {
                const on = e.target.checked
                setSkipPerms(on)
                if (activeConnected) {
                  void window.api.setBypass(on)
                  if (on) setPermission(null)
                }
                notify(
                  on ? 'aviso' : 'sucesso',
                  on
                    ? 'Modo "permitir tudo" ativado — ferramentas não pedirão confirmação.'
                    : 'Confirmações de permissão reativadas.'
                )
              }}
            />
            Permitir tudo
          </label>
          {!active ? null : activeConnected ? (
            <span className={`session-pill ${skipPerms ? 'danger' : ''}`}>
              ● {skipPerms ? 'allow-all' : 'conectado'}
            </span>
          ) : (
            <button
              className="btn primary"
              onClick={async () => {
                await connect(active)
                notify('sucesso', `Conectado · ${basename(active.cwd)}`)
              }}
            >
              Conectar
            </button>
          )}
        </header>

        <div className="workspace">
          <ChatPanel
            messages={messages}
            hasActive={!!active}
            busy={showBusy}
            tokens={tokens}
            chips={chips}
            onRemoveChip={(i) => setChips((c) => c.filter((_, idx) => idx !== i))}
            onSend={sendMessage}
            onInterrupt={() => window.api.interrupt()}
            composerRef={composerRef}
          />
          <BrowserPanel state={browserState} />
        </div>
      </div>

      {activeConnected && permission && (
        <PermissionModal request={permission} onRespond={respond} />
      )}
    </div>
  )
}
