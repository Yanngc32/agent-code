import type { RefObject } from 'react'
import type { ImageAttachment, PickedElement } from '@shared/ipc'
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
  onSend: (text: string, images: ImageAttachment[]) => void
  onInterrupt: () => void
  composerRef: RefObject<HTMLTextAreaElement | null>
  /** Projects from history, offered in the composer's @ reference menu. */
  projects: RefProject[]
  /** Active conversation id — resets the message window when it changes. */
  convId: string | null
}

const fmt = (n: number): string => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}t` // trilhão
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}b` // bilhão
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}m` // milhão
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k` // mil
  return String(n)
}

export function ChatPanel(props: Props): JSX.Element {
  const { messages, hasActive, busy, tokens } = props
  return (
    <section className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Chat</span>
        <div className="token-meter" title="Uso de tokens da sessão">
          <span
            className="tok ctx"
            title={`Tokens de contexto na última resposta: ${tokens.context.toLocaleString('pt-BR')}`}
          >
            ⬚ {fmt(tokens.context)} ctx
          </span>
          <span
            className="tok out"
            title={`Tokens de saída acumulados: ${tokens.output.toLocaleString('pt-BR')}`}
          >
            ↓ {fmt(tokens.output)} out
          </span>
          <span className="tok cost" title={`Custo estimado acumulado: $${tokens.cost.toFixed(6)}`}>
            ${tokens.cost.toFixed(2)}
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
