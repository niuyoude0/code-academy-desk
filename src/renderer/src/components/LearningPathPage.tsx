import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { AlertTriangle, Bot, BookOpen, CircleCheck, CircleDashed, FileCode2 } from 'lucide-react'
import type { CoursePathView } from '../../../shared/ipc'
import type { PathEntry, ProgressFile } from '../../../shared/learning-path-schema'
import type { LessonDocument, QuizBlock } from '../../../shared/lesson-schema'
import { BlockRenderer } from './blocks/BlockRenderer'
import { QuizCard, type QuizAnswerState } from './blocks/QuizCard'
import { AgentSidePanel } from './AgentSidePanel'
import { CodeColumn, type CodeTab } from './CodeColumn'
import { TopNavBar, type KpUiState, type TopNavKpRow } from './TopNavBar'
import { agentChatStore, useAgentChat } from '../agentChatStore'

/**
 * P5.4 学习路径页（2026-11-12 新 IA 落地，渲染层重排、数据管线零改动）：
 *  - 顶部工具栏 = 课程目录（TopNavBar：KP 下拉 + 进度点 + 上一节/下一节 + 重新生成课件带确认）
 *  - 左栏 = 课件正文（BlockRenderer 全量直排；coding 块渲染为入口卡，题目本体在中栏）
 *  - 中栏 = 代码（CodeColumn：编程题编辑器 + 文件工作区 + 终端风判定面板）
 *  - 右栏 = AI 助教（AgentSidePanel 常驻，共享 agentChatStore 单例会话）
 *  - 完成判定门（D6）：quiz≥2/3 自动解锁；含编程题时 Runner 判过（判定结果从中栏上抛）
 *  - 生成触发 = 拼固定提示词直通助教（D3 静默）；落盘推送 lesson:updated 自动刷新课件区
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

export function LearningPathPage({
  courseId,
  title,
  onBack,
  onOpenAgent
}: {
  courseId: string
  title: string
  onBack: () => void
  /** 助教栏「去配置 Key」时跳转全页助教 */
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
  // 中栏代码 tab（载入课件时按是否含编程题自动切换）
  const [codeTab, setCodeTab] = useState<CodeTab>('exercise')
  // 重新生成课件追踪：课件区显示「生成中」横幅，落盘推送到达后自动换新
  const [regenKpId, setRegenKpId] = useState<string | null>(null)
  const [updatedTip, setUpdatedTip] = useState<string | null>(null)
  const { running: chatRunning } = useAgentChat()

  /** 学习页内的助教入口：固定提示词直通右栏助教（共享 DSH 会话，空闲即发/忙则挂起）。 */
  const askAgent = useCallback(
    (prompt: string): void => {
      agentChatStore.requestPrompt(prompt)
    },
    []
  )

  /** 重新生成指定 KP 课件：确认（消耗 API 额度）→ 固定提示词直通 + 生成中横幅。 */
  const regenerate = useCallback(
    (kp: PathEntry): void => {
      if (!window.confirm(`将让 AI 助教重新生成「${kp.title}」的课件，会消耗 API 额度。继续？`)) return
      setRegenKpId(kp.id)
      askAgent(buildGenerationPrompt(courseId, kp.id))
    },
    [askAgent, courseId]
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

  /** TopNavBar 的行数据（七态 + 锁定判定） */
  const navRows = useMemo<TopNavKpRow[]>(
    () => kps.map((kp) => ({ kp, state: stateOf(kp), unlocked: unlocked(kp.id) })),
    [kps, stateOf, unlocked]
  )

  const loadLesson = useCallback(
    async (kp: PathEntry): Promise<void> => {
      setSelectedKpId(kp.id)
      setLesson(null)
      setLessonErr(null)
      setAnswers({})
      setCodingPassed(false)
      const res = await window.api.lessonGet(courseId, kp.chapterId, kp.id)
      if (res.ok) {
        setLesson(res.data)
        const doc = res.data as LessonDocument | null
        setCodeTab(doc?.blocks.some((b) => b.type === 'coding') ? 'exercise' : 'files')
      } else {
        setLessonErr(res.error)
      }
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

  // 课件落盘推送（2026-11-12 bug 修复）：cad_save_kp_lesson 成功 → 刷新路径 + 提示；
  // 正在展示该 KP 则直接换入新课件——生成过程在聊天流可见，结果不再要求手动重选
  useEffect(() => {
    return window.api.onLessonUpdated(({ courseId: cid, kpId }) => {
      if (cid !== courseId) return
      void refresh()
      setRegenKpId((cur) => (cur === kpId ? null : cur))
      const isCurrent = kpId === selectedKpId
      setUpdatedTip(isCurrent ? '课件已重新生成，本区域已自动更新' : `知识点「${kpId}」课件已生成`)
      if (isCurrent) {
        const kp = kps.find((k) => k.id === kpId)
        if (kp != null) void loadLesson(kp)
      }
    })
  }, [courseId, refresh, selectedKpId, kps, loadLesson])

  // 助教空闲（本轮结束且无落盘推送）→ 撤掉生成中横幅
  useEffect(() => {
    if (!chatRunning) setRegenKpId(null)
  }, [chatRunning])

  // 落盘提示 4s 自动消退
  useEffect(() => {
    if (updatedTip == null) return
    const t = window.setTimeout(() => setUpdatedTip(null), 4000)
    return () => window.clearTimeout(t)
  }, [updatedTip])

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
  const exerciseIds = useMemo(
    () => blocks.filter((b) => b.type === 'coding').map((b) => (b as { exerciseId: string }).exerciseId),
    [blocks]
  )
  const hasCoding = exerciseIds.length > 0
  const answered = quizBlocks.filter((b) => answers[b.id]?.judged === true)
  const correct = answered.filter((b) => answers[b.id]?.correct === true).length
  const quizBest = quizBlocks.length > 0 ? `${correct}/${quizBlocks.length}` : undefined
  const ratio = quizBlocks.length > 0 ? correct / quizBlocks.length : 0
  // D6 完成判定：quiz≥2/3 且（无编程题 或 编程 Runner 判定通过）
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

  return (
    <div className="flex h-full flex-col">
      <TopNavBar
        courseTitle={title}
        rows={navRows}
        selectedKpId={selectedKpId}
        regenBusy={regenKpId != null && chatRunning}
        onSelect={(kp): void => void loadLesson(kp)}
        onBack={onBack}
        onRegenerate={(): void => {
          if (selectedKp != null) regenerate(selectedKp)
        }}
        onRefresh={(): void => void refresh()}
      />

      {loadErr != null && (
        <div className="mx-4 mt-3 rounded-md bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{loadErr}</div>
      )}
      {actionErr != null && (
        <div className="mx-4 mt-3 rounded-md bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{actionErr}</div>
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
          <PanelGroup direction="horizontal" autoSaveId="cad-workbench-v2" className="h-full">
            {/* 左栏：课件正文（豆包式文档流直排 + 压平完成判定门） */}
            <Panel defaultSize={34} minSize={24} maxSize={46}>
              <div className="flex h-full min-h-0 flex-col">
                {regenKpId != null && regenKpId === selectedKpId && chatRunning && (
                  <div className="flex shrink-0 items-center gap-2 border-b border-line bg-acc/5 px-4 py-2 text-[12px] text-acc">
                    <CircleDashed size={13} className="animate-spin" />
                    AI 正在重新生成本节课件，完成后此栏自动更新（生成过程见右栏）
                  </div>
                )}
                {selectedKp == null || doc == null ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                    {lessonErr != null ? (
                      <>
                        <AlertTriangle size={26} className="text-warn" />
                        <div className="text-[12.5px] text-tx2">{lessonErr}</div>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedKp != null) regenerate(selectedKp)
                          }}
                          className="mt-1 flex h-8 items-center gap-1.5 rounded-md border border-acc/60 px-3 text-[12.5px] text-acc hover:bg-panel-hover"
                        >
                          重新生成课件
                        </button>
                      </>
                    ) : (
                      <>
                        <BookOpen size={30} className="text-tx2/50" strokeWidth={1.4} />
                        <div className="text-[12.5px] text-tx2">从顶部小节下拉选择一个知识点开始学习</div>
                        {view.progress.currentKpId != null && (
                          <div className="text-[11.5px] text-tx2/70">
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
                    canComplete={canComplete}
                    ratio={ratio}
                    busy={busy}
                    onComplete={doComplete}
                    onAskAgent={askAgent}
                    onOpenExercise={(): void => setCodeTab('exercise')}
                    courseId={courseId}
                  />
                )}
              </div>
            </Panel>

            <PanelResizeHandle className="w-px bg-transparent transition-colors hover:bg-acc/40 data-[resize-handle-active]:bg-acc/40" />

            {/* 中栏：代码（编程题编辑器 / 文件工作区 + 终端风判定面板） */}
            <Panel minSize={24}>
              <CodeColumn
                courseId={courseId}
                tab={codeTab}
                onTabChange={setCodeTab}
                exerciseIds={exerciseIds}
                codingPassed={codingPassed}
                onPassed={(): void => setCodingPassed(true)}
                onAskAgent={askAgent}
                hasLesson={doc != null}
              />
            </Panel>

            <PanelResizeHandle className="w-px bg-transparent transition-colors hover:bg-acc/40 data-[resize-handle-active]:bg-acc/40" />

            {/* 右栏：AI 助教（常驻，共享 DSH 会话） */}
            <Panel defaultSize={26} minSize={18} maxSize={40}>
              <div className="flex h-full flex-col border-l border-line bg-panel">
                <AgentSidePanel onOpenFull={onOpenAgent} />
              </div>
            </Panel>
          </PanelGroup>
        </div>
      )}

      {/* 课件落盘提示（cad_save_kp_lesson 成功推送；4s 自动消退） */}
      {updatedTip != null && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-1.5 rounded-md bg-ok/10 px-4 py-2 text-[13px] font-medium text-ok shadow-sm">
          <CircleCheck size={14} /> {updatedTip}
        </div>
      )}
    </div>
  )
}

/* ===== 左栏学习视图（BlockRenderer 全量真渲染 + quiz 交互卡 + 编程题入口卡） ===== */

function StudyView({
  kp,
  progress,
  blocks,
  answers,
  setAnswers,
  quizSummary,
  hasCoding,
  codingPassed,
  canComplete,
  ratio,
  busy,
  onComplete,
  onAskAgent: askAgent,
  onOpenExercise,
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
  canComplete: boolean
  ratio: number
  busy: boolean
  onComplete: (forced: boolean) => Promise<void>
  onAskAgent: (prompt: string) => void
  /** 打开中栏编程题 tab（coding 块入口卡） */
  onOpenExercise: () => void
  courseId: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-5 py-6">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-[19px] font-bold tracking-tight text-tx">{kp.title}</h1>
            <span className="shrink-0 font-mono text-[10.5px] text-tx2/50">{kp.id}</span>
          </div>
          {progress?.state === 'completed' && (
            <div className="mt-3 rounded-md bg-ok/10 px-3 py-2 text-[12px] text-ok">
              已完成{progress.forced ? '（应急通过）' : ''} · 最近判定 {progress.quizBest ?? '—'} —— 当前是回溯回顾
            </div>
          )}
          <div className="mt-6 flex flex-col gap-6">
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
              ) : b.type === 'coding' ? (
                <CodingEntryCard
                  key={b.id}
                  courseId={courseId}
                  exerciseId={(b as { exerciseId: string }).exerciseId}
                  passed={codingPassed}
                  onOpen={onOpenExercise}
                  onAskAgent={askAgent}
                />
              ) : (
                <BlockRenderer key={b.id} block={b} courseId={courseId} onAskAgent={askAgent} />
              )
            )}
          </div>
        </div>
      </div>

      {/* 完成判定门（D6）：压平底栏 */}
      {progress?.state !== 'completed' && progress?.state !== 'skipped' && quizSummary.total > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-bg px-4 py-2.5">
          <div className="text-[12px] text-tx2">
            判定 <span className="font-mono font-semibold text-tx">{quizSummary.correct}/{quizSummary.total}</span>
            （已答 {quizSummary.answered}/{quizSummary.total}）· 达标线 2/3
            {hasCoding &&
              (codingPassed ? (
                <span className="ml-1 text-ok">· 编程题已通过</span>
              ) : (
                <span className="ml-1 text-warn">· 含编程题：中栏判定通过后可正常完成</span>
              ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !canComplete}
              onClick={() => void onComplete(false)}
              className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-3.5 text-[12.5px] font-medium text-white hover:bg-acc-hover disabled:opacity-40"
            >
              <CircleCheck size={14} /> 完成判定
            </button>
            {(hasCoding || ratio < 2 / 3) && (
              <button
                type="button"
                disabled={busy || quizSummary.answered < quizSummary.total}
                onClick={() => void onComplete(true)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-warn/60 px-3 text-[12.5px] text-warn hover:bg-panel-hover disabled:opacity-40"
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
              className="flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] text-tx2 hover:bg-panel-hover"
            >
              <Bot size={13} /> 问助教
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 编程题入口卡（左栏）：题面/编辑器/判定都在中栏——题目随编辑器共进退（2026-11-12 拍板）。 */
function CodingEntryCard({
  courseId,
  exerciseId,
  passed,
  onOpen,
  onAskAgent
}: {
  courseId: string
  exerciseId: string
  passed: boolean
  onOpen: () => void
  onAskAgent: (prompt: string) => void
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-panel px-3.5 py-3">
      <div className="flex items-center gap-2">
        <FileCode2 size={15} className="shrink-0 text-acc" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-tx">随堂编程 · {exerciseId}</span>
        {passed && <span className="shrink-0 text-[12px] font-medium text-ok">已通过 ✓</span>}
      </div>
      <div className="mt-1 text-[12px] text-tx2">题面、编辑器与判定面板在中间代码栏，随编辑器共进退。</div>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-7 items-center gap-1.5 rounded bg-acc px-2.5 text-[12px] font-medium text-white hover:bg-acc-hover"
        >
          去作答
        </button>
        <button
          type="button"
          onClick={(): void =>
            onAskAgent(`请给课程「${courseId}」练习 ${exerciseId} 一点解题思路提示（循序渐进，不要直接给完整答案）。`)
          }
          className="flex h-7 items-center rounded border border-line px-2.5 text-[12px] text-tx2 hover:bg-panel-hover"
        >
          要提示
        </button>
      </div>
    </div>
  )
}
