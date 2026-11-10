import { z } from 'zod'
import { Exercise } from './course-schema'

/**
 * P5.2 课程包 v2 结构（架构决策 2026-11-10）：
 *  - 目录：manifest.json / course 内容（chapters/*.json、exercises/*.json）/ assets/ / review.json
 *  - 原始教材永不复制进包：sourceRef 指向 userData/materials/<materialId>
 *  - manifest 记录生成信息（模型/技能版本），支持局部重生成与格式升级
 */

export const COURSE_SCHEMA_VERSION_V2 = '2.0'

const IdField = z.string().regex(/^[\w\-]+$/).max(80)

export const SourceRefSchema = z.object({
  /** userData/materials/<materialId>（教材原样存层） */
  materialId: IdField,
  factsheets: z.array(z.string().max(200)).max(200).default([]),
  pageOffsets: z
    .array(z.object({ section: z.string().max(80).optional(), offset: z.number().int() }))
    .max(200)
    .default([])
})
export type SourceRef = z.infer<typeof SourceRefSchema>

export const GenerationInfoSchema = z.object({
  model: z.string().max(100).optional(),
  skillVersion: z.string().max(40).optional(),
  lastRunAt: z.string().max(40).optional()
})
export type GenerationInfo = z.infer<typeof GenerationInfoSchema>

export const LessonRefSchema = z.object({
  lessonId: IdField,
  title: z.string().min(1).max(300),
  /** 相对课程包根的 posix 路径：chapters/<ch>/<lessonId>.json */
  file: z.string().regex(/^chapters\/[\w\-]+\/[\w\-]+\.json$/).max(200)
})
export type LessonRef = z.infer<typeof LessonRefSchema>

export const ChapterNodeV2Schema = z.object({
  id: IdField,
  title: z.string().min(1).max(300),
  lessons: z.array(LessonRefSchema).max(100).default([])
})
export type ChapterNodeV2 = z.infer<typeof ChapterNodeV2Schema>

export const CourseManifestV2Schema = z.object({
  schemaVersion: z.literal(COURSE_SCHEMA_VERSION_V2),
  id: IdField,
  title: z.string().min(1).max(300),
  language: z.string().max(30).default('mixed'),
  description: z.string().max(4000).optional(),
  createdAt: z.string().min(4).max(40),
  updatedAt: z.string().min(4).max(40),
  sourceRef: SourceRefSchema.optional(),
  generation: GenerationInfoSchema.optional(),
  chapters: z.array(ChapterNodeV2Schema).max(200).default([])
})
export type CourseManifestV2 = z.infer<typeof CourseManifestV2Schema>

/** exercises/ex-*.json 的内容 = v1 Exercise 结构原样复用（题面/起步文件/测试/参考解/来源）。 */
export const ExerciseDocumentSchema = Exercise
export type ExerciseDocument = Exercise

/** v2 课程 zip 的顶层清单文件名（与 v1 的 course-package.json 区分）。 */
export const MANIFEST_V2_FILE = 'manifest.json'
