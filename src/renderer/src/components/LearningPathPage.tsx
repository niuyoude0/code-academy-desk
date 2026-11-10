import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  ArrowLeft,
  Bot,
  Lock,
  CircleDashed,
  CircleCheck,
  SkipForward,
  Play,
  RefreshCw,
  AlertTriangle,
  BookOpen,
  Pencil,
  RotateCcw,
  RefreshCcwDot,
  FolderCode,
  X
} from 'lucide-react'
import type { CoursePathView } from '../../../shared/ipc'
import type { PathEntry, ProgressFile } from '../../../shared/learning-path-schema'
import type { LessonDocument, QuizBlock } from '../../../shared/lesson-schema'
import { BlockRenderer } from './blocks/BlockRenderer'
import { QuizCard, type QuizAnswerState } from './blocks/QuizCard'
import { AgentSidePanel } from './AgentSidePanel'
import { FileWorkbenchView } from './FileWorkbenchView'
import { agentChatStore } from '../agentChatStore'

/**
 * P5.4 学习路径页（知识点驱动，2026-11-10 用户六原则拍板）：
 *  - 左列：有序 KP 表（锁定/待生成/失败/就绪/学习中/已完成/已跳过 七态徽标）+ 按需生成触发
 *  - 右侧：学习视图（P5.5 起为 BlockRenderer 全量真渲染：markdown/KaTeX/shiki/mermaid/echarts/anim）
 *  - 完成判定门（D6）：quiz≥2/3 自动解锁下一知识点；含编程题走应急门（P5.8 接 Runner 后转正）
 *  - 生成课件的触发 = 拼固定提示词发给 AI 助教（流程固定，无对话框——D3 静默）
 */

function buildGenerationPrompt(courseId: string, kpId: string): string {
  return [
    `请为课程「${courseId}」生成知识点「${kpId}」的课件。严格按 course-material-processor 技能的主循环 B 执行：`,
    '1. cad_get_learning_context 取上下文（前序 digest 链 / gap 空缺 / 下一节预告）',
    '2. cad_get_kp_source 取该 KP 的 factsheet 详情节与 ocr 页原文',
    `3. 按 references/quality-standard.md 的七段式块映射组织课件，lessonId = "${kpId}"，同一任务产出该 KP 的 digest（core/takeaway）`,
    '4. cad_validate_course_blocks 自检：error 清零、warn 补齐（返工 ≤2 轮）',
    '5. cad_save_kp_lesson 落盘',
    '6. 汇报：块数、正文字数、页码覆盖区间、digest JSON',
    '教材没有的内容不得发明；origin=book 的块必须带页码 source。'
  ].join('\n')
}

function buildSkeletonPrompt(courseId: string): string {
  return [
    `课程「${courseId}」还没有学习路径。请按 course-material-processor 技能的主循环 A 执行：`,
    '1. cad_get_manifest 看课程章节树',
    '2. 读 sourceRef.materialId 指向的教材资料中各章 factsheet 的「知识点清单」节',
    '3. cad_init_path 初始化 KP 学习路径（保持教学顺序；id 建议 chNN-kNN；bookPage 用书内页码；interactivity 强/中/弱直译 strong/medium/weak）',
    '4. 汇报章数与 KP 总数。到此为止，不要生成任何课件——等用户开始学习再按需生成。'
  ].join('\n')
}

/** KP 的学习态（渲染层本视图；判定/解锁规则本体在主进程服务）。 */
type KpUiState = 'locked' | 'pending' | 'failed' | 'ready' | 'learning' | 'completed' | 'skipped'

export function LearningPathPage({
  courseId,
  title,
  onBack,
  onOpenAgent
}: {
  courseId: string
  title: string
  onBack: () => void
  /** 侧栏助教「去配置 Key」时跳转全页助教 */
  onOpenAgent: () => void
}): React.JSX.Element {
  const [view, setView] = useState<CoursePathView | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [selectedKpId, setSelectedKpId] = useState<string | null>(null)
  const [lesson, setLesson] = useState<unknown>(null)
  const [lessonErr, setLessonErr] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, QuizAnswerState>>({})
  const [codingPassed, setCodingPassed] = useState(false)
  const [busy, setBusy] = useState(false)
  // P6 三栏工作台：右侧「助教/文件」面板（可拖拽宽度，autoSaveId 持久化布局）
  const [sideTab, setSideTab] = useState<'agent' | 'files' | null>(null)

  /** 学习页内的助教入口：打开右侧助教栏 + 固定提示词直通（共享 DSH 会话，空闲即发/忙则挂起）。 */
  const askAgent = useCallback(
    (prompt: string): void => {
      setSideTab('agent')
      agentChatStore.requestPrompt(prompt)
    },
    []
  )

  const refresh = useCallback(async (): Promise<void> => {
    const res = await window.api.pathGet(courseId)
    if (res.ok) {
      setView(res.data)
      setLoadErr(null)
    } else {
      setLoadErr(res.error)
    }
  }, [courseId])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000) // 生成期间轮询 genStatus 变化
    return () => clearInterval(timer)
  }, [refresh])

  const progressByKp = useMemo(() => {
    const m = new Map<string, ProgressFile['kps'][number]>()
    for (const k of view?.progress.kps ?? []) m.set(k.kpId, k)
    return m
  }, [view])

  const kps = view?.path?.kps ?? []

  const stateOf = useCallback(
    (kp: PathEntry): KpUiState => {
      const p = progressByKp.get(kp.id)
      if (p?.state === 'completed') return 'completed'
      if (p?.state === 'skipped') return 'skipped'
      if (p?.state === 'learning') return 'learning'
      if (kp.genStatus === 'ready') return 'ready'
      if (kp.genStatus === 'failed') return 'failed'
      return 'pending'
    },
    [progressByKp]
  )

  const unlocked = useCallback(
    (kpId: string): boolean => {
      const idx = kps.findIndex((k) => k.id === kpId)
      if (idx <= 0) return kps.length > 0
      const settled = new Set(
        [...progressByKp.values()].filter((k) => k.state === 'completed' || k.state === 'skipped').map((k) => k.kpId)
      )
      return kps.slice(0, idx).every((k) => settled.has(k.id))
    },
    [kps, progressByKp]
  )

  const loadLesson = useCallback(
    async (kp: PathEntry): Promise<void> => {
      setSelectedKpId(kp.id)
      setLesson(null)
      setLessonErr(null)
      setAnswers({})
      setCodingPassed(false)
      const res = await window.api.lessonGet(courseId, kp.chapterId, kp.id)
      if (res.ok) setLesson(res.data)
      else setLessonErr(res.error)
    },
    [courseId]
  )

  // 首次进入自动选中当前学习位（若课件已就绪）
  useEffect(() => {
    if (view == null || selectedKpId != null) return
    const cur = view.progress.currentKpId
    const target = kps.find((k) => k.id === cur) ?? kps[0]
    if (target != null && target.genStatus === 'ready') void loadLesson(target)
  }, [view, kps, selectedKpId, loadLesson])

  const run = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
      setBusy(true)
      setActionErr(null)
      const res = await fn()
      setBusy(false)
      if (!res.ok) {
        setActionErr(res.error ?? '操作失败')
        return false
      }
      await refresh()
      return true
    },
    [refresh]
  )

  const selectedKp = kps.find((k) => k.id === selectedKpId) ?? null
  const selectedProgress = selectedKp != null ? progressByKp.get(selectedKp.id) : undefined
  // lessonGet 由后端 validateLessonDocument 落盘前校验过，此处类型收窄安全
  const doc = lesson as LessonDocument | null
  const blocks = doc?.blocks ?? []
  const quizBlocks = blocks.filter((b): b is QuizBlock => b.type === 'quiz')
  const hasCoding = blocks.some((b) => b.type === 'coding')
  const answered = quizBlocks.filter((b) => answers[b.id]?.judged === true)
  const correct = answered.filter((b) => answers[b.id]?.correct === true).length
  const quizBest = quizBlocks.length > 0 ? `${correct}/${quizBlocks.length}` : undefined
  const ratio = quizBlocks.length > 0 ? correct / quizBlocks.length : 0
  // D6 完成判定：quiz≥2/3 且（无编程题 或 编程 Runner 判定通过）——P5.8 起编程题不再强制走应急门
  const canComplete =
    quizBlocks.length > 0 && answered.length === quizBlocks.length && ratio >= 2 / 3 && (!hasCoding || codingPassed)

  const doComplete = useCallback(
    async (forced: boolean): Promise<void> => {
      const ok = await run(() =>
        window.api.kpComplete({
          courseId,
          kpId: String(selectedKp?.id ?? ''),
          ...(quizBest != null ? { quizBest } : {}),
          ...(hasCoding && !forced ? { codingPassed: codingPassed } : {}),
          ...(forced ? { forced: true } : {})
        })
      )
      if (ok) {
        setSelectedKpId(null)
        setLesson(null)
        setAnswers({})
        setCodingPassed(false)
      }
    },
    [run, courseId, selectedKp, quizBest, hasCoding, codingPassed]
  )

  const stateBadge = (st: KpUiState): React.JSX.Element => {
    const map: Record<KpUiState, { icon: React.JSX.Element; cls: string; label: string }> = {
      locked: { icon: <Lock size={13} />, cls: 'text-tx2/50', label: '未解锁' },
      pending: { icon: <CircleDashed size={13} className="text-warn" />, cls: 'text-warn', label: '待生成' },
      failed: { icon: <AlertTriangle size={13} className="text-bad" />, cls: 'text-bad', label: '生成失败' },
      ready: { icon: <BookOpen size={13} className="text-ok" />, cls: 'text-ok', label: '课件就绪' },
      learning: { icon: <Play size={13} className="text-acc" />, cls: 'text-acc', label: '学习中' },
      completed: { icon: <CircleCheck size={13} className="text-ok" />, cls: 'text-ok', label: '已完成' },
      skipped: { icon: <SkipForward size={13} className="text-tx2" />, cls: 'text-tx2', label: '已跳过' }
    }
    const s = map[st]
    return (
      <span className={`inline-flex items-center gap-1 text-[11.5px] font-medium ${s.cls}`}>
        {s.icon}
        {s.label}
      </span>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label="返回"
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="truncate text-[14px] font-semibold text-tx">{title}</span>
          <span className="text-[12px] text-tx2">学习路径</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={selectedKpId == null}
            title={selectedKpId == null ? '先在左侧选择一个知识点' : '按技能要求让 AI 助教重新生成当前知识点课件'}
            onClick={() => askAgent(buildGenerationPrompt(courseId, selectedKpId ?? ''))}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-tx hover:bg-panel-hover disabled:opacity-40"
          >
            <RefreshCcwDot size={14} className="text-tx2" /> 重新生成课件
          </button>
          <button
            type="button"
            title="右侧工作台：AI 助教（与全页助教共用会话）"
            onClick={() => setSideTab((t) => (t === 'agent' ? null : 'agent'))}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] ${
              sideTab === 'agent' ? 'bg-acc/10 text-acc' : 'text-tx hover:bg-panel-hover'
            }`}
          >
            <Bot size={14} /> 助教
          </button>
          <button
            type="button"
            title="右侧工作台：文件工作区（课程沙盒 + git 快照）"
            onClick={() => setSideTab((t) => (t === 'files' ? null : 'files'))}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] ${
              sideTab === 'files' ? 'bg-acc/10 text-acc' : 'text-tx hover:bg-panel-hover'
            }`}
          >
            <FolderCode size={14} /> 文件
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-tx2 hover:bg-panel-hover"
          >
            <RefreshCw size={14} /> 刷新
          </button>
          <button
            type="button"
            onClick={() => askAgent(`查看课程「${courseId}」的学习进度（cad_get_path 与 cad_get_progress），并简要总结当前学习状态。`)}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-tx hover:bg-panel-hover"
          >
            <Bot size={14} className="text-tx2" /> 问助教
          </button>
        </div>
      </header>

      {loadErr != null && (
        <div className="mx-4 mt-3 rounded-md bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
          {loadErr}
        </div>
      )}
      {actionErr != null && (
        <div className="mx-4 mt-3 rounded-md bg-bad/10 px-3 py-2 text-[12.5px] text-bad">
          {actionErr}
        </div>
      )}

      {view?.path == null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <BookOpen size={36} className="text-tx2/60" strokeWidth={1.4} />
          <div>
            <div className="text-[14px] font-medium text-tx">还没有学习路径</div>
            <div className="mt-1 text-[12.5px] text-tx2">
              让 AI 助教读取教材资料的「知识点清单」，生成有序知识点学习路径（此后按需逐个生成课件）
            </div>
          </div>
          <button
            type="button"
            onClick={() => askAgent(buildSkeletonPrompt(courseId))}
            className="flex h-9 items-center gap-2 rounded-md bg-acc px-4 text-[13px] font-medium text-white hover:opacity-90"
          >
            <Bot size={15} /> 让 AI 助教建学习路径
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <PanelGroup direction="horizontal" autoSaveId="cad-workbench-v1" className="h-full">
            {/* 左列：KP 列表（IDEA 树式扁平行，无行分隔线；可拖拽宽度） */}
            <Panel defaultSize={23} minSize={13} maxSize={40}>
              <div className="flex h-full flex-col overflow-y-auto border-r border-line bg-panel py-2">
                {kps.map((kp, i) => {
                  const st = stateOf(kp)
                  const isUnlocked = unlocked(kp.id)
                  const shown: KpUiState = isUnlocked || st === 'completed' || st === 'skipped' || st === 'learning' ? st : 'locked'
                  const selected = kp.id === selectedKpId
                  return (
                    <div
                      key={kp.id}
                      className={`mx-2 flex flex-col gap-1.5 rounded-md px-2.5 py-2.5 ${selected ? 'bg-acc/10' : 'hover:bg-panel-hover'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10.5px] text-tx2/70">{String(i + 1).padStart(2, '0')}</span>
                            <span className="truncate text-[13px] font-medium text-tx">{kp.title}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2">
                            {stateBadge(shown)}
                            {kp.bookPage != null && <span className="text-[11px] text-tx2/70">书内 p.{kp.bookPage}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {(shown === 'pending' || shown === 'failed') && isUnlocked && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => askAgent(buildGenerationPrompt(courseId, kp.id))}
                            className="flex h-7 items-center gap-1.5 rounded border border-acc/60 px-2 text-[12px] text-acc hover:bg-panel-hover disabled:opacity-50"
                          >
                            <Bot size={12} /> {shown === 'failed' ? '重试生成' : '生成课件'}
                          </button>
                        )}
                        {(shown === 'ready' || shown === 'learning') && (
                          <button
                            type="button"
                            onClick={() => void loadLesson(kp)}
                            className="flex h-7 items-center gap-1.5 rounded bg-acc px-2 text-[12px] font-medium text-white hover:bg-acc-hover"
                          >
                            <Play size={12} /> {shown === 'learning' ? '继续学习' : '开始学习'}
                          </button>
                        )}
                        {shown === 'completed' && (
                          <button
                            type="button"
                            onClick={() => void loadLesson(kp)}
                            className="flex h-7 items-center gap-1.5 rounded border border-line px-2 text-[12px] text-tx2 hover:bg-panel-hover"
                          >
                            <RotateCcw size={12} /> 回顾
                          </button>
                        )}
                        {shown === 'skipped' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => window.api.kpStart(courseId, kp.id))}
                            className="flex h-7 items-center gap-1.5 rounded border border-line px-2 text-[12px] text-tx2 hover:bg-panel-hover disabled:opacity-50"
                          >
                            <Play size={12} /> 重新学
                          </button>
                        )}
                        {isUnlocked && shown !== 'completed' && shown !== 'skipped' && shown !== 'locked' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => window.api.kpSkip(courseId, kp.id))}
                            className="flex h-7 items-center gap-1.5 rounded border border-line px-2 text-[12px] text-tx2 hover:bg-panel-hover disabled:opacity-50"
                          >
                            <SkipForward size={12} /> 跳过
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <PanelResizeHandle className="w-px bg-transparent transition-colors hover:bg-acc/40 data-[resize-handle-active]:bg-acc/40" />

            {/* 中列：学习视图（豆包式居中阅读列 + 压平的完成判定门） */}
            <Panel minSize={30}>
              <div className="flex h-full min-h-0 flex-col">
            {selectedKp == null || doc == null ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                {lessonErr != null ? (
                  <>
                    <AlertTriangle size={28} className="text-warn" />
                    <div className="text-[13px] text-tx2">{lessonErr}</div>
                    <button
                      type="button"
                      onClick={() => askAgent(buildGenerationPrompt(courseId, selectedKp?.id ?? ''))}
                      className="mt-1 flex h-8 items-center gap-1.5 rounded-md border border-acc/60 px-3 text-[13px] text-acc hover:bg-panel-hover"
                    >
                      <Pencil size={13} /> 重新生成课件
                    </button>
                  </>
                ) : (
                  <>
                    <BookOpen size={32} className="text-tx2/50" strokeWidth={1.4} />
                    <div className="text-[13px] text-tx2">从左侧选择一个知识点开始学习</div>
                    {view.progress.currentKpId != null && (
                      <div className="text-[12px] text-tx2/70">
                        当前进度位：
                        {kps.find((k) => k.id === view.progress.currentKpId)?.title ?? view.progress.currentKpId}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <StudyView
                kp={selectedKp}
                progress={selectedProgress}
                blocks={blocks}
                answers={answers}
                setAnswers={setAnswers}
                quizSummary={{ total: quizBlocks.length, correct, answered: answered.length }}
                hasCoding={hasCoding}
                codingPassed={codingPassed}
                onCodingPassed={(): void => setCodingPassed(true)}
                canComplete={canComplete}
                ratio={ratio}
                busy={busy}
                onComplete={doComplete}
                onAskAgent={askAgent}
                courseId={courseId}
              />
            )}
              </div>
            </Panel>

            {/* 右栏：工作台（AI 助教 / 文件工作区，可拖拽宽度，autoSaveId 持久化） */}
            {sideTab != null && (
              <>
                <PanelResizeHandle className="w-px bg-transparent transition-colors hover:bg-acc/40 data-[resize-handle-active]:bg-acc/40" />
                <Panel defaultSize={32} minSize={20} maxSize={60}>
                  <div className="flex h-full flex-col border-l border-line bg-panel">
                    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
                      <button
                        type="button"
                        onClick={() => setSideTab('agent')}
                        className={`flex h-6 items-center gap-1 rounded px-2 text-[11.5px] ${
                          sideTab === 'agent' ? 'bg-acc/10 font-medium text-acc' : 'text-tx2 hover:bg-panel-hover'
                        }`}
                      >
                        <Bot size={12} /> 助教
                      </button>
                      <button
                        type="button"
                        onClick={() => setSideTab('files')}
                        className={`flex h-6 items-center gap-1 rounded px-2 text-[11.5px] ${
                          sideTab === 'files' ? 'bg-acc/10 font-medium text-acc' : 'text-tx2 hover:bg-panel-hover'
                        }`}
                      >
                        <FolderCode size={12} /> 文件
                      </button>
                      <button
                        type="button"
                        aria-label="关闭工作台"
                        title="关闭工作台"
                        onClick={() => setSideTab(null)}
                        className="ml-auto flex h-6 w-6 items-center justify-center rounded text-tx2 hover:bg-panel-hover"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <div className="min-h-0 flex-1">
                      {sideTab === 'agent' ? (
                        <AgentSidePanel onOpenFull={onOpenAgent} />
                      ) : (
                        <FileWorkbenchView courseId={courseId} />
                      )}
                    </div>
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      )}
    </div>
  )
}

/* ===== 学习视图（P5.5：BlockRenderer 全量真渲染 + quiz 交互卡） ===== */

function StudyView({
  kp,
  progress,
  blocks,
  answers,
  setAnswers,
  quizSummary,
  hasCoding,
  codingPassed,
  onCodingPassed,
  canComplete,
  ratio,
  busy,
  onComplete,
  onAskAgent: askAgent,
  courseId
}: {
  kp: PathEntry
  progress?: ProgressFile['kps'][number]
  blocks: LessonDocument['blocks']
  answers: Record<string, QuizAnswerState>
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, QuizAnswerState>>>
  quizSummary: { total: number; correct: number; answered: number }
  hasCoding: boolean
  codingPassed: boolean
  onCodingPassed: () => void
  canComplete: boolean
  ratio: number
  busy: boolean
  onComplete: (forced: boolean) => Promise<void>
  onAskAgent: (prompt: string) => void
  courseId: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 阅读列（豆包式：居中 max-w、白底文档流、块间距放大） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[820px] px-14 py-10">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-[22px] font-bold tracking-tight text-tx">{kp.title}</h1>
            <span className="shrink-0 font-mono text-[11px] text-tx2/50">{kp.id}</span>
          </div>
          {progress?.state === 'completed' && (
            <div className="mt-4 rounded-md bg-ok/10 px-3 py-2 text-[12.5px] text-ok">
              已完成{progress.forced ? '（应急通过）' : ''} · 最近判定 {progress.quizBest ?? '—'} —— 当前是回溯回顾
            </div>
          )}
          <div className="mt-8 flex flex-col gap-7">
            {blocks.map((b) =>
              b.type === 'quiz' ? (
                <QuizCard
                  key={b.id}
                  block={b}
                  state={answers[b.id]}
                  onChange={(next): void => setAnswers((prev) => ({ ...prev, [b.id]: next }))}
                  onJudge={(correct): void =>
                    setAnswers((prev) => ({ ...prev, [b.id]: { ...(prev[b.id] as QuizAnswerState), judged: true, correct } }))
                  }
                />
              ) : (
                <BlockRenderer
                  key={b.id}
                  block={b}
                  courseId={courseId}
                  onAskAgent={askAgent}
                  onCodingPassed={b.type === 'coding' ? onCodingPassed : undefined}
                />
              )
            )}
          </div>
        </div>
      </div>

      {/* 完成判定门（D6）：压平为底栏（分隔线 + 白底，无卡片无投影） */}
      {progress?.state !== 'completed' && progress?.state !== 'skipped' && quizSummary.total > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-bg px-12 py-2.5">
          <div className="text-[12.5px] text-tx2">
            判定 <span className="font-mono font-semibold text-tx">{quizSummary.correct}/{quizSummary.total}</span>
            （已答 {quizSummary.answered}/{quizSummary.total}）· 达标线 2/3
            {hasCoding &&
              (codingPassed ? (
                <span className="ml-1 text-ok">· 编程题已通过</span>
              ) : (
                <span className="ml-1 text-warn">· 本课件含编程题：运行判定通过后可正常完成</span>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !canComplete}
              onClick={() => void onComplete(false)}
              className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-3.5 text-[13px] font-medium text-white hover:bg-acc-hover disabled:opacity-40"
            >
              <CircleCheck size={14} /> 完成判定
            </button>
            {(hasCoding || ratio < 2 / 3) && (
              <button
                type="button"
                disabled={busy || quizSummary.answered < quizSummary.total}
                onClick={() => void onComplete(true)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-warn/60 px-3 text-[13px] text-warn hover:bg-panel-hover disabled:opacity-40"
              >
                <AlertTriangle size={13} /> 应急完成
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                askAgent(
                  `我在课程「${courseId}」的知识点「${kp.id}（${kp.title}）」判定未达标。请按技能要求帮我重讲这个知识点的薄弱处（依据 quiz 易错点），并视需要重新生成更好的课件。`
                )
              }
              className="flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] text-tx2 hover:bg-panel-hover"
            >
              <Bot size={13} /> 问助教
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
