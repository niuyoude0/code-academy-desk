import { Bookmark, ChevronRight } from 'lucide-react'
import type { CourseIndexEntry } from '../../../shared/course-schema'
import { langStyle, timeAgo } from '../lib/langStyle'

interface Props {
  course: CourseIndexEntry
  onContinue: (id: string) => void
}

/** 「继续学习」主视觉横幅（对应 design/home.pen 的 ContinueBanner）。 */
export function ContinueBanner({ course, onContinue }: Props): React.JSX.Element {
  const style = langStyle(course.language)
  const Icon = style.icon
  return (
    <div className="flex h-[200px] overflow-hidden rounded-lg border border-line bg-panel">
      <div
        className="flex w-[300px] shrink-0 flex-col items-center justify-center gap-3"
        style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
      >
        <Icon size={44} className="text-white/90" strokeWidth={1.5} />
        <span className="font-mono text-[11px] tracking-[0.2em] text-white/80">
          {style.label} · {course.chapterCount} CHAPTERS
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-5">
        <div className="flex items-center justify-between">
          <span className="truncate text-[17px] font-semibold text-tx">{course.title}</span>
          <button
            type="button"
            onClick={() => onContinue(course.id)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-acc px-3.5 text-[13px] font-medium text-white hover:bg-acc-hover"
          >
            继续学习
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="text-[12px] text-tx2">
          {course.chapterCount} 章 · {course.exerciseCount} 题 · 导入于 {timeAgo(course.importedAt)}
        </div>
        <div className="flex items-center gap-1.5">
          <Bookmark size={14} className="text-acc" />
          <span className="text-[12.5px] text-tx">
            {course.lastStudiedAt != null
              ? `上次学习 ${timeAgo(course.lastStudiedAt)}`
              : '尚未开始学习，进入课程选择章节与习题'}
          </span>
        </div>
        {/* P10 学习记录接线后填充真实进度 */}
        <div className="mt-auto flex flex-col gap-1.5">
          <div className="h-[5px] w-full rounded-full bg-track" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-tx2">总体学习进度</span>
            <span className="font-mono text-[11px] font-semibold text-acc">0%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
