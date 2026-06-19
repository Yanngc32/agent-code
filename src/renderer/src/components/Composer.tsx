import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { PickedElement } from '@shared/ipc'

const MAX_LINES = 8

/** A project the user can reference (its folder path), shown in the @ menu. */
export interface RefProject {
  path: string
  name: string
}

interface Props {
  disabled: boolean
  busy: boolean
  chips: PickedElement[]
  onRemoveChip: (i: number) => void
  onSend: (text: string) => void
  onInterrupt: () => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  /** Projects from history, offered in the @ reference menu. */
  projects: RefProject[]
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || p
}

export function Composer(props: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const refMenu = useRef<HTMLDivElement>(null)

  // Auto-grow the textarea up to MAX_LINES, then scroll.
  useEffect(() => {
    const ta = props.textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 21
    const max = lh * MAX_LINES
    const next = Math.min(ta.scrollHeight, max)
    ta.style.height = `${next}px`
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, props.textareaRef])

  // Close the @ menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (refMenu.current && !refMenu.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onEsc = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

  const submit = (): void => {
    if (props.disabled) return
    if (!value.trim() && props.chips.length === 0) return
    props.onSend(value)
    setValue('')
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  // Insert an `@<path>` mention at the caret. The agent resolves it with its
  // native Read/Glob/LS tools — we don't read the file ourselves.
  const insertRef = (path: string): void => {
    const mention = `@${path} `
    const ta = props.textareaRef.current
    if (!ta) {
      setValue((v) => v + mention)
      return
    }
    const start = ta.selectionStart ?? value.length
    const end = ta.selectionEnd ?? value.length
    const next = value.slice(0, start) + mention + value.slice(end)
    setValue(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + mention.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const pickFile = async (): Promise<void> => {
    setMenuOpen(false)
    const p = await window.api.pickFile()
    if (p) insertRef(p)
  }

  const pickFolder = async (): Promise<void> => {
    setMenuOpen(false)
    const p = await window.api.pickDirectory()
    if (p) insertRef(p)
  }

  return (
    <div className="composer">
      {props.chips.length > 0 && (
        <div className="chips">
          {props.chips.map((c, i) => (
            <span className="chip" key={i} title={c.selector}>
              <span className="chip-tag">{c.tagName}</span>
              {c.id ? `#${c.id}` : c.text.slice(0, 24) || c.selector.slice(0, 24)}
              <button className="chip-x" onClick={() => props.onRemoveChip(i)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <div className="ref-wrap" ref={refMenu}>
          <button
            className={`ref-btn ${menuOpen ? 'active' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            disabled={props.disabled}
            title="Referenciar arquivo, pasta ou projeto"
          >
            @
          </button>
          {menuOpen && (
            <div className="ref-menu">
              <button className="ref-item" onClick={pickFile}>
                📄 Arquivo…
              </button>
              <button className="ref-item" onClick={pickFolder}>
                📁 Pasta…
              </button>
              {props.projects.length > 0 && (
                <>
                  <div className="ref-sep">Projetos do histórico</div>
                  {props.projects.map((p) => (
                    <button
                      key={p.path}
                      className="ref-item project"
                      onClick={() => {
                        setMenuOpen(false)
                        insertRef(p.path)
                      }}
                      title={p.path}
                    >
                      📦 {p.name}
                      <span className="ref-path">{p.path}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        <textarea
          ref={props.textareaRef}
          className="composer-input"
          placeholder={props.disabled ? 'Start a session first…' : 'Message Claude…  (Enter to send, Shift+Enter for newline)'}
          value={value}
          disabled={props.disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          rows={1}
        />
        {props.busy ? (
          <button className="btn stop" onClick={props.onInterrupt} title="Stop">
            ■
          </button>
        ) : (
          <button className="btn send" onClick={submit} disabled={props.disabled} title="Send">
            ↑
          </button>
        )}
      </div>
    </div>
  )
}
