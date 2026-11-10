import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  RefreshCw,
  Bot,
  CircleCheck,
  CircleAlert,
  FileWarning,
  FileText,
  BadgeCheck,
  Ban,
  ScanSearch,
  X,
  Save,
  FileX2
} from 'lucide-react'
import type { LessonReviewItem, ReviewOverview, OcrPageResult, BookBlockAnchor } from '../../../shared/ipc'
import type { ReviewStatus } from '../../../shared/course-v2-schema'
import type { LessonDocument } from '../../../shared/lesson-schema'
import { BlockRenderer } from './blocks/BlockRenderer'
import { QuizCard, type QuizAnswerState } from './blocks/QuizCard'
import { Md } from './blocks/Md'

/**
 * P5.7 校对页（review.json 人审）：
 *  - 左列：章节分组课件表（人审状态 + 校验徽标）；右侧：渲染预览 + validate 面板 + 页码抽查 + digest 定稿
 *  - 预览复用 BlockRenderer 全量真渲染（interactive 同一沙箱 iframe = 所见即所得）；quiz 用 QuizCard 可试答
 *  - 状态流转 draft→valid|approved|failed（failed 由主进程现跑校验写入错误清单）
 *  - digest 定稿：KP 课件可直接修订摘要链（写入 progress.json，生成侧 getLearningContext 即时生效）
 */

type UiStatus = ReviewStatus | 'none'

const STATUS_META: Record<UiStatus, { label: string; cls: string }> = {
  none: { label: '未审', cls: 'text-tx2/60' },
  draft: { label: 'draft', cls: 'text-tx2' },
  valid: { label: 'valid', cls: 'text-acc' },
  approved: { label: 'approved', cls: 'text-ok' },
  failed: { label: 'failed', cls: 'text-bad' }
}

function StatusBadge({ status }: { status: UiStatus }): React.JSX.Element {
  const s = STATUS_META[status]
  const Icon = status === 'approved' ? CircleCheck : status === 'valid' ? BadgeCheck : status === 'failed' ? Ban : FileText
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${s.cls}`}>
      <Icon size={12} /> {s.label}
    </span>
  )
}

function ValidateBadge({ item }: { item: LessonReviewItem }): React.JSX.Element | null {
  if (item.errors.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-bad">
        <CircleAlert size={12} /> {item.errors.length} 错
      </span>
    )
  }
  if (item.warns.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warn">
        <FileWarning size={12} /> {item.warns.length} 提醒
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ok">
      <CircleCheck size={12} /> 通过
    </span>
  )
}

export function ReviewPage({
  courseId,
  title,
  onBack,
  onAskAgent
}: {
  courseId: string
  title: string
  onBack: () => void
  onAskAgent: (prompt: string) => void
}): React.JSX.Element {
  const [ov, setOv] = useState<ReviewOverview | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const res = await window.api.reviewGet(courseId)
    if (res.ok) {
      setOv(res.data)
      setLoadErr(null)
    } else {
      setLoadErr(res.error)
    }
  }, [courseId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const lessons = ov?.lessons ?? []
  const selectedItem = lessons.find((l) => l.lessonId === selectedId) ?? null

  // 首次进入自动选中第一个课件
  useEffect(() => {
    if (ov == null || selectedId != null || lessons.length === 0) return
    // 优先选中「有错误的」第一个，让最需要处理的课件先露出
    const target = lessons.find((l) => l.errors.length > 0) ?? lessons[0]
    setSelectedId(target.lessonId)
  }, [ov, selectedId, lessons])

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

  const setStatus = useCallback(
    (lessonId: string, status: ReviewStatus): Promise<boolean> =>
      run(() => window.api.reviewSetStatus({ courseId, lessonId, status })),
    [run, courseId]
  )

  const revalidate = useCallback(
    async (lessonId: string): Promise<void> => {
      setActionErr(null)
      const res = await window.api.reviewValidate(courseId, lessonId)
      if (!res.ok) {
        setActionErr(res.error)
        return
      }
      setOv((prev) =>
        prev == null
          ? prev
          : {
              ...prev,
              lessons: prev.lessons.map((l) =>
                l.lessonId === lessonId ? { ...l, errors: res.data.errors, warns: res.data.warns, words: res.data.words } : l
              )
            }
      )
    },
    [courseId]
  )

  const saveDigest = useCallback(
    (kpId: string, core: string, takeaway: string): Promise<boolean> =>
      run(() => window.api.kpDigestSave({ courseId, kpId, core, takeaway })),
    [run, courseId]
  )

  const stats = useMemo(() => {
    const approved = lessons.filter((l) => l.review?.status === 'approved').length
    const withErr = lessons.filter((l) => l.errors.length > 0).length
    return { total: lessons.length, approved, withErr }
  }, [lessons])

  // 章节分组（保持 manifest 顺序）
  const grouped = useMemo(() => {
    const out: { chapterId: string; chapterTitle: string; items: LessonReviewItem[] }[] = []
    for (const item of lessons) {
      const last = out[out.length - 1]
      if (last != null && last.chapterId === item.chapterId) last.items.push(item)
      else out.push({ chapterId: item.chapterId, chapterTitle: item.chapterTitle, items: [item] })
    }
    return out
  }, [lessons])

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
          <span className="text-[12px] text-tx2">课件校对</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-tx2">
            共 {stats.total} 课 · approved <span className="text-ok">{stats.approved}</span> ·
            {stats.withErr > 0 && <span className="text-bad"> 错误课 {stats.withErr}</span>}
            {stats.withErr === 0 && <span className="text-ok"> 全部零错误</span>}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-tx2 hover:bg-panel-hover"
          >
            <RefreshCw size={14} /> 刷新
          </button>
          <button
            type="button"
            onClick={() =>
              onAskAgent(
                `查看课程「${courseId}」的校对进度（cad_get_reviews 与 cad_course_stats），总结各课件的审核状态与待处理问题。`
              )
            }
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-tx hover:bg-panel-hover"
          >
            <Bot size={14} className="text-tx2" /> 问助教
          </button>
        </div>
      </header>

      {loadErr != null && (
        <div className="mx-4 mt-3 rounded-md border border-line bg-[#3a2426] px-3 py-2 text-[12.5px] text-bad">{loadErr}</div>
      )}
      {actionErr != null && (
        <div className="mx-4 mt-3 rounded-md border border-line bg-[#3a2426] px-3 py-2 text-[12.5px] text-bad">{actionErr}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左列：章节分组的课件表 */}
        <div className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-line bg-panel">
          {grouped.map((g) => (
            <div key={g.chapterId}>
              <div className="sticky top-0 z-10 border-b border-line bg-panel px-3.5 py-1.5 text-[11.5px] font-medium text-tx2">
                {g.chapterTitle}
              </div>
              {g.items.map((item) => {
                const selected = item.lessonId === selectedId
                const reviewStatus: UiStatus = item.review?.status ?? 'none'
                return (
                  <button
                    key={item.lessonId}
                    type="button"
                    onClick={() => setSelectedId(item.lessonId)}
                    className={`flex w-full flex-col gap-1 border-b border-line px-3.5 py-2.5 text-left hover:bg-panel-hover ${
                      selected ? 'bg-panel-hover' : ''
                    }`}
                  >
                    <span className="truncate text-[13px] font-medium text-tx">{item.title}</span>
                    <span className="flex items-center gap-2.5">
                      <StatusBadge status={reviewStatus} />
                      <ValidateBadge item={item} />
                      <span className="font-mono text-[10.5px] text-tx2/60">{item.lessonId}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {lessons.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <FileX2 size={28} className="text-tx2/50" />
              <div className="text-[12.5px] text-tx2">manifest 还没有任何课件</div>
            </div>
          )}
        </div>

        {/* 右侧：校对视图 */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selectedItem != null && ov != null && (
            <ReviewLessonView
              key={selectedItem.lessonId}
              item={selectedItem}
              isKp={ov.pathKpIds.includes(selectedItem.lessonId)}
              digest={ov.digests[selectedItem.lessonId]}
              hasMaterial={ov.materialId != null}
              courseId={courseId}
              busy={busy}
              onSetStatus={setStatus}
              onRevalidate={revalidate}
              onSaveDigest={saveDigest}
              onAskAgent={onAskAgent}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ===== 单课校对视图 ===== */

function ReviewLessonView({
  item,
  isKp,
  digest,
  hasMaterial,
  courseId,
  busy,
  onSetStatus,
  onRevalidate,
  onSaveDigest,
  onAskAgent
}: {
  item: LessonReviewItem
  isKp: boolean
  digest?: { core: string; takeaway: string }
  hasMaterial: boolean
  courseId: string
  busy: boolean
  onSetStatus: (lessonId: string, status: ReviewStatus) => Promise<boolean>
  onRevalidate: (lessonId: string) => Promise<void>
  onSaveDigest: (kpId: string, core: string, takeaway: string) => Promise<boolean>
  onAskAgent: (prompt: string) => void
}): React.JSX.Element {
  const doc = item.doc as LessonDocument | null
  const blocks = useMemo(() => doc?.blocks ?? [], [doc])
  const [answers, setAnswers] = useState<Record<string, QuizAnswerState>>({})
  const [pagePanel, setPagePanel] = useState<{ anchor: BookBlockAnchor; result: OcrPageResult | null; err: string | null } | null>(null)

  const anchorByBlock = useMemo(() => {
    const m = new Map<string, BookBlockAnchor>()
    for (const a of item.bookBlocks) m.set(a.blockId, a)
    return m
  }, [item.bookBlocks])

  const openPagePanel = useCallback(
    async (anchor: BookBlockAnchor): Promise<void> => {
      setPagePanel({ anchor, result: null, err: null })
      const res = await window.api.reviewPageText(courseId, {
        ...(anchor.ocrFile != null ? { ocrFile: anchor.ocrFile } : {}),
        bookPage: anchor.bookPage
      })
      if (res.ok) setPagePanel((prev) => (prev != null ? { ...prev, result: res.data } : prev))
      else setPagePanel((prev) => (prev != null ? { ...prev, err: res.error } : prev))
    },
    [courseId]
  )

  const status: UiStatus = item.review?.status ?? 'none'

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[16px] font-semibold text-tx">{item.title}</h1>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-tx2">
            <span>{item.lessonId}</span>
            <span className="text-tx2/50">{item.file}</span>
            <span>· {item.blockCount} 块</span>
            {item.words > 0 && <span>· 约 {item.words} 字</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSetStatus(item.lessonId, 'valid')}
            className="flex h-8 items-center gap-1.5 rounded-md border border-acc/60 px-3 text-[13px] text-acc hover:bg-panel-hover disabled:opacity-40"
          >
            <BadgeCheck size={14} /> 标记有效
          </button>
          <button
            type="button"
            disabled={busy || item.errors.length > 0}
            title={item.errors.length > 0 ? '存在校验错误，先修复才能批准' : '人审通过（终态）'}
            onClick={() => void onSetStatus(item.lessonId, 'approved')}
            className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            <CircleCheck size={14} /> 批准
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSetStatus(item.lessonId, 'failed')}
            className="flex h-8 items-center gap-1.5 rounded-md border border-bad/60 px-3 text-[13px] text-bad hover:bg-panel-hover disabled:opacity-40"
          >
            <Ban size={14} /> 标记失败
          </button>
        </div>
      </div>

      {status === 'approved' && (
        <div className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-[12.5px] text-ok">
          已人工批准 —— 该课件进入可信态；重新生成后会回到 draft。
        </div>
      )}
      {item.review?.feedback != null && (
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-[12.5px] text-tx2">
          人审反馈：{item.review.feedback}
        </div>
      )}

      {/* 校验面板（error=铁律/schema；warn=容量硬标准） */}
      {(item.errors.length > 0 || item.warns.length > 0) && (
        <div className="rounded-md border border-line bg-panel px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-tx2">机器校验</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onRevalidate(item.lessonId)}
              className="flex h-6 items-center gap-1 rounded px-1.5 text-[11.5px] text-tx2 hover:bg-panel-hover"
            >
              <RefreshCw size={12} /> 重校验
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {item.errors.map((e, i) => (
              <li key={`e${i}`} className="flex gap-2 text-[12px]">
                <CircleAlert size={13} className="mt-0.5 shrink-0 text-bad" />
                <span className="font-mono text-[11px] text-tx2">{e.path}</span>
                <span className="text-bad">{e.message}</span>
              </li>
            ))}
            {item.warns.map((w, i) => (
              <li key={`w${i}`} className="flex gap-2 text-[12px]">
                <FileWarning size={13} className="mt-0.5 shrink-0 text-warn" />
                <span className="text-warn">{w.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* digest 定稿（仅 KP 课件） */}
      {isKp && <DigestEditor kpId={item.lessonId} digest={digest} busy={busy} onSave={onSaveDigest} />}

      {/* 页码抽查入口 */}
      {item.bookBlocks.length > 0 && (
        <div className="rounded-md border border-line bg-panel px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-medium text-tx2">
            <ScanSearch size={14} /> 页码抽查
            <span className="font-normal text-tx2/70">
              {hasMaterial ? '点击块页码对照 OCR 原文（quote↔ocr 是页码铁律的主载体）' : '课程未关联教材资料，不可用'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {item.bookBlocks.map((a) => (
              <button
                key={a.blockId}
                type="button"
                disabled={!hasMaterial}
                onClick={() => void openPagePanel(a)}
                title={a.excerpt ?? `${a.blockType} @ pdf p.${a.pdfPage}`}
                className="flex h-6 items-center gap-1 rounded border border-line px-1.5 font-mono text-[10.5px] text-tx2 hover:bg-panel-hover disabled:opacity-40"
              >
                {a.blockId} · 书p.{a.bookPage ?? '?'} / pdfp.{a.pdfPage}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 渲染预览（book 块右上角页码徽标，点击同样打开对照） */}
      <div className="flex flex-col gap-3">
        {doc == null ? (
          <div className="rounded-md border border-bad/40 bg-[#3a2426] px-3 py-3 text-[12.5px] text-bad">
            课件无法读取（缺失或非 JSON）——请「让 AI 助教重新生成」。
            <button
              type="button"
              onClick={() =>
                onAskAgent(
                  `课程「${courseId}」的课件「${item.lessonId}（${item.title}）」文件缺失或损坏。请按 course-material-processor 技能重新生成该课件并落盘。`
                )
              }
              className="ml-2 text-acc underline"
            >
              生成
            </button>
          </div>
        ) : (
          blocks.map((b) => {
            const anchor = anchorByBlock.get(b.id)
            return (
              <div key={b.id} className="relative">
                {anchor != null && (
                  <button
                    type="button"
                    disabled={!hasMaterial}
                    onClick={() => void openPagePanel(anchor)}
                    title="页码抽查：对照 OCR 原文"
                    className="absolute right-2 top-2 z-10 rounded bg-track px-1.5 py-0.5 font-mono text-[10px] text-tx2 hover:bg-panel-hover hover:text-acc disabled:opacity-40"
                  >
                    书p.{anchor.bookPage ?? '?'} · pdfp.{anchor.pdfPage}
                  </button>
                )}
                {b.type === 'quiz' ? (
                  <QuizCard
                    block={b}
                    state={answers[b.id]}
                    onChange={(next): void => setAnswers((prev) => ({ ...prev, [b.id]: next }))}
                    onJudge={(correct): void =>
                      setAnswers((prev) => ({ ...prev, [b.id]: { ...(prev[b.id] as QuizAnswerState), judged: true, correct } }))
                    }
                  />
                ) : (
                  <BlockRenderer block={b} courseId={courseId} onAskAgent={onAskAgent} />
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 页码对照抽屉（quote↔ocr 并排） */}
      {pagePanel != null && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-[500px] flex-col border-l border-line bg-panel shadow-2xl">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
            <span className="text-[13px] font-medium text-tx">
              页码抽查 · {pagePanel.anchor.blockId}
              <span className="ml-2 font-mono text-[11px] text-tx2">
                书p.{pagePanel.anchor.bookPage ?? '?'} / pdfp.{pagePanel.anchor.pdfPage}
              </span>
            </span>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setPagePanel(null)}
              className="flex h-7 w-7 items-center justify-center rounded text-tx2 hover:bg-panel-hover"
            >
              <X size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {pagePanel.err != null && (
              <div className="rounded-md border border-bad/40 bg-[#3a2426] px-3 py-2 text-[12.5px] text-bad">{pagePanel.err}</div>
            )}
            {pagePanel.err == null && pagePanel.result == null && <div className="text-[12.5px] text-tx2">加载 OCR 页…</div>}
            {pagePanel.result != null && (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 text-[11.5px] font-medium text-tx2">课件侧摘录（quote 块）</div>
                  <div className="rounded-md border border-line bg-bg px-3 py-2">
                    {pagePanel.anchor.excerpt != null ? (
                      <Md text={pagePanel.anchor.excerpt} />
                    ) : (
                      <span className="text-[12px] text-tx2">（{pagePanel.anchor.blockType} 块无摘录文本）</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-tx2">OCR 原文</span>
                    <span className="font-mono text-[10.5px] text-tx2/60">{pagePanel.result.ocrFile}</span>
                  </div>
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg px-3 py-2 font-sans text-[12px] leading-relaxed text-tx2">
                    {pagePanel.result.md}
                  </pre>
                </div>
                {pagePanel.result.neighbors.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-tx2/70">相邻页：</span>
                    {pagePanel.result.neighbors.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() =>
                          void openPagePanel({ ...pagePanel.anchor, ocrFile: n, bookPage: pagePanel.anchor.bookPage })
                        }
                        className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-tx2 hover:bg-panel-hover"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ===== digest 定稿编辑器（KP 课件专用） ===== */

function DigestEditor({
  kpId,
  digest,
  busy,
  onSave
}: {
  kpId: string
  digest?: { core: string; takeaway: string }
  busy: boolean
  onSave: (kpId: string, core: string, takeaway: string) => Promise<boolean>
}): React.JSX.Element {
  const [core, setCore] = useState(digest?.core ?? '')
  const [takeaway, setTakeaway] = useState(digest?.takeaway ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setCore(digest?.core ?? '')
    setTakeaway(digest?.takeaway ?? '')
  }, [digest, kpId])

  const dirty = core !== (digest?.core ?? '') || takeaway !== (digest?.takeaway ?? '')
  const canSave = core.trim().length > 0 && takeaway.trim().length > 0 && core.length <= 500 && takeaway.length <= 500

  return (
    <div className="rounded-md border border-acc/30 bg-panel px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-tx2">
          digest 定稿（写入 progress.json 摘要链，生成侧取上下文即用）
          <span className="ml-2 font-normal text-tx2/60">{digest != null ? '已有现值' : '尚无（前序 KP 会被当 gap）'}</span>
        </span>
        {saved && !dirty && <span className="text-[11.5px] text-ok">已保存</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <textarea
          value={core}
          onChange={(e) => {
            setCore(e.target.value)
            setSaved(false)
          }}
          rows={3}
          placeholder="core：核心结论/公式（≤500 字）"
          className="resize-y rounded border border-line bg-bg px-2 py-1.5 text-[12.5px] text-tx outline-none focus:border-acc"
        />
        <textarea
          value={takeaway}
          onChange={(e) => {
            setTakeaway(e.target.value)
            setSaved(false)
          }}
          rows={2}
          placeholder="takeaway：一句话收获（≤500 字）"
          className="resize-y rounded border border-line bg-bg px-2 py-1.5 text-[12.5px] text-tx outline-none focus:border-acc"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-tx2/60">
            {core.length}/500 · {takeaway.length}/500
          </span>
          <button
            type="button"
            disabled={busy || !canSave}
            onClick={() => void onSave(kpId, core, takeaway).then((ok) => ok && setSaved(true))}
            className="flex h-7 items-center gap-1.5 rounded bg-acc px-2.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            <Save size={13} /> 保存 digest
          </button>
        </div>
      </div>
    </div>
  )
}
