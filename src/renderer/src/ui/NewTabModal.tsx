import { useEffect } from 'react'
import { TAB_KINDS, type TabKind } from '@shared/ipc'
import { TabIcon } from '../components/TabIcon'

interface Props {
  /** Called with the chosen kind (only implemented kinds are clickable). */
  onPick: (kind: TabKind) => void
  onClose: () => void
}

const DESCRIPTIONS: Record<TabKind, string> = {
  web: 'Abre uma página web no navegador embutido.',
  android: 'Sobe um dispositivo/emulador Android e transmite a tela.',
  stitch: 'Aberta automaticamente quando o agente gera um design no Stitch.',
  iphone: 'Preview de iPhone — em breve.'
}

// Stitch tabs are created by the agent (they carry generated HTML), so they are
// never offered as a manual "new tab" option.
const MANUAL_KINDS = (Object.keys(TAB_KINDS) as TabKind[]).filter((k) => k !== 'stitch')

/** Centered modal to choose what kind of preview tab to open. Rendered at the app
 *  root so it is never clipped by the tab strip (which scrolls horizontally). */
export function NewTabModal({ onPick, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card newtab-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Nova aba de preview</h3>
        <p className="modal-message">Escolha o tipo de preview que deseja abrir.</p>
        <div className="newtab-options">
          {MANUAL_KINDS.map((k) => {
            const meta = TAB_KINDS[k]
            return (
              <button
                key={k}
                className="newtab-option"
                disabled={!meta.implemented}
                onClick={() => meta.implemented && onPick(k)}
              >
                <span className="newtab-option-ico">
                  <TabIcon kind={k} size={22} />
                </span>
                <span className="newtab-option-text">
                  <span className="newtab-option-title">
                    {meta.display}
                    {!meta.implemented && <span className="soon">em breve</span>}
                  </span>
                  <span className="newtab-option-desc">{DESCRIPTIONS[k]}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
