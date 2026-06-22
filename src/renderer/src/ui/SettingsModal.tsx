import { useEffect, useState } from 'react'
import { DEFAULT_CONFIG, type AppConfig } from '@shared/ipc'
import { useUI } from './UiProvider'

interface Props {
  onClose: () => void
}

/**
 * App settings. Currently the optional Google Stitch integration: enable it and
 * paste an API key (Stitch → Settings → API Keys) to give the agent the Stitch
 * MCP tools for generating UI mockups. Changes apply to sessions started after
 * saving (reconnect a conversation to pick them up).
 */
export function SettingsModal({ onClose }: Props): JSX.Element {
  const { notify } = useUI()
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG)
  const [showKey, setShowKey] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void window.api.getConfig().then((c) => {
      setCfg(c)
      setLoaded(true)
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (): Promise<void> => {
    const next: AppConfig = {
      ...cfg,
      stitch: { ...cfg.stitch, apiKey: cfg.stitch.apiKey.trim() }
    }
    // Enabling without a key is pointless — warn but still save the preference.
    if (next.stitch.enabled && !next.stitch.apiKey) {
      notify('aviso', 'Informe a API key do Stitch para habilitar a integração.')
    }
    await window.api.setConfig(next)
    notify('sucesso', 'Configurações salvas. Reconecte a conversa para aplicar.')
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card settings-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">⚙️ Configurações</h3>

        <section className="settings-section">
          <div className="settings-row">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={cfg.stitch.enabled}
                disabled={!loaded}
                onChange={(e) => setCfg((c) => ({ ...c, stitch: { ...c.stitch, enabled: e.target.checked } }))}
              />
              <span>
                <strong>✨ Google Stitch</strong>
                <span className="settings-desc">
                  Gera mockups de UI por IA. Quando ativo, o agente pode criar um design, exibi-lo no
                  preview e implementá-lo no projeto após sua aprovação.
                </span>
              </span>
            </label>
          </div>

          <label className="settings-field">
            <span className="settings-field-label">API key do Stitch</span>
            <div className="settings-key-row">
              <input
                className="settings-input"
                type={showKey ? 'text' : 'password'}
                value={cfg.stitch.apiKey}
                placeholder="Cole a key de Stitch → Settings → API Keys"
                autoComplete="off"
                spellCheck={false}
                disabled={!loaded}
                onChange={(e) => setCfg((c) => ({ ...c, stitch: { ...c.stitch, apiKey: e.target.value } }))}
              />
              <button className="btn ghost" type="button" onClick={() => setShowKey((v) => !v)} title="Mostrar/ocultar">
                {showKey ? '🙈' : '👁️'}
              </button>
            </div>
            <span className="settings-hint">
              Gere em stitch.withgoogle.com → ícone de perfil → Stitch Settings → API Keys → Create Key.
              A chave fica salva só no seu computador.
            </span>
          </label>
        </section>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={save} disabled={!loaded}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
