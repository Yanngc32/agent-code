import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type {
  AgentEventMsg,
  BrowserState,
  ChatEvent,
  ImageAttachment,
  PermissionRequest,
  PickedElement
} from '@shared/ipc'
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

/** A message waiting in the per-conversation outbox while the agent is busy. */
interface QueuedMessage {
  id: string
  convId: string
  /** Full payload sent to the agent (text + appended page-element refs). */
  full: string
  /** Original text (for display and the conversation title). */
  text: string
  images: ImageAttachment[]
  /** Data-URL thumbnails for display. */
  thumbs: string[]
}

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

// Immutable Set helpers (React needs a new reference to re-render).
function withId(s: Set<string>, id: string): Set<string> {
  return new Set(s).add(id)
}
function withoutId(s: Set<string>, id: string): Set<string> {
  const n = new Set(s)
  n.delete(id)
  return n
}
function withoutKey<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec
  const n = { ...rec }
  delete n[key]
  return n
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
  const [browserMinimized, setBrowserMinimized] = useState(false)
  const [browserWidth, setBrowserWidth] = useState(720)
  const [hydrated, setHydrated] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)

  // Each conversation can have its own live agent session running in parallel.
  // `connectedIds` = conversations with a live session; `busyIds` = those mid-turn;
  // `permissions` = pending tool-permission request per conversation.
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  // When the current turn started (ms epoch) and how long the last one took,
  // per conversation — drives the running-time indicator above the chat.
  const [busySince, setBusySince] = useState<Record<string, number>>({})
  const [lastDuration, setLastDuration] = useState<Record<string, number>>({})
  const [skipPerms, setSkipPerms] = useState(false)
  const [permissions, setPermissions] = useState<Record<string, PermissionRequest>>({})
  const [chips, setChips] = useState<PickedElement[]>([])
  // Messages typed while the agent is busy wait here (per conversation) instead
  // of being sent to the SDK — so a running task is never cancelled. The next
  // one is dispatched when the current turn finishes; the user can delete any.
  const [queue, setQueue] = useState<QueuedMessage[]>([])
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
  const connectedRef = useRef(connectedIds)
  connectedRef.current = connectedIds
  const busyRef = useRef(busyIds)
  busyRef.current = busyIds
  const skipPermsRef = useRef(skipPerms)
  skipPermsRef.current = skipPerms
  const chipsRef = useRef(chips)
  chipsRef.current = chips
  const queueRef = useRef(queue)
  queueRef.current = queue

  const getActive = (): Conversation | null =>
    convsRef.current.find((c) => c.id === activeIdRef.current) ?? null

  const patchConv = useCallback((id: string, fn: (c: Conversation) => Conversation): void => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)))
  }, [])

  // Set/clear busy for a conversation, keeping the ref in sync for the async
  // send path (which reads busyRef right after awaiting connect()).
  const setBusy = useCallback((id: string, on: boolean): void => {
    busyRef.current = on ? withId(busyRef.current, id) : withoutId(busyRef.current, id)
    setBusyIds((s) => (on ? withId(s, id) : withoutId(s, id)))
  }, [])
  const setConnected = useCallback((id: string, on: boolean): void => {
    connectedRef.current = on ? withId(connectedRef.current, id) : withoutId(connectedRef.current, id)
    setConnectedIds((s) => (on ? withId(s, id) : withoutId(s, id)))
  }, [])

  // ---- agent event stream (each event is tagged with its conversation) ----
  const onEvent = useCallback(
    ({ convId: cid, event: e }: AgentEventMsg) => {
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
              // Real context-window size of the last model request (not the
              // per-turn sum); falls back to the old computation if absent.
              context: e.contextTokens ?? u.input + u.cacheRead + u.cacheWrite,
              output: c.tokens.output + u.output,
              cost: c.tokens.cost + (e.costUsd ?? 0)
            }
          }
        }
        return next
      })

      if (e.kind === 'result' || e.kind === 'error') {
        // A finished turn has no outstanding permission request — clear any so a
        // stale modal can't reappear when this conversation becomes active again.
        setPermissions((p) => withoutKey(p, cid))
        if (e.kind === 'result') setLastDuration((m) => ({ ...m, [cid]: e.durationMs }))
        // Turn finished → dispatch the next queued message for this conversation
        // (if any). The conversation stays "busy" through the handoff; only when
        // the queue is empty do we mark it idle.
        const next = queueRef.current.find((m) => m.convId === cid)
        if (next && e.kind === 'result') {
          setQueue((cur) => cur.filter((m) => m.id !== next.id))
          patchConv(cid, (c) => ({
            ...c,
            title: c.title === DEFAULT_TITLE && next.text.trim() ? deriveTitle(next.text) : c.title,
            messages: [
              ...c.messages,
              { kind: 'user', id: uid('u'), text: next.text, images: next.thumbs.length ? next.thumbs : undefined }
            ],
            updatedAt: Date.now()
          }))
          void window.api.sendMessage(cid, next.full, next.images)
          setBusySince((m) => ({ ...m, [cid]: Date.now() })) // restart timer for the next turn
        } else {
          setBusy(cid, false)
          setBusySince((m) => withoutKey(m, cid)) // stop the running timer
        }
      }
      if (e.kind === 'error') {
        notify('erro', e.text)
        // Session ended on a fatal error → allow reconnecting this conversation,
        // and drop anything queued for it (it would never be dispatched).
        setConnected(cid, false)
        setQueue((cur) => cur.filter((m) => m.convId !== cid))
      }
    },
    [patchConv, notify, setBusy, setConnected]
  )

  useEffect(() => {
    const offEvent = window.api.onAgentEvent(onEvent)
    const offPerm = window.api.onPermissionRequest(({ convId, req }) => {
      setPermissions((p) => ({ ...p, [convId]: req }))
      // A background conversation's permission modal isn't visible (only the
      // active one renders) — toast so the user knows that chat is waiting,
      // otherwise its session (and queue) would silently freeze.
      if (convId !== activeIdRef.current) {
        const title = convsRef.current.find((c) => c.id === convId)?.title ?? 'Outra conversa'
        notify('aviso', `“${title}” está aguardando uma permissão.`)
      }
    })
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
    setBrowserMinimized(ui.browserMinimized)
    setBrowserWidth(ui.browserWidth)
    setActiveId(
      ui.activeId && loaded.some((c) => c.id === ui.activeId)
        ? ui.activeId
        : loaded[0]?.id ?? null
    )
    setHydrated(true)
  }, [])

  // Tell main which conversation's browser the panel should show, so each chat
  // gets its own independent browser instance.
  useEffect(() => {
    if (hydrated) void window.api.setActiveBrowser(activeId)
  }, [activeId, hydrated])

  // ---- persist (debounced for the rapidly-changing message stream) ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!hydrated) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveConversations(convsRef.current), 400)
    return () => clearTimeout(saveTimer.current)
  }, [conversations, hydrated])
  useEffect(() => {
    if (hydrated) saveUi({ collapsed, activeId, browserMinimized, browserWidth })
  }, [collapsed, activeId, browserMinimized, browserWidth, hydrated])

  // Drag the splitter between chat and browser to resize the browser panel; the
  // page viewport follows (BrowserPanel reports its new size to main).
  const startBrowserDrag = useCallback((e: ReactMouseEvent): void => {
    e.preventDefault()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent): void => {
      const ws = workspaceRef.current
      if (!ws) return
      const rect = ws.getBoundingClientRect()
      const w = Math.max(340, Math.min(rect.width - 440, rect.right - ev.clientX))
      setBrowserWidth(w)
    }
    const onUp = (): void => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

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
  }, [])

  const renameConversation = useCallback(
    (id: string, title: string): void => patchConv(id, (c) => ({ ...c, title: title.trim() || c.title })),
    [patchConv]
  )

  const deleteConversation = useCallback(
    (id: string): void => {
      const next = convsRef.current.filter((c) => c.id !== id)
      void window.api.disposeAgent(id)
      void window.api.disposeBrowser(id)
      setConnected(id, false)
      setBusy(id, false)
      setBusySince((m) => withoutKey(m, id))
      setLastDuration((m) => withoutKey(m, id))
      setPermissions((p) => withoutKey(p, id))
      setQueue((q) => q.filter((m) => m.convId !== id))
      setConversations(next)
      if (activeIdRef.current === id) setActiveId(next[0]?.id ?? null)
    },
    [setConnected, setBusy]
  )

  // ---- agent connection ----
  // In-flight connect promises per conversation: two concurrent sends (or a send
  // racing the "Conectar" button) share ONE startAgent instead of disposing and
  // recreating the session (which would drop a message).
  const connectingRef = useRef<Map<string, Promise<void>>>(new Map())
  const connect = useCallback(
    (conv: Conversation): Promise<void> => {
      if (connectedRef.current.has(conv.id)) return Promise.resolve()
      const inflight = connectingRef.current.get(conv.id)
      if (inflight) return inflight
      const p = (async () => {
        await window.api.startAgent({
          convId: conv.id,
          cwd: conv.cwd,
          model: conv.model,
          skipPermissions: skipPermsRef.current,
          resume: conv.sdkSessionId ?? undefined
        })
        setConnected(conv.id, true)
        setPermissions((pp) => withoutKey(pp, conv.id))
      })()
      connectingRef.current.set(conv.id, p)
      void p.finally(() => connectingRef.current.delete(conv.id))
      return p
    },
    [setConnected]
  )

  const sendMessage = useCallback(
    async (text: string, images: ImageAttachment[] = []): Promise<void> => {
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
      if (!full && images.length === 0) return

      const thumbs = images.map((img) => `data:${img.mediaType};base64,${img.data}`)

      // Agent already busy on THIS conversation → queue instead of sending, so
      // the running task isn't cancelled. It'll be dispatched when the turn ends.
      if (busyRef.current.has(conv.id)) {
        setQueue((q) => [...q, { id: uid('q'), convId: conv.id, full, text, images, thumbs }])
        setChips([])
        return
      }

      // Reflect the send SYNCHRONOUSLY before any await: mark busy (so a second
      // concurrent send queues instead of starting a duplicate session), show the
      // user's message immediately, and clear the chips it consumed. Doing this
      // before `await connect` is what closes the connect-window race.
      setBusy(conv.id, true)
      setBusySince((m) => ({ ...m, [conv.id]: Date.now() }))
      patchConv(conv.id, (c) => ({
        ...c,
        title: c.title === DEFAULT_TITLE && text.trim() ? deriveTitle(text) : c.title,
        messages: [
          ...c.messages,
          { kind: 'user', id: uid('u'), text, images: thumbs.length ? thumbs : undefined }
        ],
        updatedAt: Date.now()
      }))
      setChips([])

      try {
        // Lazily (re)start the agent for this conversation, resuming if possible.
        if (!connectedRef.current.has(conv.id)) await connect(conv)
        await window.api.sendMessage(conv.id, full, images)
      } catch (err) {
        setBusy(conv.id, false)
        setBusySince((m) => withoutKey(m, conv.id))
        notify('erro', `Falha ao enviar: ${String(err)}`)
      }
    },
    [connect, patchConv, setBusy, notify]
  )

  const deleteQueued = useCallback((id: string): void => {
    setQueue((q) => q.filter((m) => m.id !== id))
  }, [])

  const respond = useCallback(
    async (behavior: 'allow' | 'deny', always: boolean): Promise<void> => {
      const cid = activeId
      if (!cid) return
      const req = permissions[cid]
      if (!req) return
      await window.api.respondPermission(cid, { id: req.id, behavior, always })
      setPermissions((p) => withoutKey(p, cid))
    },
    [activeId, permissions]
  )

  const interrupt = useCallback((): void => {
    const cid = activeIdRef.current
    if (!cid) return
    // Stop the current task AND drop anything queued for this conversation. The
    // SDK ends an interrupt by emitting a `result` (not `error`); with the queue
    // cleared, the turn-end handler finds nothing to dispatch and just goes idle
    // instead of auto-starting the next queued message.
    setQueue((q) => q.filter((m) => m.convId !== cid))
    void window.api.interrupt(cid)
  }, [])

  // ---- derived view state ----
  const active = conversations.find((c) => c.id === activeId) ?? null
  const activeConnected = activeId !== null && connectedIds.has(activeId)
  const showBusy = activeId !== null && busyIds.has(activeId)
  const activePermission = activeId ? permissions[activeId] : undefined
  const messages = active?.messages ?? []
  const tokens = active?.tokens ?? EMPTY_TOKENS
  const activeQueue = active ? queue.filter((m) => m.convId === active.id) : []
  const runningSince = activeId ? busySince[activeId] ?? null : null
  const lastDurationMs = activeId ? lastDuration[activeId] ?? null : null

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
                // Apply to every live session so "permitir tudo" is a global switch.
                for (const id of connectedIds) void window.api.setBypass(id, on)
                if (on) setPermissions({})
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

        <div className="workspace" ref={workspaceRef}>
          <ChatPanel
            messages={messages}
            hasActive={!!active}
            busy={showBusy}
            tokens={tokens}
            chips={chips}
            onRemoveChip={(i) => setChips((c) => c.filter((_, idx) => idx !== i))}
            onSend={sendMessage}
            onInterrupt={interrupt}
            composerRef={composerRef}
            projects={projects}
            convId={active?.id ?? null}
            queued={activeQueue}
            onDeleteQueued={deleteQueued}
            runningSince={runningSince}
            lastDurationMs={lastDurationMs}
          />
          {!browserMinimized && (
            <div
              className="splitter"
              onMouseDown={startBrowserDrag}
              title="Arraste para redimensionar o navegador"
            />
          )}
          <BrowserPanel
            state={browserState}
            minimized={browserMinimized}
            onToggleMinimize={() => setBrowserMinimized((v) => !v)}
            width={browserWidth}
          />
        </div>
      </div>

      {activePermission && <PermissionModal request={activePermission} onRespond={respond} />}
    </div>
  )
}
