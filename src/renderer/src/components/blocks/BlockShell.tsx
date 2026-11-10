import type { BookPageRef } from '../../../../shared/course-schema'

/** 课件块外壳：块型标签 + 来源徽标（教材页码 / AI 补充）。 */
export function BlockShell({
  children,
  label,
  origin,
  source
}: {
  children: React.ReactNode
  label: string
  origin?: string
  source?: BookPageRef | null
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-track px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-tx2">{label}</span>
        {origin === 'book' && (
          <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok">
            教材{source?.bookPage != null ? ` · p.${source.bookPage}` : source?.pdfPage != null ? ` · PDF p.${source.pdfPage}` : ''}
          </span>
        )}
        {origin === 'ai-supplement' && <span className="rounded bg-track px-1.5 py-0.5 text-[10px] text-tx2">AI 补充</span>}
      </div>
      {children}
    </section>
  )
}
