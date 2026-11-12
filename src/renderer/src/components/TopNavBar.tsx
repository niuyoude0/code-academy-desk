import { useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  RefreshCcwDot,
  RefreshCw,
  SkipForward,
  AlertTriangle,
  Play,
  Lock,
  Loader2,
  CircleUserRound
} from 'lucide-react'
import type { PathEntry } from '../../../shared/learning-path-schema'

/**
 * UI-重构（2026-11-12 用户拍板新 IA）：顶部工具栏 = 课程目录。
 * 课程名 + KP 下拉（七态，替代旧左列 KP 树）+ 小节进度点 + 上一节/下一节
 * + 重新生成课件（带确认——清 P3）+ 刷新。锁定态 KP 不可选。
 */

/** KP 的学习态（渲染层本视图；判定/解锁规则本体在主进程服务）。 */
export type KpUiState = 'locked' | 'pending' | 'failed' | 'ready' | 'learning' | 'completed' | 'skipped'

export interface TopNavKpRow {
  kp: PathEntry
  state: KpUiState
  unlocked: boolean
}

const STATE_META: Record<KpUiState, { icon: typeof CircleCheck; cls: string; label: string }> = {
  locked: { icon: Lock, cls: 'text-tx2/50', label: '未解锁' },
  pending: { icon: CircleDashed, cls: 'text-warn', label: '待生成' },
  failed: { icon: AlertTriangle, cls: 'text-bad', label: '生成失败' },
  ready: { icon: CircleCheck, cls: 'text-ok/70', label: '课件就绪' },
  learning: { icon: Play, cls: 'text-acc', label: '学习中' },
  completed: { icon: CircleCheck, cls: 'text-ok', label: '已完成' },
  skipped: { icon: SkipForward, cls: 'text-tx2', label: '已跳过' }
}

const DOT_CLS: Record<KpUiState, string> = {
  locked: 'bg-line',
  pending: 'bg-warn/70',
  failed: 'bg-bad',
  ready: 'bg-ok/50',
  learning: 'bg-acc',
  completed: 'bg-ok',
  skipped: 'bg-tx2/40'
}

export function TopNavBar({
  courseTitle,
  rows,
  selectedKpId,
  regenBusy,
  onSelect,
  onBack,
  onRegenerate,
  onRefresh
}: {
  courseTitle: string
  rows: TopNavKpRow[]
  selectedKpId: string | null
  regenBusy: boolean
  onSelect: (kp: PathEntry) => void
  onBack: () => void
  onRegenerate: () => void
  onRefresh: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const idx = rows.findIndex((r) => r.kp.id === selectedKpId)
  const current = idx >= 0 ? rows[idx] : null
  const selectable = (r: TopNavKpRow): boolean => r.unlocked || r.state === 'completed' || r.state === 'skipped'
  const go = (delta: number): void => {
    let next = idx + delta
    while (next >= 0 && next < rows.length && !selectable(rows[next])) next += delta
    if (next >= 0 && next < rows.length) onSelect(rows[next].kp)
  }
  const completedCount = rows.filter((r) => r.state === 'completed').length

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg px-3">
      <button
        type="button"
        aria-label="返回"
        onClick={onBack}
        className="flex h-8 w-8 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
      >
        <ArrowLeft size={16} />
      </button>
      <span className="max-w-[180px] truncate text-[13.5px] font-semibold text-tx">{courseTitle}</span>
      <span className="text-tx2/50">/</span>

      {/* 小节下拉（旧 KP 列表的归宿） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={rows.length === 0}
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-panel-hover disabled:opacity-40"
      >
        <span className="max-w-[220px] truncate font-medium text-tx">
          {current != null ? `${idx + 1}. ${current.kp.title}` : '选择小节'}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-tx2 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* 小节进度点 */}
      <div className="ml-1 flex items-center gap-1" title={`已完成 ${completedCount}/${rows.length}`}>
        {rows.map((r, i) => (
          <span
            key={r.kp.id}
            className={`h-1.5 w-1.5 rounded-full ${DOT_CLS[r.state]} ${i === idx ? 'ring-1 ring-acc/60 ring-offset-1' : ''}`}
          />
        ))}
        <span className="ml-1 font-mono text-[11px] text-tx2/70">
          {completedCount}/{rows.length}
        </span>
      </div>

      <div className="min-w-2 flex-1" />
      {regenBusy && (
        <span className="flex items-center gap-1.5 text-[12px] text-acc">
          <Loader2 size={12} className="animate-spin" /> 生成中
        </span>
      )}
      <button
        type="button"
        disabled={idx < 0}
        title="让 AI 助教按技能要求重新生成当前知识点课件（消耗 API 额度）"
        onClick={onRegenerate}
        className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-tx hover:bg-panel-hover disabled:opacity-40"
      >
        <RefreshCcwDot size={14} className="text-tx2" /> 重新生成课件
      </button>
      <div className="mx-1 h-5 w-px bg-line" />
      <button
        type="button"
        disabled={idx <= 0}
        onClick={() => go(-1)}
        className="flex h-8 items-center rounded-md border border-line px-2.5 text-[12.5px] text-tx2 hover:bg-panel-hover disabled:opacity-40"
      >
        上一节
      </button>
      <button
        type="button"
        disabled={idx < 0 || idx >= rows.length - 1}
        onClick={() => go(1)}
        className="flex h-8 items-center rounded-md bg-acc px-3 text-[12.5px] font-medium text-white hover:bg-acc-hover disabled:opacity-40"
      >
        下一节
      </button>
      <button
        type="button"
        title="刷新学习路径与进度"
        onClick={onRefresh}
        className="flex h-8 w-8 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
      >
        <RefreshCw size={14} />
      </button>
      <span title="学习者" className="ml-0.5 text-tx2">
        <CircleUserRound size={20} strokeWidth={1.5} />
      </span>

      {/* KP 下拉面板 */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(): void => setOpen(false)} />
          <div className="absolute left-3 top-12 z-50 max-h-[560px] w-[380px] overflow-y-auto rounded-lg border border-line bg-bg py-1.5 shadow-md">
            {rows.map((r, i) => {
              const meta = STATE_META[r.state]
              const Icon = meta.icon
              const canPick = selectable(r)
              const selected = r.kp.id === selectedKpId
              return (
                <button
                  key={r.kp.id}
                  type="button"
                  disabled={!canPick}
                  onClick={(): void => {
                    setOpen(false)
                    onSelect(r.kp)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left ${selected ? 'bg-acc/10' : 'hover:bg-panel-hover'} ${canPick ? '' : 'cursor-not-allowed opacity-45'}`}
                >
                  <span className="w-6 shrink-0 font-mono text-[10.5px] text-tx2/70">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-tx">{r.kp.title}</span>
                  {r.kp.bookPage != null && <span className="shrink-0 font-mono text-[10.5px] text-tx2/60">p.{r.kp.bookPage}</span>}
                  <span className={`flex shrink-0 items-center gap-1 text-[11px] font-medium ${meta.cls}`}>
                    <Icon size={12} /> {meta.label}
                  </span>
                </button>
              )
            })}
            {rows.length === 0 && <div className="px-3 py-4 text-center text-[12.5px] text-tx2">还没有小节</div>}
          </div>
        </>
      )}
    </header>
  )
}
