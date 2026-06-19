import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

export type ToastType = 'sucesso' | 'erro' | 'aviso'

interface Toast {
  id: string
  tipo: ToastType
  msg: string
}

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Render the confirm button in destructive (red) style. */
  danger?: boolean
}

interface UiContextValue {
  /** Show a transient toast (top-right, auto-dismiss ~4.5s). */
  notify: (tipo: ToastType, msg: string) => void
  /** Open a styled confirmation modal; resolves true on confirm, false otherwise. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const UiContext = createContext<UiContextValue | null>(null)

export function useUI(): UiContextValue {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('useUI deve ser usado dentro de <UiProvider>')
  return ctx
}

let toastSeq = 0
const TOAST_MS = 4500
const ICONS: Record<ToastType, string> = { sucesso: '✓', erro: '✕', aviso: '!' }

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: string) => void }): JSX.Element {
  const [leaving, setLeaving] = useState(false)
  const closing = useRef(false)

  const startClose = useCallback(() => {
    if (closing.current) return
    closing.current = true
    setLeaving(true)
    setTimeout(() => onClose(toast.id), 280)
  }, [onClose, toast.id])

  useEffect(() => {
    const t = setTimeout(startClose, TOAST_MS)
    return () => clearTimeout(t)
  }, [startClose])

  return (
    <div className={`toast ${toast.tipo} ${leaving ? 'leaving' : ''}`} role="status" onClick={startClose}>
      <span className="toast-ico">{ICONS[toast.tipo]}</span>
      <span className="toast-msg">{toast.msg}</span>
      <button
        className="toast-x"
        aria-label="Fechar"
        onClick={(e) => {
          e.stopPropagation()
          startClose()
        }}
      >
        ×
      </button>
    </div>
  )
}

function ConfirmDialog({
  opts,
  onResolve
}: {
  opts: ConfirmOptions
  onResolve: (v: boolean) => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onResolve(false)
      else if (e.key === 'Enter') onResolve(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResolve])

  return (
    <div className="modal-overlay" onClick={() => onResolve(false)}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {opts.title && <h3 className="modal-title">{opts.title}</h3>}
        <p className="modal-message">{opts.message}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => onResolve(false)}>
            {opts.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            className={`btn ${opts.danger ? 'danger-btn' : 'primary'}`}
            autoFocus
            onClick={() => onResolve(true)}
          >
            {opts.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<{
    opts: ConfirmOptions
    resolve: (v: boolean) => void
  } | null>(null)

  const removeToast = useCallback((id: string): void => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback((tipo: ToastType, msg: string): void => {
    const id = `t${Date.now().toString(36)}-${toastSeq++}`
    setToasts((list) => [...list, { id, tipo, msg }])
  }, [])

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => setConfirmState({ opts, resolve })),
    []
  )

  const resolveConfirm = useCallback((value: boolean): void => {
    setConfirmState((s) => {
      s?.resolve(value)
      return null
    })
  }, [])

  const value = useMemo<UiContextValue>(() => ({ notify, confirm }), [notify, confirm])

  return (
    <UiContext.Provider value={value}>
      {children}
      <div className="toast-wrap" role="region" aria-live="polite" aria-label="Notificações">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={removeToast} />
        ))}
      </div>
      {confirmState && <ConfirmDialog opts={confirmState.opts} onResolve={resolveConfirm} />}
    </UiContext.Provider>
  )
}
