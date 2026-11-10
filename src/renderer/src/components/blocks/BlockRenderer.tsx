import { AlertTriangle, Info, XCircle } from 'lucide-react'
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
 */
export function BlockRenderer({
  block,
  courseId,
  onAskAgent,
  onCodingPassed
}: {
  block: LessonBlock
  courseId: string
  onAskAgent?: (prompt: string) => void
  /** 编程题判定通过（仅学习页传；校对页可试跑不上抛） */
  onCodingPassed?: () => void
}): React.JSX.Element {
  // interactive 块的 source 字段是 TSX 组件源码（非页码引用），排除后其余块的 source 才是 BookPageRef
  const src = block.type === 'interactive' ? null : (block.source ?? null)
  switch (block.type) {
    case 'text':
      return (
        <BlockShell label="text" origin={block.origin} source={src}>
          <Md text={block.md} />
        </BlockShell>
      )
    case 'concept':
      return (
        <BlockShell label="concept" origin={block.origin} source={src}>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {/* 标题字段 schema 为纯文本，但 AI 常写入 LaTeX——用行内 md 宽容渲染（下同） */}
            <span className="text-[14.5px] font-semibold text-tx">
              <MdInline text={block.title} />
            </span>
            {(block.tags ?? []).map((t) => (
              <span key={t} className="rounded bg-track px-1.5 py-0.5 text-[10.5px] text-tx2">
                {t}
              </span>
            ))}
          </div>
          <Md text={block.md} />
        </BlockShell>
      )
    case 'definition':
      return (
        <BlockShell label="definition" origin={block.origin} source={src}>
          <div className="mb-1 text-[13.5px] font-semibold text-acc">
            【定义】<MdInline text={block.term} />
          </div>
          <Md text={block.md} />
        </BlockShell>
      )
    case 'theorem':
      return (
        <BlockShell label="theorem" origin={block.origin} source={src}>
          {block.name != null && (
            <div className="mb-1 text-[13.5px] font-semibold text-acc">
              【<MdInline text={block.name} />】
            </div>
          )}
          <Md text={block.md} />
          {block.proof != null && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12.5px] text-acc">展开证明</summary>
              <div className="mt-1.5 border-l-2 border-line pl-3">
                <Md text={block.proof} />
              </div>
            </details>
          )}
        </BlockShell>
      )
    case 'math':
      return (
        <BlockShell label="math" origin={block.origin} source={src}>
          <Katex latex={block.latex} block={block.block !== false} className="rounded-md bg-bg px-3" />
        </BlockShell>
      )
    case 'callout': {
      const conf = { note: { icon: Info, cls: 'text-acc border-acc/40 bg-acc/10' }, warning: { icon: AlertTriangle, cls: 'text-warn border-warn/40 bg-warn/10' }, pitfall: { icon: XCircle, cls: 'text-bad border-bad/40 bg-bad/10' } }[block.kind]
      const Icon = conf.icon
      return (
        <BlockShell label={`callout · ${block.kind}`} origin={block.origin} source={src}>
          <div className={`rounded-md border px-3 py-2 ${conf.cls}`}>
            <div className="flex items-start gap-2">
              <Icon size={15} className="mt-0.5 shrink-0" />
              <Md text={block.md} />
            </div>
          </div>
        </BlockShell>
      )
    }
    case 'quote':
      return (
        <BlockShell label="quote" origin={block.origin} source={src}>
          <blockquote className="border-l-[3px] border-acc/60 pl-3 text-[13px] italic text-tx2">
            <Md text={block.md} />
            {block.attribution != null && (
              <footer className="mt-1 text-right text-[12px] not-italic text-tx2/80">—— {block.attribution}</footer>
            )}
          </blockquote>
        </BlockShell>
      )
    case 'keypoint':
      return (
        <BlockShell label="keypoint" origin={block.origin} source={src}>
          <div className="rounded-md border border-acc/40 bg-acc/10 px-3 py-2">
            <div className="text-[13px] font-medium text-tx">
              <Md text={block.front} />
            </div>
            <div className="mt-1.5 border-t border-acc/20 pt-1.5 text-[13px] text-tx2">
              <Md text={block.back} />
            </div>
          </div>
        </BlockShell>
      )
    case 'thinking':
      return (
        <BlockShell label="thinking" origin={block.origin} source={src}>
          <Md text={block.md} />
          {block.hint != null && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-acc">看提示</summary>
              <div className="mt-1.5 text-[12.5px] text-tx2">
                <Md text={block.hint} />
              </div>
            </details>
          )}
        </BlockShell>
      )
    case 'example':
      return (
        <BlockShell label="example" origin={block.origin} source={src}>
          <div className="mb-1.5 text-[13.5px] font-medium text-tx">
            <MdInline text={block.title} />
          </div>
          <ol className="flex flex-col gap-1.5">
            {block.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-tx">
                <span className="font-mono text-[11px] text-tx2">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  <Md text={s.md} />
                </span>
              </li>
            ))}
          </ol>
        </BlockShell>
      )
    case 'compare':
      return (
        <BlockShell label="compare" origin={block.origin} source={src}>
          {block.title !== '' && (
            <div className="mb-1.5 text-[13px] font-medium text-tx">
              <MdInline text={block.title} />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {block.columns.map((c, i) => (
                    <th key={i} className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-medium text-tx2">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r, i) => (
                  <tr key={i}>
                    {r.cells.map((cell, j) => (
                      <td key={j} className="border-b border-line/60 px-2 py-1.5 align-top text-tx [&_.md-view_p]:m-0">
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
        <BlockShell label="table" origin={block.origin} source={src}>
          {block.caption != null && <div className="mb-1 text-[12.5px] text-tx2">{block.caption}</div>}
          <Md text={block.md} />
        </BlockShell>
      )
    case 'timeline':
      return (
        <BlockShell label="timeline" origin={block.origin} source={src}>
          <div className="relative flex flex-col gap-2.5 pl-4">
            <div className="absolute bottom-1 left-[5px] top-1 w-px bg-line" />
            {block.items.map((it, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-4 top-1.5 h-[9px] w-[9px] rounded-full border-2 border-acc bg-panel" />
                <div className="text-[12.5px] font-medium text-acc">{it.label}</div>
                <Md text={it.md} className="mt-0.5" />
              </div>
            ))}
          </div>
        </BlockShell>
      )
    case 'formula-list':
      return (
        <BlockShell label="formula-list" origin={block.origin} source={src}>
          <div className="flex flex-col gap-1.5">
            {block.items.map((it, i) => (
              <div key={i} className="rounded-md bg-bg px-3 py-1.5">
                <span className="text-[12.5px] font-medium text-tx">{it.name}</span>
                <Katex latex={it.latex} className="ml-2 align-middle text-[13px]" />
                {it.note != null && (
                  <div className="mt-0.5 text-[12px] text-tx2/80">
                    <MdInline text={it.note} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </BlockShell>
      )
    case 'image':
      return (
        <BlockShell label="image" origin={block.origin} source={src}>
          <ImageView courseId={courseId} path={block.path} alt={block.alt} />
        </BlockShell>
      )
    case 'summary':
      return (
        <BlockShell label="summary" origin={block.origin} source={src}>
          <ul className="flex flex-col gap-1">
            {block.points.map((p, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-tx [&_.md-view]:min-w-0">
                <span className="text-acc">·</span>
                <span className="min-w-0 flex-1">
                  <Md text={p} />
                </span>
              </li>
            ))}
          </ul>
          {block.links != null && block.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {block.links.map((l) => (
                <span key={l} className="rounded bg-track px-1.5 py-0.5 font-mono text-[10.5px] text-tx2">
                  ↩ {l}
                </span>
              ))}
            </div>
          )}
        </BlockShell>
      )
    case 'code':
      return (
        <BlockShell label={`code · ${block.language}`} origin={block.origin} source={src}>
          <CodeView code={block.code} language={block.language} />
          {block.runnable === true && (
            <div className="mt-1.5 text-[11px] text-tx2/80">可提交执行（编程题 Runner 于 P5.8 接入）</div>
          )}
        </BlockShell>
      )
    case 'diagram':
      return (
        <BlockShell label="diagram · mermaid" origin={block.origin} source={src}>
          <MermaidView code={block.mermaid} blockId={block.id} />
        </BlockShell>
      )
    case 'chart':
      return (
        <BlockShell label="chart" origin={block.origin} source={src}>
          <ChartView option={block.echartsOption} />
        </BlockShell>
      )
    case 'anim':
      return (
        <BlockShell label={`anim · ${block.template}`} origin={block.origin} source={src}>
          {block.title != null && block.title !== '' && (
            <div className="mb-1.5 text-[13px] font-medium text-tx">{block.title}</div>
          )}
          <AnimView block={block} />
        </BlockShell>
      )
    case 'interactive':
      return (
        <BlockShell label="interactive" origin={block.origin} source={src}>
          <div className="mb-2 text-[13px] font-medium text-tx">{block.title}</div>
          <InteractiveBlockView block={block} courseId={courseId} onAskAgent={onAskAgent} />
        </BlockShell>
      )
    case 'coding':
      return <CodingBlockView block={block} courseId={courseId} onPassed={onCodingPassed} onAskAgent={onAskAgent} />
    default:
      // 未知块型兜底（前向兼容旧课程包）
      return (
        <BlockShell label={(block as { type: string }).type} origin={(block as { origin?: string }).origin} source={src}>
          <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
            未知块型，渲染器版本较旧？请更新应用。
          </div>
        </BlockShell>
      )
  }
}
