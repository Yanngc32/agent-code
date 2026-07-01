import { describe, it, expect, vi } from 'vitest'
import { stopRecording } from './Composer'

/** Fake MediaRecorder — captures the 'stop' listener instead of firing it, so
 *  the test controls exactly when the (real, async) event would happen. */
function fakeRecorder(state: string): {
  rec: {
    state: string
    stop: ReturnType<typeof vi.fn<() => void>>
    addEventListener: ReturnType<typeof vi.fn<(type: string, l: () => void) => void>>
    removeEventListener: ReturnType<typeof vi.fn<(type: string, l: () => void) => void>>
  }
  fireStop: () => void
} {
  let listener: (() => void) | null = null
  const rec = {
    state,
    stop: vi.fn<() => void>(),
    addEventListener: vi.fn<(type: string, l: () => void) => void>((_type, l) => {
      listener = l
    }),
    removeEventListener: vi.fn<(type: string, l: () => void) => void>(() => {
      listener = null
    })
  }
  return { rec, fireStop: () => listener?.() }
}

function fakeStream(): {
  stream: { getTracks: () => { stop: ReturnType<typeof vi.fn<() => void>> }[] }
  trackStop: ReturnType<typeof vi.fn<() => void>>
} {
  const trackStop = vi.fn<() => void>()
  return { stream: { getTracks: () => [{ stop: trackStop }] }, trackStop }
}

describe('stopRecording — não corta a última frase (ordem segura de parar)', () => {
  it('gravador ATIVO: NÃO mata o microfone antes do evento "stop" real disparar', () => {
    const { rec, fireStop } = fakeRecorder('recording')
    const { stream, trackStop } = fakeStream()
    const onDone = vi.fn()

    stopRecording(rec, stream, onDone)

    // rec.stop() foi chamado, mas o microfone e o onDone NÃO podem ter rodado
    // ainda — é exatamente essa espera que preserva a cauda do áudio.
    expect(rec.stop).toHaveBeenCalledTimes(1)
    expect(trackStop).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()

    // Só quando o evento 'stop' de verdade dispara (depois que o encoder já
    // entregou o último pedaço de áudio) é que o microfone é desligado.
    fireStop()
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('gravador INATIVO (armado, nada gravando): desliga o mic na hora', () => {
    const { stream, trackStop } = fakeStream()
    const onDone = vi.fn()
    stopRecording(null, stream, onDone)
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('rec.state === "inactive": desliga o mic na hora (nada a esperar)', () => {
    const { rec } = fakeRecorder('inactive')
    const { stream, trackStop } = fakeStream()
    const onDone = vi.fn()
    stopRecording(rec, stream, onDone)
    expect(rec.stop).not.toHaveBeenCalled()
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('rec.stop() lança (já parando): não trava — desliga o mic e limpa o listener', () => {
    const { stream, trackStop } = fakeStream()
    const onDone = vi.fn()
    const rec = {
      state: 'recording',
      stop: (): void => {
        throw new Error('já parando')
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    stopRecording(rec, stream, onDone)
    expect(rec.removeEventListener).toHaveBeenCalledTimes(1)
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('sem stream (mic nunca abriu): não quebra, só chama onDone', () => {
    const { rec, fireStop } = fakeRecorder('recording')
    const onDone = vi.fn()
    stopRecording(rec, null, onDone)
    fireStop()
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
