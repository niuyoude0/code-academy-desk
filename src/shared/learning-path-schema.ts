import { z } from 'zod'

/**
 * P5.3a 知识点驱动学习路径（架构修订 2026-11-10，用户六原则拍板）：
 *  - path.json     学习路径 = 有序知识点表（factsheet 知识点清单直译），课件按 KP 独立持久化
 *  - progress.json 学习进度 = 逐 KP 状态 + digest 摘要链（上下文连续），允许跳过（skipped）
 *  - 解锁规则（应用侧执行）：线性 + 可回溯 + 可跳过；完成判定 quiz≥2/3 且编程题通过，可强制继续
 *  - 与 manifest.json 分工：manifest 是「书的结构」（章分组），path 是「学的顺序」
 */

const IdField = z.string().regex(/^[\w\-]+$/).max(80)
const LessonFileField = z.string().regex(/^chapters\/[\w\-]+\/[\w\-]+\.json$/).max(200)

export const PATH_FILE = 'path.json'
export const PROGRESS_FILE = 'progress.json'

/** factsheet「适合交互 强/中/弱」直译 */
export const KP_INTERACTIVITY = ['strong', 'medium', 'weak'] as const
export type KpInteractivity = (typeof KP_INTERACTIVITY)[number]

/** path.json 条目：结构 + 生成状态（内容质量轴仍在 review.json） */
export const PathEntrySchema = z.object({
  id: IdField,
  chapterId: IdField,
  title: z.string().min(1).max(300),
  /** 书内页码（factsheet 知识点清单自带） */
  bookPage: z.number().int().optional(),
  interactivity: z.enum(KP_INTERACTIVITY).optional(),
  /** 生成状态：pending 未生成 / ready 课件就绪 / failed 生成失败（错误在 review.json） */
  genStatus: z.enum(['pending', 'ready', 'failed']).default('pending'),
  /** 生成后回填（lessonId = KP id，即 chapters/<ch>/<kpId>.json） */
  lessonFile: LessonFileField.optional(),
  /** 生成失败时的简要原因（详情走 review.json feedback） */
  genError: z.string().max(2000).optional()
})
export type PathEntry = z.infer<typeof PathEntrySchema>

export const PathFileSchema = z.object({
  schemaVersion: z.literal('2.0'),
  courseId: IdField,
  updatedAt: z.string().min(4).max(40),
  /** 学习顺序 = 数组顺序 */
  kps: z.array(PathEntrySchema).min(1).max(1000)
})
export type PathFile = z.infer<typeof PathFileSchema>

/** progress.json 条目：学习状态轴（无条目 = 未开始/锁定） */
export const ProgressKpEntrySchema = z.object({
  kpId: IdField,
  state: z.enum(['learning', 'completed', 'skipped']),
  /** 未达判定门槛强制继续（应急门） */
  forced: z.boolean().optional(),
  /** 最近一次 quiz 成绩 '答对/总题数' */
  quizBest: z.string().regex(/^\d+\/\d+$/).max(10).optional(),
  /** 编程题 DSH 执行判定结果（null/缺省 = 该 KP 无编程题） */
  codingPassed: z.boolean().optional(),
  completedAt: z.string().min(4).max(40).optional(),
  /** digest 摘要（completed 时应有；skipped 留空 = digest 链空缺提示） */
  digest: z
    .object({
      core: z.string().min(1).max(500),
      takeaway: z.string().min(1).max(500)
    })
    .optional()
})
export type ProgressKpEntry = z.infer<typeof ProgressKpEntrySchema>

export const ProgressFileSchema = z.object({
  schemaVersion: z.literal('2.0'),
  courseId: IdField,
  updatedAt: z.string().min(4).max(40),
  /** 当前学习位置（锁定规则以它为锚；缺省 = 路径起点） */
  currentKpId: IdField.optional(),
  kps: z.array(ProgressKpEntrySchema).max(1000).default([])
})
export type ProgressFile = z.infer<typeof ProgressFileSchema>

/** 生成任务拿到的上下文包（已完成 digest 链 + 跳过空缺 + 预告） */
export interface KpLearningContext {
  kpId: string
  title: string
  chapterId: string
  bookPage?: number
  interactivity?: KpInteractivity
  /** 前序 KP 的 digest（path 顺序；skipped 的以 gap 形式占位） */
  preceding: { kpId: string; title: string; gap?: true; core?: string; takeaway?: string }[]
  /** 下一 KP 标题（结尾预告用；已是最后一个则为 null） */
  nextKpTitle: string | null
}
