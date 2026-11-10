import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import { getManifestV2 } from './coursePackageV2'
import { getPath, getProgress } from './learningPath'
import { validateLessonDocument, type LessonBlock } from '../../shared/lesson-schema'
import { checkLessonCapacity, countLessonWords } from '../../shared/lesson-quality'

/**
 * P5.2.5 课程统计（插件 cad_course_stats 实现，只读聚合）：
 *  - 一次返回章/KP/生成状态/学习进度/块型分布/正文字数——汇报与任务进度播报的数据源
 *  - 纯 Node 实现，插件构建时同源打包
 */

export interface CourseStats {
  courseId: string
  title: string
  chapters: number
  lessons: number
  path: { total: number; gen: Record<string, number> } | null
  progress: { currentKpId: string | null; states: Record<string, number> } | null
  blocks: Record<string, number>
  words: number
  /** 逐课件校验不通过的文件（正常应为空） */
  invalidLessons: string[]
}

export async function getCourseStats(coursesRoot: string, courseId: string): Promise<CourseStats> {
  const manifest = await getManifestV2(coursesRoot, courseId)
  const stats: CourseStats = {
    courseId: manifest.id,
    title: manifest.title,
    chapters: manifest.chapters.length,
    lessons: manifest.chapters.reduce((n, c) => n + c.lessons.length, 0),
    path: null,
    progress: null,
    blocks: {},
    words: 0,
    invalidLessons: []
  }

  try {
    const p = await getPath(coursesRoot, courseId)
    const gen: Record<string, number> = {}
    for (const k of p.kps) gen[k.genStatus] = (gen[k.genStatus] ?? 0) + 1
    stats.path = { total: p.kps.length, gen }
  } catch {
    /* 无 path.json（纯 v2 包）不报错 */
  }

  try {
    const pg = await getProgress(coursesRoot, courseId)
    const states: Record<string, number> = {}
    for (const k of pg.kps) states[k.state] = (states[k.state] ?? 0) + 1
    stats.progress = { currentKpId: pg.currentKpId ?? null, states }
  } catch {
    /* 无 progress.json 不报错 */
  }

  const chaptersDir = path.join(coursesRoot, courseId, 'chapters')
  if (existsSync(chaptersDir)) {
    for (const chapterId of await fs.readdir(chaptersDir)) {
      const chDir = path.join(chaptersDir, chapterId)
      if (!(await fs.stat(chDir)).isDirectory()) continue
      for (const f of (await fs.readdir(chDir)).filter((x) => x.endsWith('.json'))) {
        const file = path.join(chapterId, f)
        let raw: unknown
        try {
          raw = JSON.parse(await fs.readFile(path.join(chDir, f), 'utf-8'))
        } catch {
          stats.invalidLessons.push(file)
          continue
        }
        const v = validateLessonDocument(raw)
        if (!v.ok) {
          stats.invalidLessons.push(file)
          continue
        }
        const blocks = ((raw as { blocks?: unknown }).blocks ?? []) as LessonBlock[]
        stats.words += countLessonWords(blocks)
        for (const b of blocks) stats.blocks[b.type] = (stats.blocks[b.type] ?? 0) + 1
        const cap = checkLessonCapacity(blocks)
        if (!cap.ok) stats.invalidLessons.push(`${file}（容量 warn: ${cap.warns.map((w) => w.code).join('/')}）`)
      }
    }
  }
  return stats
}

