import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Play, CircleCheck, CircleAlert, Loader2, RotateCcw, Clock, FileCode2 } from 'lucide-react'
import type { CodingBlock } from '../../../../shared/lesson-schema'
import type { RunResult, RunnerTestResult, ExerciseDocument } from '../../../../shared/ipc'
import type { CodeFile } from '../../../../shared/course-schema'
import { BlockShell } from './BlockShell'
import { Md } from './Md'

/**
 * P5.8 编程题块（Runner 本地执行 + 测试判定）：
 *  - 拉练习文档（exercise:get）→ 题面 md + 起步文件编辑（entry 文件可编辑，readOnly 锁定）
 *  - 运行 → runner:run（临时工作区/超时杀树/stdin-stdout 判定）→ 逐测试 pass/fail + 输出对照
 *  - 全部通过 → onPassed 上抛（学习页完成判定门转正：quiz≥2/3 且编程通过 = 正常 completed）
 *  - 编辑器 CodeMirror 6 懒加载分包；本块被学习页与校对页共用（校对页不传 onPassed）
 */

const CodeEditor = lazy(async (): Promise<typeof import('./CodeEditor')> => await import('./CodeEditor'))

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

export function CodingBlockView({
  block,
  courseId,
  onPassed,
  onAskAgent,
  chrome = 'read'
}: {
  block: CodingBlock
  courseId: string
  onPassed?: () => void
  onAskAgent?: (prompt: string) => void
  chrome?: 'read' | 'review'
}): React.JSX.Element {
  const [exercise, setExercise] = useState<ExerciseDocument | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [files, setFiles] = useState<CodeFile[]>([])
  const [entryPath, setEntryPath] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [runErr, setRunErr] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [passed, setPassed] = useState(false)

  const language = useMemo(
    () => normalizeLanguage(exercise?.starterFiles.find((f) => f.path === entryPath)?.language ?? exercise?.starterFiles[0]?.language),
    [exercise, entryPath]
  )

  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      const res = await window.api.exerciseGet(courseId, block.exerciseId)
      if (cancelled) return
      if (!res.ok) {
        setLoadErr(res.error)
        return
      }
      const ex = res.data
      setExercise(ex)
      setFiles(ex.starterFiles.map((f) => ({ ...f })))
      // entry：第一个非只读起步文件，缺省第一个
      const entry = ex.starterFiles.find((f) => !f.readOnly) ?? ex.starterFiles[0]
      setEntryPath(entry?.path ?? '')
      if (ex.starterFiles.length === 0) setLoadErr('练习没有起步文件')
    })()
    return () => {
      cancelled = true
    }
  }, [courseId, block.exerciseId])

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
        exerciseId: block.exerciseId,
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
        setPassed(true)
        onPassed?.()
      }
    } finally {
      setRunning(false)
    }
  }, [exercise, running, courseId, block.exerciseId, language, files, onPassed])

  return (
    <BlockShell label="coding" origin={block.origin} source={null} chrome={chrome}>
      {loadErr != null ? (
        <div className="rounded-md bg-bad/10 px-3 py-2.5 text-[12.5px] text-bad">
          编程题 {block.exerciseId} 无法加载：{loadErr}
          {onAskAgent != null && (
            <button
              type="button"
              onClick={() => onAskAgent(`课程「${courseId}」的练习 ${block.exerciseId} 无法加载（${loadErr}）。请检查或按技能要求重建该练习文件。`)}
              className="ml-2 text-acc underline"
            >
              问助教
            </button>
          )}
        </div>
      ) : exercise == null ? (
        <div className="flex h-[120px] items-center justify-center text-[12.5px] text-tx2">
          <Loader2 size={15} className="mr-2 animate-spin" /> 加载练习 {block.exerciseId}…
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <FileCode2 size={15} className="shrink-0 text-acc" />
            <span className="text-[13.5px] font-medium text-tx">{exercise.title}</span>
            {exercise.number != null && <span className="font-mono text-[11px] text-tx2">原书 {exercise.number}</span>}
            {passed && <span className="ml-auto text-[12px] font-medium text-ok">判定通过 ✓</span>}
          </div>
          {exercise.statement.trim().length > 0 && <Md text={exercise.statement} />}

          {/* entry 文件编辑器 */}
          {activeFile != null ? (
            <div className="overflow-hidden rounded-md border border-line">
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
          ) : null}

          {/* 运行/判定 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={running || exercise.tests.length === 0}
              onClick={() => void doRun()}
              className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-3.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? '运行中…' : '运行并判定'}
            </button>
            {passed && (
              <button
                type="button"
                onClick={() => void doRun()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] text-tx2 hover:bg-panel-hover"
              >
                <RotateCcw size={13} /> 重跑
              </button>
            )}
            {exercise.tests.length === 0 && (
              <span className="text-[12px] text-warn">练习没有配置测试用例，无法自动判定</span>
            )}
          </div>

          {runErr != null && (
            <div className="rounded-md bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{runErr}</div>
          )}

          {/* 编译输出（仅 C） */}
          {result?.compile != null && !result.compile.ok && (
            <div className="rounded-md bg-bad/10 px-3 py-2">
              <div className="mb-1 text-[12px] font-medium text-bad">编译失败</div>
              <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-tx2">{result.compile.output}</pre>
            </div>
          )}

          {/* 测试结果 */}
          {result != null && (
            <div className="flex flex-col gap-1.5">
              {result.results.map((r) => (
                <TestRow key={r.id} r={r} />
              ))}
              <div className="mt-0.5 text-[11.5px] text-tx2">
                {result.results.filter((r) => r.passed).length}/{result.results.length} 通过 · 总耗时{' '}
                {(result.totalRunMs / 1000).toFixed(1)}s
              </div>
              {result.passedAll && (
                <div className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-[12.5px] text-ok">
                  编程题判定通过 —— 现在满足完成判定条件（quiz ≥ 2/3 且编程通过）。
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </BlockShell>
  )
}

function TestRow({ r }: { r: RunnerTestResult }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`rounded-md border px-3 py-2 ${r.passed ? 'border-ok/40' : 'border-bad/40'}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        {r.passed ? <CircleCheck size={14} className="shrink-0 text-ok" /> : <CircleAlert size={14} className="shrink-0 text-bad" />}
        <span className="text-[12.5px] font-medium text-tx">{r.name}</span>
        {r.timedOut && <Clock size={13} className="text-warn" />}
        <span className="ml-auto font-mono text-[10.5px] text-tx2">{(r.durationMs / 1000).toFixed(1)}s</span>
        <span className="text-[10.5px] text-tx2/70">{open ? '收起' : '对照'}</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[10.5px] font-medium text-tx2">期望输出</div>
            <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded border border-line bg-bg px-2 py-1 font-mono text-[11px] text-tx2">{r.expected || '（空）'}</pre>
          </div>
          <div>
            <div className="mb-1 text-[10.5px] font-medium text-tx2">实际输出</div>
            <pre className={`max-h-[160px] overflow-auto whitespace-pre-wrap rounded border px-2 py-1 font-mono text-[11px] ${r.passed ? 'border-line bg-bg2 text-tx2' : 'border-bad/40 bg-bad/10 text-bad'}`}>{r.actual || '（空）'}</pre>
          </div>
          {r.stderr.length > 0 && (
            <div className="col-span-2">
              <div className="mb-1 text-[10.5px] font-medium text-tx2">stderr</div>
              <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap rounded border border-warn/40 bg-bg px-2 py-1 font-mono text-[11px] text-warn">{r.stderr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
