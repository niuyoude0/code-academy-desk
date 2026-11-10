import { useEffect, useRef, useState } from 'react'
import { Ellipsis, Trash2, FileDown } from 'lucide-react'
import type { CourseIndexEntry } from '../../../shared/course-schema'
import { langStyle, timeAgo } from '../lib/langStyle'

interface Props {
  course: CourseIndexEntry
  /** 点击行打开学习路径页（菜单操作会阻断冒泡） */
  onOpen?: () => void
  onExport: (id: string) => void
  onRemove: (id: string) => void
}

/**
 * 全部课程列表中的单行（2026-11-11 用户拍板：弃卡片网格，IDEA 欢迎页式列表行）。
 * 语言图标用浅色底 + 品牌色前景；操作按钮 hover 才露出。
 */
export function CourseRow({ course, onOpen, onExport, onRemove }: Props): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const style = langStyle(course.language)
  const Icon = style.icon

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent): void => {
      if (menuRef.current != null && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setConfirmRemove(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <div
      className="group flex cursor-pointer items-center gap-3.5 rounded-md px-3 py-3 transition-colors hover:bg-panel-hover"
      onClick={() => onOpen?.()}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: `color-mix(in srgb, ${style.from} 12%, #ffffff)` }}
      >
        <Icon size={18} style={{ color: style.from }} strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-tx">{course.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-tx2">
          <span className="font-mono text-[10.5px] uppercase tracking-wide">{style.label}</span>
          <span className="text-tx2/40">·</span>
          <span>
            {course.chapterCount} 章 · {course.exerciseCount} 题
          </span>
          <span className="text-tx2/40">·</span>
          <span>
            {course.lastStudiedAt != null ? `上次学习 ${timeAgo(course.lastStudiedAt)}` : `导入于 ${timeAgo(course.importedAt)}`}
          </span>
        </div>
      </div>
      <div className="relative shrink-0 opacity-0 transition-opacity group-hover:opacity-100" ref={menuRef}>
        <button
          type="button"
          aria-label="课程操作"
          className="rounded p-1.5 text-tx2 hover:bg-panel-hover"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
            setConfirmRemove(false)
          }}
        >
          <Ellipsis size={16} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-8 z-20 w-40 rounded-md border border-line bg-bg py-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-tx hover:bg-panel-hover"
              onClick={() => {
                setMenuOpen(false)
                onExport(course.id)
              }}
            >
              <FileDown size={14} className="text-tx2" /> 导出课程包
            </button>
            {confirmRemove ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 bg-bad/10 px-3 py-1.5 text-left text-[13px] text-bad hover:bg-bad/20"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmRemove(false)
                  onRemove(course.id)
                }}
              >
                <Trash2 size={14} /> 确认移除？
              </button>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-tx hover:bg-panel-hover"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 size={14} className="text-bad" /> 移除课程
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
