import type { LucideIcon } from 'lucide-react'
import {
  Terminal,
  Database,
  FlaskConical,
  Coffee,
  Globe,
  Layers
} from 'lucide-react'

/** 课程语言 → JetBrains 风格的渐变封面与图标（与 design/home.pen 一致）。 */
export interface LangStyle {
  label: string
  from: string
  to: string
  icon: LucideIcon
}

const STYLES: Record<string, LangStyle> = {
  c: { label: 'C', from: '#3574F0', to: '#1E3A8A', icon: Terminal },
  sql: { label: 'SQL', from: '#0EA5A5', to: '#134E4A', icon: Database },
  python: { label: 'PYTHON', from: '#D97706', to: '#7C2D12', icon: FlaskConical },
  java: { label: 'JAVA', from: '#EF4444', to: '#7F1D1D', icon: Coffee },
  html: { label: 'HTML', from: '#8B5CF6', to: '#4C1D95', icon: Globe },
  css: { label: 'CSS', from: '#8B5CF6', to: '#4C1D95', icon: Globe },
  javascript: { label: 'JAVASCRIPT', from: '#8B5CF6', to: '#4C1D95', icon: Globe },
  mixed: { label: 'MIXED', from: '#64748B', to: '#334155', icon: Layers }
}

export function langStyle(language: string): LangStyle {
  return STYLES[language] ?? STYLES.mixed
}

/** ISO 时间 → 「x 天前」式相对时间。 */
export function timeAgo(iso: string | undefined): string {
  if (iso == null) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day} 天前`
  const week = Math.floor(day / 7)
  if (week < 5) return `${week} 周前`
  const month = Math.floor(day / 30)
  return `${month} 个月前`
}
