import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Settings, FolderUp, FileUp, Plus, HelpCircle, Library, Bot } from 'lucide-react'
import type { CourseIndexEntry } from '../../../shared/course-schema'
import { CourseCard } from './CourseCard'
import { ContinueBanner } from './ContinueBanner'
import { EmptyState } from './EmptyState'
import { ToastStack } from './Toast'
import type { ToastItem, ToastKind } from './Toast'

/**
 * P3 课程首页（对应 design/home.pen 两屏设计稿）：
 * 顶部导航栏 + 继续学习横幅 + 全部课程网格 + 导入/创建入口 + 空状态。
 */
export function CourseHomePage({
  onOpenAgent,
  onOpenCourse
}: {
  onOpenAgent: () => void
  onOpenCourse: (courseId: string, title: string) => void
}): React.JSX.Element {
  const [courses, setCourses] = useState<CourseIndexEntry[] | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((kind: ToastKind, message: string) => {
    const item: ToastItem = { id: Date.now() + Math.random(), kind, message }
    setToasts((ts) => [...ts, item])
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== item.id)), 4000)
  }, [])

  const refresh = useCallback((): void => {
    void window.api.courseList().then((res) => {
      if (res.ok) setCourses(res.data)
      else {
        setCourses([])
        toast('bad', res.error)
      }
    })
  }, [toast])

  useEffect(() => {
    refresh()
  }, [refresh])

  const importPackage = useCallback((): void => {
    void window.api.courseImport().then((res) => {
      if (res.ok) {
        toast('ok', `课程「${res.data.title}」导入成功：${res.data.chapterCount} 章 · ${res.data.exerciseCount} 题`)
        refresh()
      } else if (res.error !== '已取消导入') {
        toast('bad', `导入失败：${res.error}`)
      }
    })
  }, [toast, refresh])

  const exportCourse = useCallback(
    (id: string): void => {
      void window.api.courseExport(id).then((res) => {
        if (res.ok) toast('ok', `课程包已导出到 ${res.data}`)
        else if (res.error !== '已取消导出') toast('bad', `导出失败：${res.error}`)
      })
    },
    [toast]
  )

  const removeCourse = useCallback(
    (id: string): void => {
      void window.api.courseRemove(id).then((res) => {
        if (res.ok) {
          toast('info', `课程「${id}」已移除`)
          refresh()
        } else {
          toast('bad', `移除失败：${res.error}`)
        }
      })
    },
    [toast, refresh]
  )

  /** 导入 book-prep-ocr 技能产出的教材资料（Agent 构建课程的素材层）。 */
  const importMaterial = useCallback((): void => {
    void window.api.materialImport().then((res) => {
      if (res.ok) {
        toast(
          'ok',
          `教材资料「${res.data.title}」已导入：${res.data.factsheets.length} 份事实清单 · ${res.data.ocrPageCount} 页转写`
        )
      } else if (res.error !== '已取消导入') {
        toast('bad', `导入失败：${res.error}`)
      }
    })
  }, [toast])

  // 「继续学习」目标：最近学习过的课程，否则最近导入的课程
  const recent =
    courses == null || courses.length === 0
      ? null
      : [...courses].sort((a, b) => {
          const ta = new Date(a.lastStudiedAt ?? a.importedAt).getTime()
          const tb = new Date(b.lastStudiedAt ?? b.importedAt).getTime()
          return tb - ta
        })[0]

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-acc">
            <GraduationCap size={16} className="text-white" />
          </div>
          <span className="text-[14px] font-semibold text-tx">Code Academy Desk</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="AI 助教"
            title="AI 助教"
            onClick={onOpenAgent}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-tx hover:bg-panel-hover"
          >
            <Bot size={16} />
            AI 助教
          </button>
          <button
            type="button"
            aria-label="设置"
            className="flex h-8 w-8 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
          >
            <Settings size={16} />
          </button>
          <button
            type="button"
            aria-label="帮助"
            className="flex h-8 w-8 items-center justify-center rounded-md text-tx2 hover:bg-panel-hover"
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-6">
        {courses == null ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-tx2">
            正在加载课程…
          </div>
        ) : courses.length === 0 ? (
          <EmptyState
            onImportTextbook={() => toast('info', '教材 AI 构建流程将在 P5 提供，敬请期待')}
            onImportPackage={importPackage}
            onCreate={() => toast('info', '手动创建课程将在后续版本提供')}
          />
        ) : (
          <>
            {recent != null && (
              <ContinueBanner course={recent} onContinue={() => onOpenCourse(recent.id, recent.title)} />
            )}

            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold tracking-wide text-tx2">全部课程</span>
              {/* 排序下拉在 P10 学习记录接入后提供 */}
              <span className="text-[12px] text-tx2">排序：最近学习</span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {courses.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  onOpen={() => onOpenCourse(c.id, c.title)}
                  onExport={exportCourse}
                  onRemove={removeCourse}
                />
              ))}
              <button
                type="button"
                onClick={importPackage}
                className="flex h-[216px] flex-col items-center justify-center gap-2.5 rounded-lg border border-line text-tx2 hover:bg-panel-hover"
              >
                <FolderUp size={28} strokeWidth={1.5} />
                <span className="text-[12.5px]">从课程包导入新课程</span>
              </button>
            </div>

            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={onOpenAgent}
                title="在 AI 助教中按技能 course-material-processor 把教材资料构建成课程"
                className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-tx hover:bg-panel-hover"
              >
                <FileUp size={14} className="text-tx2" />
                导入教材 · AI 构建
              </button>
              <button
                type="button"
                onClick={importMaterial}
                className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-tx hover:bg-panel-hover"
              >
                <Library size={14} className="text-tx2" />
                导入教材资料
              </button>
              <button
                type="button"
                onClick={() => toast('info', '手动创建课程将在后续版本提供')}
                className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[13px] text-tx hover:bg-panel-hover"
              >
                <Plus size={14} className="text-tx2" />
                新建课程
              </button>
            </div>
          </>
        )}
      </main>

      <ToastStack toasts={toasts} />
    </div>
  )
}
