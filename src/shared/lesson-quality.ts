import type { LessonBlock } from './lesson-schema'

/**
 * 课件容量硬标准机检（P5.3b quality-standard 的机器可执行版）：
 *  - schema/铁律归 validateLessonDocument（error 级）；本模块只产 warn 级容量报告
 *  - 插件 cad_validate_course_blocks 与（未来的）校对页共用本文件，单一事实来源
 */

export interface CapacityWarning {
  code: string
  message: string
}

export interface CapacityReport {
  ok: boolean
  words: number
  counts: { quiz: number; example: number; visual: number; interactive: number; blocks: number }
  warns: CapacityWarning[]
}

/** 容量阈值（quality-standard.md 与本文件同步改） */
export const CAPACITY_RULES = {
  minWords: 2500,
  minQuiz: 3,
  minExample: 2,
  minVisual: 1,
  maxInteractive: 1
} as const

/** 文本量估算：CJK 字符逐个计 + 拉丁词按空边界计。 */
export function countTextWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length
  const latin = (text.match(/[A-Za-z0-9]+(?:[''._-][A-Za-z0-9]+)*/g) ?? []).length
  return cjk + latin
}

function mdishStrings(block: LessonBlock): string[] {
  switch (block.type) {
    case 'text':
    case 'concept':
    case 'definition':
    case 'callout':
    case 'quote':
      return [block.md]
    case 'theorem':
      return [block.md, ...(block.proof != null ? [block.proof] : [])]
    case 'keypoint':
      return [block.front, block.back]
    case 'thinking':
      return [block.md, ...(block.hint != null ? [block.hint] : [])]
    case 'example':
      return block.steps.map((s) => s.md)
    case 'compare':
      return [block.title, ...block.columns, ...block.rows.flatMap((r) => [r.label, ...r.cells])]
    case 'table':
      return [block.md]
    case 'timeline':
      return block.items.map((i) => `${i.label} ${i.md}`)
    case 'formula-list':
      return block.items.map((i) => `${i.name} ${i.note ?? ''}`)
    case 'summary':
      return block.points
    default:
      return []
  }
}

/** 课件正文文本量（不含 code/latex/math/图表源码——它们是正文之外的密度）。 */
export function countLessonWords(blocks: readonly LessonBlock[]): number {
  let total = 0
  for (const b of blocks) total += mdishStrings(b).reduce((n, s) => n + countTextWords(s), 0)
  return total
}

/** 课件容量硬标准检查（只报 warn，不判生死）。 */
export function checkLessonCapacity(blocks: readonly LessonBlock[]): CapacityReport {
  const counts = {
    quiz: blocks.filter((b) => b.type === 'quiz').length,
    example: blocks.filter((b) => b.type === 'example').length,
    visual: blocks.filter((b) => b.type === 'diagram' || b.type === 'chart' || b.type === 'anim' || b.type === 'interactive').length,
    interactive: blocks.filter((b) => b.type === 'interactive').length,
    blocks: blocks.length
  }
  const words = countLessonWords(blocks)
  const warns: CapacityWarning[] = []
  if (words < CAPACITY_RULES.minWords) {
    warns.push({ code: 'words', message: `正文字数 ${words} < ${CAPACITY_RULES.minWords}（代码/公式/图表不计入）` })
  }
  if (counts.quiz < CAPACITY_RULES.minQuiz) {
    warns.push({ code: 'quiz', message: `quiz ${counts.quiz} 个 < ${CAPACITY_RULES.minQuiz} 个` })
  }
  if (counts.example < CAPACITY_RULES.minExample) {
    warns.push({ code: 'example', message: `example ${counts.example} 个 < ${CAPACITY_RULES.minExample} 个（至少 1 个反例/踩坑向）` })
  }
  if (counts.visual < CAPACITY_RULES.minVisual) {
    warns.push({ code: 'visual', message: '可视化块（diagram/chart/anim/interactive）至少 1 个' })
  }
  if (counts.interactive > CAPACITY_RULES.maxInteractive) {
    warns.push({ code: 'interactive', message: `interactive ${counts.interactive} 个 > ${CAPACITY_RULES.maxInteractive} 个（能不用就不用）` })
  }
  // quiz 答案与选项对应性（choice）
  for (const b of blocks) {
    if (b.type === 'quiz' && b.kind === 'choice' && b.options != null) {
      const keys = new Set(b.options.map((o) => o.key))
      const answers = b.answer.split(',').map((s) => s.trim())
      for (const a of answers) {
        if (!keys.has(a)) {
          warns.push({ code: 'quiz-answer', message: `${b.id}: answer "${a}" 不在选项 key（${[...keys].join('/')}）中` })
        }
      }
    }
  }
  return { ok: warns.length === 0, words, counts, warns }
}
