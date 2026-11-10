import { ChevronRight } from 'lucide-react'
import type { CourseIndexEntry } from '../../../shared/course-schema'
import { langStyle, timeAgo } from '../lib/langStyle'

interface Props {
  course: CourseIndexEntry
  onContinue: (id: string) => void
}

/**
 * 「继续学习」区（2026-11-11 用户拍板：弃 200px 大横幅，改文档流轻强调块——
 * 浅蓝底纹（豆包 callout 式），大标题 + 元信息 + 主按钮，一行直达）。
 */
export function ContinueBanner({ course, onContinue }: Props): React.JSX.Element {
  const style = langStyle(course.language)
  const Icon = style.icon
  return (
    <section>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tx2">继续学习</div>
      <div className="mt-3 flex items-center gap-4 rounded-lg bg-acc/8 px-5 py-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md"
          style={{ background: `color-mix(in srgb, ${style.from} 14%, #ffffff)` }}
        >
          <Icon size={22} style={{ color: style.from }} strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold text-tx">{course.title}</div>
          <div className="mt-0.5 text-[12.5px] text-tx2">
            {course.chapterCount} 章 · {course.exerciseCount} 题 ·{' '}
            {course.lastStudiedAt != null ? `上次学习 ${timeAgo(course.lastStudiedAt)}` : `导入于 ${timeAgo(course.importedAt)}`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onContinue(course.id)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-acc px-3.5 text-[13px] font-medium text-white hover:bg-acc-hover"
        >
          进入课程
          <ChevronRight size={14} />
        </button>
      </div>
    </section>
  )
}
