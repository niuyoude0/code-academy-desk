import { AlertTriangle, Info, XCircle, Lightbulb } from 'lucide-react'
import type { LessonBlock } from '../../../../shared/lesson-schema'
import { BlockShell } from './BlockShell'
import { Md, MdInline } from './Md'
import { Katex } from './Katex'
import { CodeView } from './CodeView'
import { MermaidView } from './MermaidView'
import { ChartView } from './ChartView'
import { AnimView } from './AnimView'
import { ImageView } from './ImageView'
import { InteractiveBlockView } from './InteractiveBlockView'
import { CodingBlockView } from './CodingBlockView'

/**
 * P5.5 课件块渲染器：22 类块统一分派（A 层管线：react-markdown/KaTeX/shiki/mermaid/echarts/motion）。
 * quiz 交互卡由学习页直接走 QuizCard（需要答案状态），其余块全部经本组件。
 * P5.6：interactive 块接沙箱 iframe（受限 Renderer + 白名单桥）。
 * P5.8：coding 块接 Runner 本地执行 + 测试判定（onCodingPassed 上抛编程通过）。
 * 2026-11-11 视觉重做：chrome='read'（学习页，文档流白底）/'review'（校对页，轻容器）。
 * 2026-11-11 排版升级：块型专属色条（定义蓝/定理紫/例题绿/警示橙红）、衬线术语名、
 *   例题圆形步标、标签放大加粗、留白加大——多字体/多颜色/多字号层级。
 */
export function BlockRenderer({
  block,
  courseId,
  onAskAgent,
  onCodingPassed,
  chrome = 'read'
}: {
  block: LessonBlock
  courseId: string
  onAskAgent?: (prompt: string) => void
  /** 编程题判定通过（仅学习页传；校对页可试跑不上抛） */
  onCodingPassed?: () => void
  chrome?: 'read' | 'review'
}): React.JSX.Element {
  // interactive 块的 source 字段是 TSX 组件源码（非页码引用），排除后其余块的 source 才是 BookPageRef
  const src = block.type === 'interactive' ? null : (block.source ?? null)
  switch (block.type) {
    case 'text':
      return (
        <BlockShell label="text" origin={block.origin} source={src} chrome={chrome}>
          <Md text={block.md} />
        </BlockShell>
      )
    case 'concept':
      return (
        <BlockShell label="concept" origin={block.origin} source={src} chrome={chrome}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* 标题字段 schema 为纯文本，但 AI 常写入 LaTeX——用行内 md 宽容渲染（下同） */}
            <h3 className="text-[18px] font-bold leading-snug tracking-tight text-tx">
              <MdInline text={block.title} />
            </h3>
            {(block.tags ?? []).length > 0 && (
              <span className="text-[12px] text-tx2/70">
                {(block.tags ?? []).join(' · ')}
              </span>
            )}
          </div>
          <Md text={block.md} />
        </BlockShell>
      )
    case 'definition':
      return (
        <BlockShell label="definition" origin={block.origin} source={src} chrome={chrome}>
          <div className="border-l-[3px] border-acc pl-4">
            <div className="mb-1 flex items-baseline gap-3">
              <span className="text-[12.5px] font-bold uppercase tracking-[0.14em] text-acc">定义</span>
              <span className="font-serif text-[16.5px] font-semibold text-tx">
                <MdInline text={block.term} />
              </span>
            </div>
            <Md text={block.md} />
          </div>
        </BlockShell>
      )
    case 'theorem':
      return (
        <BlockShell label="theorem" origin={block.origin} source={src} chrome={chrome}>
          <div className="border-l-[3px] border-thm pl-4">
            {block.name != null && (
              <div className="mb-1 font-serif text-[15.5px] font-semibold text-thm">
                <MdInline text={block.name} />
              </div>
            )}
            <Md text={block.md} />
            {block.proof != null && (
              <details className="mt-2.5">
                <summary className="cursor-pointer text-[13px] font-medium text-thm">展开证明</summary>
                <div className="mt-2 border-l-2 border-thm/30 bg-thm/[0.04] py-1 pl-3.5">
                  <Md text={block.proof} />
                </div>
              </details>
            )}
          </div>
        </BlockShell>
      )
    case 'math':
      return (
        <BlockShell label="math" origin={block.origin} source={src} chrome={chrome}>
          <Katex latex={block.latex} block={block.block !== false} className="text-center text-[15px]" />
        </BlockShell>
      )
    case 'callout': {
      const conf = {
        note: { icon: Info, bar: 'border-acc', tint: 'bg-acc/8', fg: 'text-acc' },
        warning: { icon: AlertTriangle, bar: 'border-warn', tint: 'bg-warn/10', fg: 'text-warn' },
        pitfall: { icon: XCircle, bar: 'border-bad', tint: 'bg-bad/8', fg: 'text-bad' }
      }[block.kind]
      const Icon = conf.icon
      return (
        <BlockShell label={`callout · ${block.kind}`} origin={block.origin} source={src} chrome={chrome}>
          <div className={`rounded-r-md border-l-4 ${conf.bar} ${conf.tint} px-4 py-3`}>
            <div className="flex items-start gap-2.5">
              <Icon size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <Md text={block.md} />
              </div>
            </div>
          </div>
        </BlockShell>
      )
    }
    case 'quote':
      return (
        <BlockShell label="quote" origin={block.origin} source={src} chrome={chrome}>
          <blockquote className="relative border-l-[3px] border-acc/40 pl-5 font-serif text-[15px] italic leading-loose text-tx2">
            <span className="absolute -left-0.5 -top-1 select-none font-serif text-[26px] not-italic leading-none text-acc/30">“</span>
            <Md text={block.md} />
            {block.attribution != null && (
              <footer className="mt-1.5 text-right text-[12.5px] not-italic text-tx2/70">—— {block.attribution}</footer>
            )}
          </blockquote>
        </BlockShell>
      )
    case 'keypoint':
      return (
        <BlockShell label="keypoint" origin={block.origin} source={src} chrome={chrome}>
          <div className="rounded-lg bg-acc/8 px-5 py-4">
            <div className="text-[15px] font-semibold leading-relaxed text-tx">
              <Md text={block.front} />
            </div>
            <div className="mt-2.5 border-t border-acc/15 pt-2.5 text-[14.5px] leading-relaxed text-tx2">
              <Md text={block.back} />
            </div>
          </div>
        </BlockShell>
      )
    case 'thinking':
      return (
        <BlockShell label="thinking" origin={block.origin} source={src} chrome={chrome}>
          <div className="border-l-[3px] border-ins pl-4">
            <div className="mb-1 flex items-center gap-1.5">
              <Lightbulb size={15} className="text-ins" />
              <span className="text-[12.5px] font-bold uppercase tracking-[0.14em] text-ins">想一想</span>
            </div>
            <Md text={block.md} />
            {block.hint != null && (
              <details className="mt-2.5">
                <summary className="cursor-pointer text-[13px] font-medium text-ins">看提示</summary>
                <div className="mt-1.5 text-[13.5px] text-tx2">
                  <Md text={block.hint} />
                </div>
              </details>
            )}
          </div>
        </BlockShell>
      )
    case 'example':
      return (
        <BlockShell label="example" origin={block.origin} source={src} chrome={chrome}>
          <div className="mb-3 text-[16px] font-semibold text-tx">
            <MdInline text={block.title} />
          </div>
          <ol className="flex flex-col gap-3">
            {block.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok/90 font-mono text-[11.5px] font-bold text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 pt-0.5">
                  <Md text={s.md} />
                </span>
              </li>
            ))}
          </ol>
        </BlockShell>
      )
    case 'compare':
      return (
        <BlockShell label="compare" origin={block.origin} source={src} chrome={chrome}>
          {block.title !== '' && (
            <div className="mb-2 text-[15px] font-semibold text-tx">
              <MdInline text={block.title} />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr>
                  {block.columns.map((c, i) => (
                    <th key={i} className="whitespace-nowrap border-b-2 border-line px-3 py-2 text-left font-semibold text-tx2">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r, i) => (
                  <tr key={i}>
                    {r.cells.map((cell, j) => (
                      <td key={j} className="border-b border-line/60 px-3 py-2.5 align-top text-tx [&_.md-view_p]:m-0">
                        <span className={j === 0 ? 'font-medium' : ''}>
                          {j === 0 ? r.label : <MdInline text={cell} />}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BlockShell>
      )
    case 'table':
      return (
        <BlockShell label="table" origin={block.origin} source={src} chrome={chrome}>
          {block.caption != null && <div className="mb-1 text-[13px] text-tx2">{block.caption}</div>}
          <Md text={block.md} />
        </BlockShell>
      )
    case 'timeline':
      return (
        <BlockShell label="timeline" origin={block.origin} source={src} chrome={chrome}>
          <div className="relative flex flex-col gap-4 pl-5">
            <div className="absolute bottom-1 left-[6px] top-1 w-px bg-line" />
            {block.items.map((it, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-5 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-acc bg-bg" />
                <div className="text-[13px] font-semibold text-acc">{it.label}</div>
                <Md text={it.md} className="mt-0.5" />
              </div>
            ))}
          </div>
        </BlockShell>
      )
    case 'formula-list':
      return (
        <BlockShell label="formula-list" origin={block.origin} source={src} chrome={chrome}>
          <div className="flex flex-col gap-2.5">
            {block.items.map((it, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[14px] font-semibold text-tx">{it.name}</span>
                <Katex latex={it.latex} className="text-[14px]" />
                {it.note != null && (
                  <span className="text-[12.5px] text-tx2/80">
                    <MdInline text={it.note} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </BlockShell>
      )
    case 'image':
      return (
        <BlockShell label="image" origin={block.origin} source={src} chrome={chrome}>
          <ImageView courseId={courseId} path={block.path} alt={block.alt} />
        </BlockShell>
      )
    case 'summary':
      return (
        <BlockShell label="summary" origin={block.origin} source={src} chrome={chrome}>
          <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-acc">小结</div>
          <ul className="flex flex-col gap-2">
            {block.points.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-[14.5px] leading-relaxed text-tx [&_.md-view]:min-w-0">
                <span className="mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full bg-acc/70" />
                <span className="min-w-0 flex-1">
                  <Md text={p} />
                </span>
              </li>
            ))}
          </ul>
          {block.links != null && block.links.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {block.links.map((l) => (
                <span key={l} className="rounded bg-track/60 px-1.5 py-0.5 font-mono text-[10.5px] text-tx2/80">
                  ↩ {l}
                </span>
              ))}
            </div>
          )}
        </BlockShell>
      )
    case 'code':
      return (
        <BlockShell label={`code · ${block.language}`} origin={block.origin} source={src} chrome={chrome}>
          <CodeView code={block.code} language={block.language} />
          {block.runnable === true && (
            <div className="mt-1.5 text-[11.5px] text-tx2/80">可提交执行（编程题 Runner 于 P5.8 接入）</div>
          )}
        </BlockShell>
      )
    case 'diagram':
      return (
        <BlockShell label="diagram · mermaid" origin={block.origin} source={src} chrome={chrome}>
          <MermaidView code={block.mermaid} blockId={block.id} />
        </BlockShell>
      )
    case 'chart':
      return (
        <BlockShell label="chart" origin={block.origin} source={src} chrome={chrome}>
          <ChartView option={block.echartsOption} />
        </BlockShell>
      )
    case 'anim':
      return (
        <BlockShell label={`anim · ${block.template}`} origin={block.origin} source={src} chrome={chrome}>
          {block.title != null && block.title !== '' && (
            <div className="mb-2 text-[15px] font-semibold text-tx">{block.title}</div>
          )}
          <AnimView block={block} />
        </BlockShell>
      )
    case 'interactive':
      return (
        <BlockShell label="interactive" origin={block.origin} source={src} chrome={chrome}>
          <div className="mb-2.5 text-[15px] font-semibold text-tx">{block.title}</div>
          <InteractiveBlockView block={block} courseId={courseId} onAskAgent={onAskAgent} />
        </BlockShell>
      )
    case 'coding':
      return (
        <CodingBlockView
          block={block}
          courseId={courseId}
          onPassed={onCodingPassed}
          onAskAgent={onAskAgent}
          chrome={chrome}
        />
      )
    default:
      // 未知块型兜底（前向兼容旧课程包）
      return (
        <BlockShell
          label={(block as { type: string }).type}
          origin={(block as { origin?: string }).origin}
          source={src}
          chrome={chrome}
        >
          <div className="rounded-md bg-warn/10 px-3 py-2 text-[12px] text-warn">
            未知块型，渲染器版本较旧？请更新应用。
          </div>
        </BlockShell>
      )
  }
}
