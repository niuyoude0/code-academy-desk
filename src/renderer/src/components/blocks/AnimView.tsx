import { Component, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import type { AnimBlock } from '../../../../shared/lesson-schema'

/**
 * anim 块（数据结构动态过程）——数据驱动帧 DSL（resources/skills/.../blocks-catalog.md）：
 *  frames[{data, pointers?, highlight?, note?}]，AI 只描述每帧数据怎么变，视觉呈现归模板。
 *  模板形状约定：array/stack/queue→items；linkedList→nodes[{val,next}]；
 *  tree→{val,children}；graph→{nodes,edges}；hashTable→buckets；matrix→rows。
 */

interface FrameProps {
  data: Record<string, unknown>
  pointers?: Record<string, number | string>
  highlight?: (number | string)[]
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const fmt = (v: unknown): string => {
  if (v == null) return '∅'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const hlMatch = (highlight: (number | string)[] | undefined, key: string): boolean =>
  highlight?.some((h) => String(h) === key) === true

const pointerNamesAt = (pointers: Record<string, number | string> | undefined, key: string): string[] =>
  Object.entries(pointers ?? {})
    .filter(([, v]) => String(v) === key)
    .map(([name]) => name)

const cellCls = (hl: boolean): string =>
  `flex min-h-[46px] flex-col items-center justify-center rounded-md border px-2 py-1 font-mono text-[13px] transition-colors ${
    hl ? 'border-acc bg-acc/15 text-tx shadow-[0_0_0_1px_rgba(53,116,240,0.4)]' : 'border-line bg-bg text-tx'
  }`

/* ===== 各模板渲染 ===== */

function ArrayTpl({ data, pointers, highlight }: FrameProps): React.JSX.Element {
  const items = asArray(data.items)
  if (items.length === 0) throw new Error('array 模板需要 data.items 非空数组')
  const n = items.length
  return (
    <div className="flex flex-col gap-1">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(3rem, 1fr))` }}>
        {items.map((v, i) => (
          <motion.div layout key={i} transition={{ duration: 0.35 }} className={cellCls(hlMatch(highlight, String(i)))}>
            {fmt(v)}
          </motion.div>
        ))}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(3rem, 1fr))` }}>
        {items.map((_, i) => {
          const names = pointerNamesAt(pointers, String(i))
          return (
            <div key={i} className="text-center font-mono text-[11px] text-warn">
              {names.length > 0 ? `▲ ${names.join(' ')}` : ''}
            </div>
          )
        })}
      </div>
      <div className="text-center text-[11px] text-tx2/70">[0] … [{n - 1}] 下标</div>
    </div>
  )
}

function StackTpl({ data, pointers, highlight }: FrameProps): React.JSX.Element {
  const items = asArray(data.items) // 约定：index 0 = 栈底
  if (items.length === 0 && Object.keys(pointers ?? {}).length === 0) {
    throw new Error('stack 模板需要 data.items 数组')
  }
  const topNames = pointerNamesAt(pointers, String(items.length - 1)).join(' ')
  return (
    <div className="flex items-end justify-center gap-3">
      <div className="flex w-44 flex-col-reverse gap-1.5">
        <AnimatePresence initial={false}>
          {items.map((v, i) => (
            <motion.div
              layout
              key={i}
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.3 }}
              className={cellCls(hlMatch(highlight, String(i)))}
            >
              {fmt(v)}
            </motion.div>
          ))}
        </AnimatePresence>
        {items.length === 0 && <div className="py-3 text-center text-[12px] text-tx2/70">（空栈）</div>}
      </div>
      <div className="pb-1 font-mono text-[11px] text-tx2">
        <div className="text-tx2/70">栈底</div>
        <div className="mt-[170px] text-warn">{items.length > 0 ? `▲ 栈顶${topNames !== '' ? ` ${topNames}` : ''}` : ''}</div>
      </div>
    </div>
  )
}

function QueueTpl({ data, pointers, highlight }: FrameProps): React.JSX.Element {
  const items = asArray(data.items) // 约定：index 0 = 队头
  if (items.length === 0) throw new Error('queue 模板需要 data.items 非空数组')
  const n = items.length
  return (
    <div className="flex flex-col gap-1">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(3rem, 1fr))` }}>
        <AnimatePresence initial={false}>
          {items.map((v, i) => (
            <motion.div
              layout
              key={i}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3 }}
              className={cellCls(hlMatch(highlight, String(i)))}
            >
              {fmt(v)}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(3rem, 1fr))` }}>
        {items.map((_, i) => {
          const names = pointerNamesAt(pointers, String(i))
          const edge = i === 0 ? '队头' : i === n - 1 ? '队尾' : ''
          return (
            <div key={i} className="text-center font-mono text-[11px]">
              <span className="text-warn">{names.length > 0 ? `▲ ${names.join(' ')}` : ''}</span>
              {edge !== '' && <span className="ml-1 text-tx2/70">{edge}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** linkedList：nodes[{val,next}]（next=节点下标或 null），从头节点走链。 */
function LinkedListTpl({ data, pointers, highlight }: FrameProps): React.JSX.Element {
  const nodesRaw = asArray(data.nodes)
  if (nodesRaw.length === 0) throw new Error('linkedList 模板需要 data.nodes 非空数组')
  const nodes = nodesRaw.map((n) => {
    const o = (n ?? {}) as { val?: unknown; next?: unknown }
    return { val: o.val, next: typeof o.next === 'number' ? o.next : null }
  })
  // 头节点 = 没被任何 next 指向的节点（多条链取第一条）
  const pointed = new Set(nodes.map((n) => n.next).filter((n): n is number => n != null))
  const seq: number[] = []
  let head = nodes.findIndex((_, i) => !pointed.has(i))
  let guard = 0
  while (head >= 0 && head < nodes.length && !seq.includes(head) && guard < nodes.length + 1) {
    seq.push(head)
    const nx = nodes[head]?.next
    head = nx != null ? nx : -1
    guard += 1
  }
  if (seq.length === 0) seq.push(0)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {seq.map((ni, pos) => {
        const node = nodes[ni]
        const hl = hlMatch(highlight, String(ni))
        const names = pointerNamesAt(pointers, String(ni))
        return (
          <div key={ni} className="flex items-center gap-1.5">
            {pos === 0 && <span className="font-mono text-[11px] text-tx2/70">head →</span>}
            <motion.div layout transition={{ duration: 0.3 }} className={cellCls(hl)}>
              <span>{fmt(node?.val)}</span>
              {names.length > 0 && <span className="font-mono text-[10px] text-warn">{names.join(' ')}</span>}
            </motion.div>
            <span className="font-mono text-[14px] text-tx2">→</span>
            {node?.next == null && <span className="font-mono text-[14px] text-tx2">∅</span>}
          </div>
        )
      })}
    </div>
  )
}

interface TreeNode {
  val: unknown
  children?: TreeNode[]
}
function asTreeNode(v: unknown): TreeNode {
  const o = (v ?? {}) as { val?: unknown; children?: unknown }
  if (o.children != null && !Array.isArray(o.children)) throw new Error('tree 节点 children 必须是数组')
  return {
    val: o.val,
    children: (o.children ?? []).map(asTreeNode)
  }
}
function TreeNodeView({ node, depth, highlight }: { node: TreeNode; depth: number; highlight?: (number | string)[] }): React.JSX.Element {
  const hl = hlMatch(highlight, fmt(node.val))
  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.div layout transition={{ duration: 0.3 }} className={cellCls(hl)}>
        {fmt(node.val)}
      </motion.div>
      {node.children != null && node.children.length > 0 && (
        <div className={`flex items-start gap-3 ${depth === 0 ? '' : ''}`}>
          {node.children.map((c, i) => (
            <div key={i} className="flex flex-col items-center">
              <span className="font-mono text-[12px] text-tx2/60">│</span>
              <TreeNodeView node={c} depth={depth + 1} highlight={highlight} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
function TreeTpl({ data, highlight }: FrameProps): React.JSX.Element {
  if (data.root == null) throw new Error('tree 模板需要 data.root（{val, children} 嵌套）')
  return (
    <div className="overflow-x-auto py-1">
      <TreeNodeView node={asTreeNode(data.root)} depth={0} highlight={highlight} />
    </div>
  )
}

/** graph：{nodes:[{id}],edges:[{from,to}]}——环形布局 SVG。 */
function GraphTpl({ data, pointers, highlight }: FrameProps): React.JSX.Element {
  const nodesRaw = asArray(data.nodes)
  const edgesRaw = asArray(data.edges)
  if (nodesRaw.length === 0) throw new Error('graph 模板需要 data.nodes 非空数组')
  const ids = nodesRaw.map((n, i) => {
    const o = (n ?? {}) as { id?: unknown; label?: unknown }
    return String(o.id ?? i)
  })
  const labelOf = (idOrIdx: unknown): string => {
    if (typeof idOrIdx === 'number' && idOrIdx >= 0 && idOrIdx < ids.length) return ids[idOrIdx] ?? String(idOrIdx)
    return String(idOrIdx ?? '')
  }
  const W = 320
  const H = 250
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) / 2 - 36
  const pos = new Map<string, { x: number; y: number }>()
  ids.forEach((id, i) => {
    const a = (i / ids.length) * Math.PI * 2 - Math.PI / 2
    pos.set(id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) })
  })
  const W_ = W - 10
  return (
    <div className="flex justify-center">
      <svg viewBox={`0 0 ${W_} ${H}`} className="max-w-full">
        {edgesRaw.map((e, i) => {
          const o = (e ?? {}) as { from?: unknown; to?: unknown; weight?: unknown }
          const p1 = pos.get(labelOf(o.from))
          const p2 = pos.get(labelOf(o.to))
          if (p1 == null || p2 == null) return null
          return (
            <g key={i}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#43454a" strokeWidth={1.5} />
              {o.weight != null && (
                <text x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 3} textAnchor="middle" fill="#9da0a8" fontSize={10}>
                  {fmt(o.weight)}
                </text>
              )}
            </g>
          )
        })}
        {ids.map((id) => {
          const p = pos.get(id)
          if (p == null) return null
          const hl = hlMatch(highlight, id)
          const pt = pointers != null && Object.values(pointers).some((v) => String(v) === id)
          return (
            <motion.g key={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <circle
                cx={p.x}
                cy={p.y}
                r={17}
                fill={hl ? 'rgba(53,116,240,0.25)' : '#26282b'}
                stroke={pt ? '#be9117' : hl ? '#3574f0' : '#43454a'}
                strokeWidth={pt ? 2 : 1.5}
              />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fill="#dfe1e5" fontSize={12} fontFamily="monospace">
                {id}
              </text>
            </motion.g>
          )
        })}
      </svg>
    </div>
  )
}

/** hashTable：buckets（每桶 = 链数组 | 值 | null）。 */
function HashTableTpl({ data, pointers, highlight }: FrameProps): React.JSX.Element {
  const buckets = asArray(data.buckets)
  if (buckets.length === 0) throw new Error('hashTable 模板需要 data.buckets 非空数组')
  return (
    <div className="flex flex-col gap-1.5">
      {buckets.map((b, i) => {
        const chain = Array.isArray(b) ? b : [b]
        const hl = hlMatch(highlight, String(i))
        const names = pointerNamesAt(pointers, String(i))
        return (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-12 shrink-0 rounded border px-1 py-0.5 text-center font-mono text-[11px] ${hl ? 'border-acc text-acc' : 'border-line text-tx2'}`}>
              [{i}]
            </div>
            <span className="text-tx2">→</span>
            {chain.length === 0 || chain[0] == null ? (
              <span className="font-mono text-[12px] text-tx2/50">∅</span>
            ) : (
              <div className="flex items-center gap-1.5">
                {chain.map((it, j) => (
                  <motion.span
                    layout
                    key={j}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25 }}
                    className="rounded border border-line bg-bg px-2 py-0.5 font-mono text-[12px] text-tx"
                  >
                    {fmt(it)}
                  </motion.span>
                ))}
              </div>
            )}
            {names.length > 0 && <span className="font-mono text-[11px] text-warn">▲ {names.join(' ')}</span>}
          </div>
        )
      })}
    </div>
  )
}

/** matrix：rows 二维数组；highlight 数字 = 行主序扁平下标。 */
function MatrixTpl({ data, highlight }: FrameProps): React.JSX.Element {
  const rows = asArray(data.rows).map((r) => asArray(r))
  if (rows.length === 0 || rows[0]?.length === 0) throw new Error('matrix 模板需要 data.rows 非空二维数组')
  const cols = Math.max(...rows.map((r) => r.length))
  return (
    <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(2.8rem, 1fr))` }}>
      {rows.flatMap((r, ri) =>
        r.map((v, ci) => {
          const flat = ri * cols + ci
          return (
            <motion.div layout key={flat} transition={{ duration: 0.3 }} className={cellCls(hlMatch(highlight, String(flat)))}>
              <span className="text-[11px] text-tx2/60">
                [{ri},{ci}]
              </span>
              {fmt(v)}
            </motion.div>
          )
        })
      )}
    </div>
  )
}

const TEMPLATES: Record<AnimBlock['template'], (p: FrameProps) => React.JSX.Element> = {
  array: ArrayTpl,
  stack: StackTpl,
  queue: QueueTpl,
  linkedList: LinkedListTpl,
  tree: TreeTpl,
  graph: GraphTpl,
  hashTable: HashTableTpl,
  matrix: MatrixTpl
}

/** 帧数据不匹配模板时降级为原始 JSON 展示（不中断课件学习）。 */
class TplBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: unknown): { err: string } {
    return { err: e instanceof Error ? e.message : String(e) }
  }
  render(): ReactNode {
    if (this.state.err != null) {
      return (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          帧数据与「{this.props.fallback}」模板不匹配（{this.state.err}），已降级为原始数据展示。
        </div>
      )
    }
    return this.props.children
  }
}

const PLAY_MS = 1800

export function AnimView({ block }: { block: AnimBlock }): React.JSX.Element {
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const frames = block.frames
  const cur = frames[Math.min(idx, frames.length - 1)]
  const Template = TEMPLATES[block.template]

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % frames.length)
    }, PLAY_MS)
    return () => clearInterval(t)
  }, [playing, frames.length])

  return (
    <div className="flex flex-col gap-3">
      {cur?.note != null && <div className="text-[12.5px] text-tx2">{cur.note}</div>}
      <TplBoundary key={idx} fallback={block.template}>
        <Template data={cur?.data ?? {}} pointers={cur?.pointers} highlight={cur?.highlight} />
      </TplBoundary>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="上一帧"
            disabled={idx === 0}
            onClick={() => {
              setPlaying(false)
              setIdx((i) => Math.max(0, i - 1))
            }}
            className="flex h-7 w-7 items-center justify-center rounded border border-line text-tx2 hover:bg-panel-hover disabled:opacity-40"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            aria-label={playing ? '暂停' : '播放'}
            onClick={() => setPlaying((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded border border-line text-tx2 hover:bg-panel-hover"
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            type="button"
            aria-label="下一帧"
            disabled={idx >= frames.length - 1}
            onClick={() => {
              setPlaying(false)
              setIdx((i) => Math.min(frames.length - 1, i + 1))
            }}
            className="flex h-7 w-7 items-center justify-center rounded border border-line text-tx2 hover:bg-panel-hover disabled:opacity-40"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <span className="font-mono text-[11px] text-tx2">
          帧 {Math.min(idx, frames.length - 1) + 1}/{frames.length} · {block.template}
        </span>
      </div>
    </div>
  )
}
