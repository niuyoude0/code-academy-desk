import { useEffect, useRef, useState } from 'react'
import { Ellipsis, Trash2, FileDown } from 'lucide-react'
import type { CourseIndexEntry } from '../../../shared/course-schema'
import { langStyle, timeAgo } from '../lib/langStyle'

interface Props {
  course: CourseIndexEntry
  /** 点击卡片打开学习路径页（菜单操作会阻断冒泡） */
  onOpen?: () => void
  onExport: (id: string) => void
  onRemove: (id: string) => void
}

/** 全部课程网格中的单张课程卡（对应 design/home.pen 的 Card-*）。 */
export function CourseCard({ course, onOpen, onExport, onRemove }: Props): React.JSX.Element {
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
      className="flex h-[216px] cursor-pointer flex-col overflow-hidden rounded-lg border border-line bg-panel transition-colors hover:border-acc/60"
      onClick={() => onOpen?.()}
    >
      <div
        className="flex h-16 items-center gap-2.5 px-4"
        style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
      >
        <Icon size={24} className="text-white/95" strokeWidth={1.8} />
        <span className="font-mono text-[10px] tracking-[0.15em] text-white/85">
          {style.label}
        </span>
      </div>
      <div className="relative flex flex-1 flex-col gap-1.5 p-3.5">
        <div className="flex items-center justify-between">
          <span className="truncate text-[13.5px] font-semibold text-tx">{course.title}</span>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="课程操作"
              className="rounded p-1 text-tx2 hover:bg-panel-hover"
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
                className="absolute right-0 top-7 z-20 w-40 rounded-md border border-line bg-panel py-1 shadow-xl"
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
                    className="flex w-full items-center gap-2 bg-[#3a2426] px-3 py-1.5 text-left text-[13px] text-bad hover:bg-[#4a2b2e]"
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
        {/* P10 学习记录接线后填充真实进度 */}
        <div className="h-[4px] w-full rounded-full bg-track" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-tx2">
            {course.chapterCount} 章 · {course.exerciseCount} 题
          </span>
          <span className="font-mono text-[11px] font-semibold text-tx2">未开始</span>
        </div>
        <span className="text-[11px] text-tx2">
          {course.lastStudiedAt != null
            ? `上次学习 ${timeAgo(course.lastStudiedAt)}`
            : `导入于 ${timeAgo(course.importedAt)}`}
        </span>
      </div>
    </div>
  )
}
