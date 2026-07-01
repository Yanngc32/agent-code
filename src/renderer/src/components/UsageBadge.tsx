import type { RateLimitStatus } from '@shared/ipc'

/** Portuguese label + display order for each Anthropic rate-limit window.
 *  Order matters: the 5h session comes first (most actionable), then the
 *  weekly windows, then overage. */
const LABELS: Record<RateLimitStatus['rateLimitType'], string> = {
  five_hour: 'Sessão 5h',
  seven_day: 'Semana',
  seven_day_opus: 'Semana · Opus',
  seven_day_sonnet: 'Semana · Sonnet',
  seven_day_overage_included: 'Semana (excedente incluso)',
  overage: 'Excedente'
}
const ORDER: RateLimitStatus['rateLimitType'][] = [
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_overage_included',
  'overage'
]

/** What each window actually means — shown in the tooltip so hovering explains
 *  the CONCEPT (account-wide, shared across every Claude app), not just the %. */
const EXPLAIN: Record<RateLimitStatus['rateLimitType'], string> = {
  five_hour:
    'Janela de 5 horas da sua CONTA Anthropic (Pro/Max) — reseta a cada 5h corridas. ' +
    'Soma o uso em TODOS os apps com a mesma conta: Claude Desktop, claude.ai, Claude Code e este app. ' +
    'Não é desta conversa nem deste app sozinho.',
  seven_day:
    'Limite semanal (7 dias) da sua CONTA Anthropic — mesma ideia da janela de 5h, só que numa janela maior. ' +
    'Soma o uso em TODOS os apps com a mesma conta: Claude Desktop, claude.ai, Claude Code e este app.',
  seven_day_opus: 'Limite semanal (7 dias) específico do modelo Opus, na sua CONTA Anthropic — soma todos os apps.',
  seven_day_sonnet: 'Limite semanal (7 dias) específico do modelo Sonnet, na sua CONTA Anthropic — soma todos os apps.',
  seven_day_overage_included:
    'Limite semanal (7 dias) da sua CONTA Anthropic, já contando o excedente pago incluso — soma todos os apps.',
  overage: 'Excedente pago além do seu plano, na sua CONTA Anthropic.'
}

function fmtResetsAt(ms: number): string {
  const diff = ms - Date.now()
  if (diff <= 0) return 'já resetou'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `reseta em ${mins}min`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `reseta em ${hours}h`
  return `reseta em ${Math.round(hours / 24)}d`
}

/** One window's usage pill — same visual language as ChatPanel's ContextBar
 *  (`.ctx-bar*` classes), so the topbar and the chat header feel consistent.
 *  The reset time sits beside it in small, muted text — always visible, not
 *  just on hover (the hover tooltip still explains the concept + repeats it). */
function UsagePill({ limit }: { limit: RateLimitStatus }): JSX.Element {
  const pct = Math.min(100, (limit.utilization ?? 0) * 100)
  const level = limit.status === 'rejected' || pct >= 95 ? 'crit' : limit.status === 'allowed_warning' || pct >= 80 ? 'warn' : 'ok'
  const label = LABELS[limit.rateLimitType]
  const resetText = limit.resetsAt ? fmtResetsAt(limit.resetsAt) : ''
  const resetHint = resetText ? ` — ${resetText}` : ''
  return (
    <div className="usage-item">
      <div
        className={`ctx-bar usage-pill ${level}`}
        title={`${EXPLAIN[limit.rateLimitType]} ${pct.toFixed(0)}% usado${resetHint}.`}
      >
        <span className="ctx-bar-cap">{label}</span>
        <span className="ctx-bar-track">
          <span className="ctx-bar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="ctx-bar-val">{pct.toFixed(0)}%</span>
      </div>
      {resetText && <span className="usage-reset">{resetText}</span>}
    </div>
  )
}

/** Account-wide usage (5h session / weekly / etc.), shown in the topbar — NOT
 *  tied to the active conversation (unlike ContextBar). Renders nothing until
 *  the SDK sends at least one `rate_limit_event`; API-key-only accounts (no
 *  claude.ai subscription) never trigger that event, so the badge silently
 *  stays hidden instead of showing a misleading empty/0% bar. */
export function UsageBadge({ limits }: { limits: Record<string, RateLimitStatus> }): JSX.Element | null {
  const present = ORDER.map((t) => limits[t]).filter((l): l is RateLimitStatus => !!l)
  if (present.length === 0) return null
  return (
    <div className="usage-badge">
      {present.map((l) => (
        <UsagePill key={l.rateLimitType} limit={l} />
      ))}
    </div>
  )
}
