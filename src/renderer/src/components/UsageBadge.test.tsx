import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { UsageBadge } from './UsageBadge'
import type { RateLimitStatus } from '@shared/ipc'

afterEach(cleanup)

describe('UsageBadge — uso da conta (5h/semana), separado da conversa', () => {
  it('sem nenhum evento ainda (ex.: conta por API key): não renderiza nada', () => {
    const { container } = render(<UsageBadge limits={{}} />)
    expect(container.firstChild).toBeNull()
  })

  it('mostra a sessão de 5h com % e dica de reset', () => {
    const fiveHour: RateLimitStatus = {
      rateLimitType: 'five_hour',
      status: 'allowed',
      utilization: 0.42,
      resetsAt: Date.now() + 90 * 60_000 // daqui a 90min
    }
    const { getByText, container } = render(<UsageBadge limits={{ five_hour: fiveHour }} />)
    expect(getByText('Sessão 5h')).toBeTruthy()
    expect(getByText('42%')).toBeTruthy()
    const pill = container.querySelector('.usage-pill')
    expect(pill?.getAttribute('title')).toContain('reseta em')
  })

  it('mostra vários limites juntos, na ordem esperada (5h antes de semana)', () => {
    const limits: Record<string, RateLimitStatus> = {
      seven_day: { rateLimitType: 'seven_day', status: 'allowed', utilization: 0.1 },
      five_hour: { rateLimitType: 'five_hour', status: 'allowed', utilization: 0.9 }
    }
    const { container } = render(<UsageBadge limits={limits} />)
    const caps = Array.from(container.querySelectorAll('.ctx-bar-cap')).map((el) => el.textContent)
    expect(caps).toEqual(['Sessão 5h', 'Semana'])
  })

  it('utilization alta (≥95%) ou status "rejected" fica no nível crítico (mesma linguagem visual da barra de contexto)', () => {
    const limits: Record<string, RateLimitStatus> = {
      five_hour: { rateLimitType: 'five_hour', status: 'rejected', utilization: 1 }
    }
    const { container } = render(<UsageBadge limits={limits} />)
    expect(container.querySelector('.usage-pill.crit')).toBeTruthy()
  })
})
