import type { BookPageRef } from '../../../../shared/course-schema'

/**
 * 课件块外壳（2026-11-11 用户拍板：弃卡片式，改文档流）。
 *  - read（默认，学习页）：白底文档流——无边框无底色，块型标签不渲染；
 *    教材块的页码变成左侧页边小字（Tufte 式页边注），AI 补充不标注
 *  - review（校对页）：保留轻容器 + 块型标签行，便于逐块定位与页码抽查
 */
export function BlockShell({
  children,
  label,
  origin,
  source,
  chrome = 'read'
}: {
  children: React.ReactNode
  label: string
  origin?: string
  source?: BookPageRef | null
  chrome?: 'read' | 'review'
}): React.JSX.Element {
  if (chrome === 'review') {
    return (
      <section className="rounded-md border border-line/80 bg-white px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-track/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-tx2">{label}</span>
          {origin === 'book' && (
            <span className="text-[10.5px] font-medium text-ok">
              教材{source?.bookPage != null ? ` · p.${source.bookPage}` : source?.pdfPage != null ? ` · PDF p.${source.pdfPage}` : ''}
            </span>
          )}
          {origin === 'ai-supplement' && <span className="text-[10.5px] text-tx2/70">AI 补充</span>}
        </div>
        {children}
      </section>
    )
  }
  return (
    <section className="relative">
      {children}
      {origin === 'book' && (source?.bookPage != null || source?.pdfPage != null) && (
        <span
          title={source?.bookPage != null ? `书内页码 p.${source.bookPage}` : `PDF p.${source?.pdfPage}`}
          className="pointer-events-none absolute -left-11 top-1 hidden select-none font-mono text-[10.5px] text-tx2/40 xl:block"
        >
          {source?.bookPage != null ? `p.${source.bookPage}` : `pdf ${source?.pdfPage}`}
        </span>
      )}
    </section>
  )
}
