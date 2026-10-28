export interface Toast {
  id: number
  kind: 'error' | 'info'
  text: string
  action?: { label: string; run: () => void }
}

interface Props {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function Toasts({ toasts, onDismiss }: Props): JSX.Element {
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span className="toast__text">{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.action?.run()
                onDismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
