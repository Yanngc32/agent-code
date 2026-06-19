import type { RefObject } from 'react'
import type { PickedElement } from '@shared/ipc'
import type { UIMessage } from '../types'
import { MessageList } from './MessageList'
import { Composer, type RefProject } from './Composer'

interface Props {
  messages: UIMessage[]
  /** Whether a conversation is selected (composer enabled). */
  hasActive: boolean
  busy: boolean
  tokens: { context: number; output: number; cost: number }
  chips: PickedElement[]
  onRemoveChip: (i: number) => void
  onSend: (text: string) => void
  onInterrupt: () => void
  composerRef: RefObject<HTMLTextAreaElement | null>
  /** Projects from history, offered in the composer's @ reference menu. */
  projects: RefProject[]
  /** Active conversation id — resets the message window when it changes. */
  convId: string | null
}

const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function ChatPanel(props: Props): JSX.Element {
  const { messages, hasActive, busy, tokens } = props
  return (
    <section className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Chat</span>
        <div className="token-meter" title="Uso de tokens da sessão">
          <span className="tok ctx" title="Tokens de contexto na última resposta">
            ⬚ {fmt(tokens.context)} ctx
          </span>
          <span className="tok out" title="Tokens de saída acumulados">
            ↓ {fmt(tokens.output)} out
          </span>
          <span className="tok cost" title="Custo estimado acumulado">
            ${tokens.cost.toFixed(4)}
          </span>
        </div>
      </div>

      {messages.length === 0 && (
        <div className="empty-state">
          <div className="empty-logo">✦</div>
          <h2>Claude Code</h2>
          <p>
            {hasActive
              ? 'Ask Claude to build, edit, or research. It can open the embedded browser on the right when needed.'
              : 'Crie uma conversa na barra à esquerda para começar.'}
          </p>
        </div>
      )}

      <MessageList key={props.convId ?? 'none'} messages={messages} busy={busy} />

      <Composer
        disabled={!hasActive}
        busy={busy}
        chips={props.chips}
        onRemoveChip={props.onRemoveChip}
        onSend={props.onSend}
        onInterrupt={props.onInterrupt}
        textareaRef={props.composerRef}
        projects={props.projects}
      />
    </section>
  )
}
