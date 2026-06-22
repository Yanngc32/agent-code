import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { RemoteInfo } from '@shared/ipc'
import { useUI } from './UiProvider'

interface Props {
  onClose: () => void
}

const EMPTY: RemoteInfo = { running: false, url: '', ip: '', port: 0, token: '', clients: 0 }

/**
 * Modal that runs the LAN bridge so a phone can drive the sessions. Shows a QR
 * (scan → download/open the remote app), the connection info, how many phones
 * are connected, and a button to build the Android APK.
 */
export function RemoteModal({ onClose }: Props): JSX.Element {
  const { notify } = useUI()
  const [info, setInfo] = useState<RemoteInfo>(EMPTY)
  const [qr, setQr] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildLog, setBuildLog] = useState<string[]>([])
  const logRef = useRef<HTMLPreElement>(null)

  // Sync current status on open, and keep the connected-phone count live.
  useEffect(() => {
    void window.api.remoteStatus().then(setInfo)
    const off = window.api.onRemoteClients(setInfo)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Render the QR whenever the URL changes (empty when stopped).
  useEffect(() => {
    if (!info.url) {
      setQr('')
      return
    }
    void QRCode.toDataURL(info.url, { width: 240, margin: 1, color: { dark: '#1a1917', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [info.url])

  // Stream APK build progress.
  useEffect(() => {
    const off = window.api.onRemoteBuildProgress((m) => {
      setBuildLog((l) => [...l.slice(-300), m.line])
      if (m.done) {
        setBuilding(false)
        notify(m.ok ? 'sucesso' : 'erro', m.line)
      }
    })
    return off
  }, [notify])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [buildLog])

  const toggle = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const next = info.running ? await window.api.remoteStop() : await window.api.remoteStart()
      setInfo(next)
      if (!info.running && !next.ip) {
        notify('aviso', 'Nenhuma rede local detectada. Conecte o PC a uma rede Wi‑Fi/Ethernet.')
      } else if (!info.running) {
        notify('sucesso', `Ponte ligada em ${next.ip}:${next.port}.`)
      }
    } catch (e) {
      notify('erro', `Falha: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [info.running, notify])

  const build = useCallback(async (): Promise<void> => {
    setBuilding(true)
    setBuildLog(['Iniciando build do APK…'])
    try {
      await window.api.buildRemoteApk()
    } catch (e) {
      notify('erro', `Falha no build: ${String(e)}`)
      setBuilding(false)
    }
  }, [notify])

  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text)
    notify('sucesso', 'Copiado.')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card remote-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">📱 Controle remoto (Android)</h3>
        <p className="modal-message">
          Ligue a ponte e escaneie o QR com o celular (mesma rede Wi‑Fi) para baixar o app e
          enviar comandos ao Claude Code do seu PC.
        </p>

        <div className="remote-body">
          <div className="remote-qr">
            {info.running && qr ? (
              <img src={qr} alt="QR de conexão" width={220} height={220} />
            ) : (
              <div className="remote-qr-empty">{info.running ? 'Gerando QR…' : 'Ponte desligada'}</div>
            )}
          </div>

          <div className="remote-info">
            <div className={`remote-status ${info.running ? 'on' : 'off'}`}>
              ● {info.running ? 'Ligada' : 'Desligada'}
              {info.running && <span className="remote-clients">{info.clients} conectado(s)</span>}
            </div>
            {info.running && (
              <>
                <label className="remote-field">
                  <span>Endereço</span>
                  <code onClick={() => copy(`${info.ip}:${info.port}`)}>{info.ip}:{info.port}</code>
                </label>
                <label className="remote-field">
                  <span>Token</span>
                  <code onClick={() => copy(info.token)}>{info.token}</code>
                </label>
                <label className="remote-field">
                  <span>URL</span>
                  <code className="remote-url" onClick={() => copy(info.url)}>{info.url}</code>
                </label>
                <p className="remote-hint">
                  Sem o app ainda? Abra <code>{info.ip}:{info.port}</code> no navegador do celular.
                </p>
              </>
            )}
          </div>
        </div>

        {building || buildLog.length > 0 ? (
          <pre className="remote-buildlog" ref={logRef}>
            {buildLog.join('\n')}
          </pre>
        ) : null}

        <div className="modal-actions remote-actions">
          <button className="btn ghost" onClick={onClose}>
            Fechar
          </button>
          <button className="btn" onClick={build} disabled={building}>
            {building ? 'Gerando APK…' : '🔨 Gerar APK'}
          </button>
          <button className={`btn ${info.running ? 'danger-btn' : 'primary'}`} onClick={toggle} disabled={busy}>
            {info.running ? 'Desligar' : 'Ligar ponte'}
          </button>
        </div>
      </div>
    </div>
  )
}
