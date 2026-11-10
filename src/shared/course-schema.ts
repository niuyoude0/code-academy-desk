import { z } from 'zod'

/**
 * 课程包数据模型（P4 核心资产）。
 * 设计约束（来自需求文档 + book-prep-ocr 产物契约）：
 *  - 课程 → 章节 → 知识点 → 讲义内容 → 习题；
 *  - 内容来源强制标识：原书 / AI 补充 / AI 练习 / 平台，禁止伪装成原书内容；
 *  - 原书内容保留 book-prep-ocr 页码引用（PDF 渲染页号 + 书内印刷页码 + ocr 文件）；
 *  - 习题依赖分组（工作区组）只表达继承关系，组内每题仍拥有独立目录与代码；
 *  - 所有 id 引用（知识点/习题/工作区组）在包级 superRefine 中做完整性校验。
 */

export const COURSE_PACKAGE_SCHEMA_VERSION = '1.0' as const

export const CourseLanguage = z.enum([
  'python',
  'c',
  'java',
  'sql',
  'html',
  'css',
  'javascript',
  'mixed'
])
export type CourseLanguage = z.infer<typeof CourseLanguage>

export const ContentOrigin = z.enum(['book', 'ai-supplement', 'ai-exercise', 'platform'])
export type ContentOrigin = z.infer<typeof ContentOrigin>

/** book-prep-ocr 页码引用：pdfPage=渲染页号，bookPage=书内印刷页码（来自 meta.json 页偏移表）。 */
export const BookPageRef = z.object({
  pdfPage: z.number().int().positive(),
  bookPage: z.number().int().nullable(),
  ocrFile: z
    .string()
    .regex(/^ocr\/[\w\-./]+\.md$/)
    .optional()
})
export type BookPageRef = z.infer<typeof BookPageRef>

export const ContentSource = z.object({
  origin: ContentOrigin,
  bookPageRefs: z.array(BookPageRef).max(500).default([]),
  note: z.string().max(2000).optional()
})
export type ContentSource = z.infer<typeof ContentSource>

/** 代码文件（初始模板 / 参考答案通用）。path 必须为工作区内相对路径。 */
export const CodeFile = z.object({
  path: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[\w\-][\w\-. /]*$/, '工作区内相对路径'),
  content: z.string().max(512 * 1024),
  language: z.string().max(40).optional(),
  readOnly: z.boolean().default(false)
})
export type CodeFile = z.infer<typeof CodeFile>

export const TestCase = z.object({
  id: z.string().regex(/^[\w\-]+$/).max(80),
  name: z.string().min(1).max(200),
  input: z.string().max(64 * 1024).default(''),
  expectedOutput: z.string().max(64 * 1024),
  /** 区分教材提供的测试 / 平台自带测试 / AI 生成测试 */
  source: z.enum(['book', 'platform', 'ai']).default('platform')
})
export type TestCase = z.infer<typeof TestCase>

export const Exercise = z.object({
  id: z.string().regex(/^[\w\-]+$/).max(80),
  /** 原书题号，如 "4.3" */
  number: z.string().max(50).optional(),
  title: z.string().min(1).max(300),
  /** 题面 markdown */
  statement: z.string().max(256 * 1024),
  source: ContentSource,
  knowledgePointIds: z.array(z.string().max(80)).max(100).default([]),
  starterFiles: z.array(CodeFile).max(100).default([]),
  tests: z.array(TestCase).max(200).default([]),
  referenceSolution: z.array(CodeFile).max(100).default([]),
  /** 归属工作区组（若该题与组内前序题存在代码继承关系） */
  workspaceGroupId: z.string().max(80).optional()
})
export type Exercise = z.infer<typeof Exercise>

/** 工作区组：exerciseIds 有序（前序 → 后序）；分组理由（AI 给出）允许用户调整。 */
export const WorkspaceGroup = z.object({
  id: z.string().regex(/^[\w\-]+$/).max(80),
  title: z.string().max(300).optional(),
  reason: z.string().max(2000).optional(),
  exerciseIds: z.array(z.string().max(80)).min(2).max(200)
})
export type WorkspaceGroup = z.infer<typeof WorkspaceGroup>

export const KnowledgePoint = z.object({
  id: z.string().regex(/^[\w\-]+$/).max(80),
  title: z.string().min(1).max(300),
  /** 讲义 markdown；图片等资源以 assets/ 相对路径引用 */
  content: z.string().max(1024 * 1024),
  source: ContentSource,
  order: z.number().int().nonnegative()
})
export type KnowledgePoint = z.infer<typeof KnowledgePoint>

export const Chapter = z.object({
  id: z.string().regex(/^[\w\-]+$/).max(80),
  title: z.string().min(1).max(300),
  order: z.number().int().nonnegative(),
  source: ContentSource,
  knowledgePoints: z.array(KnowledgePoint).max(500).default([]),
  exercises: z.array(Exercise).max(1000).default([])
})
export type Chapter = z.infer<typeof Chapter>

export const CourseMeta = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9\-]*$/).max(80),
  title: z.string().min(1).max(300),
  bookTitle: z.string().max(300).optional(),
  bookAuthors: z.string().max(300).optional(),
  language: CourseLanguage,
  description: z.string().max(4000).optional(),
  /** book-prep-ocr 产物来源：factsheet 清单与页偏移等元数据原样保留 */
  ocrSource: z
    .object({
      factsheets: z.array(z.string().max(300)).max(500).default([]),
      metaJson: z.record(z.string(), z.unknown()).optional()
    })
    .optional()
})
export type CourseMeta = z.infer<typeof CourseMeta>

export const CoursePackageBase = z.object({
  schemaVersion: z.literal('1.0'),
  course: CourseMeta,
  chapters: z.array(Chapter).min(1).max(200),
  workspaceGroups: z.array(WorkspaceGroup).max(500).default([])
})

/** 包级引用完整性校验：知识点/习题/工作区组之间不允许悬空引用。 */
export const CoursePackage = CoursePackageBase.superRefine((pkg, ctx) => {
  const kpIds = new Set<string>()
  const exIds = new Set<string>()
  for (const ch of pkg.chapters) {
    for (const kp of ch.knowledgePoints) {
      if (kpIds.has(kp.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `知识点 id 重复: ${kp.id}`,
          path: ['chapters', 'knowledgePoints']
        })
      }
      kpIds.add(kp.id)
    }
    for (const ex of ch.exercises) {
      if (exIds.has(ex.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `习题 id 重复: ${ex.id}`,
          path: ['chapters', 'exercises']
        })
      }
      exIds.add(ex.id)
    }
  }
  const groupIds = new Set(pkg.workspaceGroups.map((g) => g.id))
  for (const ch of pkg.chapters) {
    for (const ex of ch.exercises) {
      for (const kpId of ex.knowledgePointIds) {
        if (!kpIds.has(kpId)) {
          ctx.addIssue({
            code: 'custom',
            message: `习题 ${ex.id} 引用了不存在的知识点: ${kpId}`,
            path: ['chapters', 'exercises', ex.id, 'knowledgePointIds']
          })
        }
      }
      if (ex.workspaceGroupId != null && !groupIds.has(ex.workspaceGroupId)) {
        ctx.addIssue({
          code: 'custom',
          message: `习题 ${ex.id} 引用了不存在的工作区组: ${ex.workspaceGroupId}`,
          path: ['chapters', 'exercises', ex.id, 'workspaceGroupId']
        })
      }
    }
  }
  for (const g of pkg.workspaceGroups) {
    for (const exId of g.exerciseIds) {
      if (!exIds.has(exId)) {
        ctx.addIssue({
          code: 'custom',
          message: `工作区组 ${g.id} 引用了不存在的习题: ${exId}`,
          path: ['workspaceGroups', g.id, 'exerciseIds']
        })
      }
    }
  }
})
export type CoursePackage = z.infer<typeof CoursePackage>
/** 解析前的输入类型（带 default 的字段可选），供导入/测试构造原始对象使用。 */
export type CoursePackageInput = z.input<typeof CoursePackage>

/* ===== IPC DTO（服务层与渲染层共用） ===== */

export interface ImportResult {
  courseId: string
  title: string
  chapterCount: number
  exerciseCount: number
  workspaceGroupCount: number
}

export interface CourseIndexEntry {
  id: string
  title: string
  language: string
  chapterCount: number
  exerciseCount: number
  importedAt: string
  lastStudiedAt?: string
  /** v2 课程包带格式版本与审核进度（v1 条目缺省） */
  schemaVersion?: string
  reviewApproved?: number
  reviewTotal?: number
}
