import { describe, it, expect } from 'vitest'
import { isStalled, STALL_THRESHOLD_MS, STALL_THRESHOLD_TOOL_MS } from './stallWatch'

describe('isStalled — sem ferramenta em voo (limiar curto)', () => {
  it('atividade recente: não travado', () => {
    expect(isStalled(1000, 900, false)).toBe(false)
  })

  it('exatamente no limiar: ainda não travado (usa ">")', () => {
    expect(isStalled(STALL_THRESHOLD_MS, 0, false)).toBe(false)
  })

  it('passou do limiar sem ferramenta: travado', () => {
    expect(isStalled(STALL_THRESHOLD_MS + 1, 0, false)).toBe(true)
  })
})

describe('isStalled — COM ferramenta em voo (limiar longo, builds/downloads demoram)', () => {
  it('passou do limiar CURTO mas com ferramenta em voo: ainda NÃO travado', () => {
    expect(isStalled(STALL_THRESHOLD_MS + 1, 0, true)).toBe(false)
  })

  it('passou do limiar longo mesmo com ferramenta em voo: travado', () => {
    expect(isStalled(STALL_THRESHOLD_TOOL_MS + 1, 0, true)).toBe(true)
  })

  it('exatamente no limiar longo: ainda não travado', () => {
    expect(isStalled(STALL_THRESHOLD_TOOL_MS, 0, true)).toBe(false)
  })
})
