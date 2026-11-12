import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Clock,
  FileCode2,
  FolderCode,
  Loader2,
  Play,
  RotateCcw
} from 'lucide-react'
import type { RunResult, RunnerTestResult, ExerciseDocument } from '../../../shared/ipc'
import type { CodeFile } from '../../../shared/course-schema'
import { Md } from './blocks/Md'
import { FileWorkbenchView } from './FileWorkbenchView'

/**
 * UI-重构（2026-11-12 新 IA）：中栏 = 代码。
 *  - tab「编程题」：课件 coding 块引用的练习（题面卡可折叠 + CodeMirror + 运行判定）
 *  - tab「文件」：课程文件工作区（FileWorkbenchView 原样复用）
 *  - 判定/输出面板：终端风格 mono 面板，逐测试 ✓/✗ + 输出对照 + stderr/编译输出
 *  交互式 REPL 终端需要新增常驻进程 IPC，属后续项——当前为一次性运行输出。
 */

const CodeEditor = lazy(async (): Promise<typeof import('./blocks/CodeEditor')> => await import('./blocks/CodeEditor'))

function EditorFallback(): React.JSX.Element {
  return (
    <div className="flex h-[160px] items-center justify-center rounded-md border border-line bg-bg text-[12.5px] text-tx2">
      <Loader2 size={16} className="mr-2 animate-spin" /> 编辑器加载中…
    </div>
  )
}

function normalizeLanguage(raw: string | undefined): string {
  const l = (raw ?? '').toLowerCase()
  if (l === 'py' || l === 'python3') return 'python'
  if (l === 'js' || l === 'node') return 'javascript'
  return l
}

export type CodeTab = 'exercise' | 'files'

export function CodeColumn({
  courseId,
  tab,
  onTabChange,
  exerciseIds,
  codingPassed,
  onPassed,
  onAskAgent,
  hasLesson
}: {
  courseId: string
  tab: CodeTab
  onTabChange: (t: CodeTab) => void
  /** 课件 coding 块引用的练习 id 列表（可多题） */
  exerciseIds: string[]
  codingPassed: boolean
  onPassed: () => void
  onAskAgent: (prompt: string) => void
  hasLesson: boolean
}): React.JSX.Element {
  const [exerciseIdx, setExerciseIdx] = useState(0)
  const safeIdx = exerciseIds.length > 0 ? Math.min(exerciseIdx, exerciseIds.length - 1) : 0
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* tab 条 */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        {exerciseIds.length > 0 && (
          <button
            type="button"
            onClick={(): void => onTabChange('exercise')}
            className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] ${
              tab === 'exercise' ? 'bg-acc/10 font-medium text-acc' : 'text-tx2 hover:bg-panel-hover'
            }`}
          >
            <FileCode2 size={13} /> 编程题
            {codingPassed && <CircleCheck size={12} className="text-ok" />}
          </button>
        )}
        <button
          type="button"
          onClick={(): void => onTabChange('files')}
          className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] ${
            tab === 'files' ? 'bg-acc/10 font-medium text-acc' : 'text-tx2 hover:bg-panel-hover'
          }`}
        >
          <FolderCode size={13} /> 文件
        </button>
        {exerciseIds.length > 1 && tab === 'exercise' && (
          <div className="ml-2 flex items-center gap-1">
            {exerciseIds.map((id, i) => (
              <button
                key={id}
                type="button"
                onClick={(): void => setExerciseIdx(i)}
                className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${
                  i === safeIdx ? 'bg-panel-hover text-tx' : 'text-tx2/70 hover:bg-panel-hover'
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 内容区 */}
      {tab === 'files' ? (
        <FileWorkbenchView courseId={courseId} />
      ) : exerciseIds.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <FileCode2 size={28} className="text-tx2/50" strokeWidth={1.4} />
          <div className="text-[12.5px] text-tx2">{hasLesson ? '本节课件没有编程题——可在「文件」tab 自由练习' : '选择小节后，编程题在此打开'}</div>
        </div>
      ) : (
        <ExercisePanel
          key={exerciseIds[safeIdx]}
          courseId={courseId}
          exerciseId={exerciseIds[safeIdx]}
          codingPassed={codingPassed}
          onPassed={onPassed}
          onAskAgent={onAskAgent}
        />
      )}
    </div>
  )
}

/* ===== 编程题面板（题卡 + 编辑器 + 终端风格判定面板） ===== */

function ExercisePanel({
  courseId,
  exerciseId,
  codingPassed,
  onPassed,
  onAskAgent
}: {
  courseId: string
  exerciseId: string
  codingPassed: boolean
  onPassed: () => void
  onAskAgent: (prompt: string) => void
}): React.JSX.Element {
  const [exercise, setExercise] = useState<ExerciseDocument | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [files, setFiles] = useState<CodeFile[]>([])
  const [entryPath, setEntryPath] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [runErr, setRunErr] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [statementOpen, setStatementOpen] = useState(true)

  const language = useMemo(
    () => normalizeLanguage(exercise?.starterFiles.find((f) => f.path === entryPath)?.language ?? exercise?.starterFiles[0]?.language),
    [exercise, entryPath]
  )

  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      const res = await window.api.exerciseGet(courseId, exerciseId)
      if (cancelled) return
      if (!res.ok) {
        setLoadErr(res.error)
        return
      }
      const ex = res.data
      setExercise(ex)
      setFiles(ex.starterFiles.map((f) => ({ ...f })))
      const entry = ex.starterFiles.find((f) => !f.readOnly) ?? ex.starterFiles[0]
      setEntryPath(entry?.path ?? '')
      if (ex.starterFiles.length === 0) setLoadErr('练习没有起步文件')
    })()
    return () => {
      cancelled = true
    }
  }, [courseId, exerciseId])

  const activeFile = files.find((f) => f.path === entryPath) ?? null

  const setEntryContent = useCallback(
    (content: string): void => {
      setFiles((prev) => prev.map((f) => (f.path === entryPath ? { ...f, content } : f)))
    },
    [entryPath]
  )

  const doRun = useCallback(async (): Promise<void> => {
    if (exercise == null || running) return
    setRunning(true)
    setRunErr(null)
    setResult(null)
    try {
      const res = await window.api.runnerRun({
        courseId,
        exerciseId,
        language: language || 'python',
        files,
        tests: exercise.tests
      })
      if (!res.ok) {
        setRunErr(res.error)
        return
      }
      setResult(res.data)
      if (res.data.passedAll) {
        onPassed()
      }
    } finally {
      setRunning(false)
    }
  }, [exercise, running, courseId, exerciseId, language, files, onPassed])

  if (loadErr != null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <CircleAlert size={24} className="text-warn" />
        <div className="text-[12.5px] text-tx2">
          编程题 {exerciseId} 无法加载：{loadErr}
        </div>
        <button
          type="button"
          onClick={(): void => onAskAgent(`课程「${courseId}」的练习 ${exerciseId} 无法加载（${loadErr}）。请检查或按技能要求重建该练习文件。`)}
          className="text-[12.5px] text-acc underline"
        >
          问助教
        </button>
      </div>
    )
  }
  if (exercise == null) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12.5px] text-tx2">
        <Loader2 size={15} className="mr-2 animate-spin" /> 加载练习 {exerciseId}…
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 题面卡（可折叠——题目随编辑器共进退，2026-11-12 拍板） */}
      <div className="shrink-0 border-b border-line bg-panel px-4 py-2.5">
        <button
          type="button"
          onClick={(): void => setStatementOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <FileCode2 size={14} className="shrink-0 text-acc" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-tx">{exercise.title}</span>
          {exercise.number != null && <span className="shrink-0 font-mono text-[11px] text-tx2">原书 {exercise.number}</span>}
          {codingPassed && <span className="shrink-0 text-[11.5px] font-medium text-ok">已通过 ✓</span>}
          {statementOpen ? <ChevronUp size={14} className="shrink-0 text-tx2" /> : <ChevronDown size={14} className="shrink-0 text-tx2" />}
        </button>
        {statementOpen && (
          <div className="mt-1.5 max-h-[180px] overflow-y-auto text-[12.5px] leading-relaxed text-tx2">
            {exercise.statement.trim().length > 0 ? (
              <Md text={exercise.statement} />
            ) : (
              <span className="text-tx2/60">（无题面）</span>
            )}
          </div>
        )}
      </div>

      {/* 编辑器（占据余空间） */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {activeFile != null ? (
          <div className="h-full min-h-[240px] overflow-hidden rounded-md border border-line">
            <Suspense fallback={<EditorFallback />}>
              <CodeEditor
                key={activeFile.path}
                value={activeFile.content}
                language={activeFile.language ?? language ?? ''}
                readOnly={activeFile.readOnly === true}
                onChange={setEntryContent}
              />
            </Suspense>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[12.5px] text-tx2">练习没有可编辑文件</div>
        )}
      </div>

      {/* 运行条 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-4 py-2">
        <button
          type="button"
          disabled={running || exercise.tests.length === 0}
          onClick={() => void doRun()}
          className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-3.5 text-[12.5px] font-medium text-white hover:bg-acc-hover disabled:opacity-40"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? '运行中…' : '运行并判定'}
        </button>
        {result != null && !running && (
          <button
            type="button"
            onClick={() => void doRun()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-tx2 hover:bg-panel-hover"
          >
            <RotateCcw size={13} /> 重跑
          </button>
        )}
        <span className="ml-auto font-mono text-[11px] text-tx2">
          {entryPath || '—'} · {language || '—'}
        </span>
      </div>

      {/* 判定/输出面板（终端风格） */}
      <div className="h-[210px] shrink-0 overflow-y-auto border-t border-line bg-[#1E1F22] px-3 py-2 font-mono text-[11.5px] leading-relaxed">
        {runErr != null && <pre className="whitespace-pre-wrap text-[#F07178]">✗ {runErr}</pre>}
        {result?.compile != null && !result.compile.ok && (
          <pre className="whitespace-pre-wrap text-[#F07178]">编译失败{'\n'}{result.compile.output}</pre>
        )}
        {result == null && runErr == null && (
          <div className="text-[#6C707E]">
            {exercise.tests.length === 0 ? (
              <span className="text-warn">练习没有配置测试用例，无法自动判定</span>
            ) : (
              <span>$ 点「运行并判定」后，逐用例结果在这里输出</span>
            )}
          </div>
        )}
        {result != null && (
          <>
            {result.results.map((r) => (
              <TerminalTestRow key={r.id} r={r} />
            ))}
            <div className={`mt-1 font-semibold ${result.passedAll ? 'text-[#4FC1A6]' : 'text-[#E8D66D]'}`}>
              {result.results.filter((r) => r.passed).length}/{result.results.length} 通过 · 总耗时 {(result.totalRunMs / 1000).toFixed(1)}s
              {result.passedAll ? ' —— 满足完成判定（quiz ≥ 2/3 且编程通过）' : ''}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** 终端行：✓/✗ 用例名 + 耗时；失败可展开期望/实际/stderr 对照。 */
function TerminalTestRow({ r }: { r: RunnerTestResult }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" onClick={(): void => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className={r.passed ? 'text-[#4FC1A6]' : 'text-[#F07178]'}>{r.passed ? '✓' : '✗'}</span>
        <span className="text-[#D4D4D9]">{r.name}</span>
        {r.timedOut && <Clock size={12} className="text-warn" />}
        <span className="ml-auto text-[10.5px] text-[#6C707E]">{(r.durationMs / 1000).toFixed(1)}s</span>
        {!r.passed && <span className="text-[10.5px] text-[#6C707E]">{open ? '收起' : '对照'}</span>}
      </button>
      {open && (
        <div className="ml-5 mt-1 border-l border-[#3A3C41] pl-3">
          <pre className="whitespace-pre-wrap text-[#9E6B00]">期望: {r.expected || '（空）'}</pre>
          <pre className="whitespace-pre-wrap text-[#F07178]">实际: {r.actual || '（空）'}</pre>
          {r.stderr.length > 0 && <pre className="whitespace-pre-wrap text-[#E8D66D]">stderr: {r.stderr}</pre>}
        </div>
      )}
    </div>
  )
}
