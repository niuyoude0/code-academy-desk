import { CheckCircle2, AlertCircle, Info } from 'lucide-react'

export type ToastKind = 'ok' | 'bad' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

/** JetBrains 风格的右下角通知条。 */
export function ToastStack({ toasts }: { toasts: ToastItem[] }): React.JSX.Element {
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-[13px] shadow-lg"
        >
          {t.kind === 'ok' && <CheckCircle2 size={15} className="text-ok" />}
          {t.kind === 'bad' && <AlertCircle size={15} className="text-bad" />}
          {t.kind === 'info' && <Info size={15} className="text-acc" />}
          <span className="text-tx">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
