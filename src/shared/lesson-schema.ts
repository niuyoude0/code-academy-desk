import { z } from 'zod'
import { BookPageRef } from './course-schema'

/**
 * P5.1 课件块 Schema v2（架构决策 2026-11-10，D1/D2 用户已拍板）：
 *  - 所有课程内容 = 可校验的 LessonBlock 联合类型（22 类），禁止自由 HTML
 *  - 每块必有稳定 id；origin='book' 强制携带页码引用（superRefine）
 *  - interactive 块 = AI 生成的 React 组件源码（D2：无沙箱、Node 全能力、靠 Skill 约束 + 人工审核）
 *  - 校验器与渲染器共用本文件，单一事实来源
 */

export const BLOCK_ORIGIN = ['book', 'ai-supplement'] as const
export type BlockOrigin = (typeof BLOCK_ORIGIN)[number]

const BlockBaseShape = {
  /** 稳定 ID（局部重生成/进度记录/知识点关联都用它） */
  id: z.string().min(1).max(64),
  origin: z.enum(BLOCK_ORIGIN),
  /** 教材出处（origin='book' 时必填，LessonSchema superRefine 强制） */
  source: BookPageRef.optional()
}

const Md = z.string().max(200_000)

/* ===== 文本与知识类 ===== */

export const TextBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('text'),
  /** markdown（KaTeX 行内公式 + 代码高亮由渲染器处理） */
  md: Md
})

export const ConceptBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('concept'),
  title: z.string().min(1).max(200),
  md: Md,
  tags: z.array(z.string().max(40)).max(12).optional()
})

export const DefinitionBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('definition'),
  term: z.string().min(1).max(200),
  md: Md
})

export const TheoremBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('theorem'),
  name: z.string().max(200).optional(),
  md: Md,
  proof: Md.optional()
})

export const MathBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('math'),
  latex: z.string().min(1).max(10_000),
  block: z.boolean().optional()
})

export const CalloutBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('callout'),
  kind: z.enum(['note', 'warning', 'pitfall']),
  md: Md
})

export const QuoteBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('quote'),
  /** 教材原文摘录——页码铁律的主要载体 */
  md: Md,
  attribution: z.string().max(200).optional()
})

export const KeypointBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('keypoint'),
  /** 要点卡（可转闪卡） */
  front: Md,
  back: Md
})

export const ThinkingBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('thinking'),
  md: Md,
  hint: Md.optional()
})

export const ExampleBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('example'),
  title: z.string().min(1).max(200),
  steps: z.array(z.object({ md: Md })).min(1).max(50)
})

export const CompareBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('compare'),
  title: z.string().max(200),
  columns: z.array(z.string().max(80)).min(2).max(6),
  rows: z
    .array(
      z.object({
        label: z.string().max(120),
        cells: z.array(Md).min(2).max(6)
      })
    )
    .max(30)
})

export const TableBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('table'),
  caption: z.string().max(200).optional(),
  /** markdown 表格文本 */
  md: Md
})

export const TimelineBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('timeline'),
  items: z
    .array(
      z.object({
        label: z.string().max(120),
        md: Md
      })
    )
    .min(2)
    .max(40)
})

export const FormulaListBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('formula-list'),
  items: z
    .array(
      z.object({
        name: z.string().max(120),
        latex: z.string().min(1).max(5_000),
        note: Md.optional()
      })
    )
    .min(1)
    .max(60)
})

export const ImageBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('image'),
  /** 课程包内相对路径（assets/） */
  path: z.string().min(1).max(300),
  alt: z.string().max(300)
})

export const SummaryBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('summary'),
  points: z.array(Md).min(1).max(30),
  /** 知识点关联（其他块 id） */
  links: z.array(z.string().max(64)).max(50).optional()
})

/* ===== 代码类 ===== */

export const CodeBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('code'),
  language: z.string().min(1).max(30),
  code: z.string().min(1).max(100_000),
  /** 可提交 Runner 执行（P8 就绪前仅展示） */
  runnable: z.boolean().optional()
})

/* ===== 图形与可视化 ===== */

export const DiagramBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('diagram'),
  engine: z.literal('mermaid'),
  /** mermaid 文本（不能用 source——与 BlockBase.source 页码引用冲突） */
  mermaid: z.string().min(1).max(50_000)
})

/** ECharts option：纯 JSON（渲染器 setOption，零回调约定） */
export const ChartBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('chart'),
  echartsOption: z.record(z.string(), z.unknown())
})

/** 动画帧：数据驱动 DSL（模板渲染，AI 不产代码） */
export const AnimFrameSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  pointers: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  highlight: z.array(z.union([z.number(), z.string()])).optional(),
  note: z.string().max(2_000).optional()
})

export const AnimBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('anim'),
  template: z.enum(['array', 'stack', 'queue', 'linkedList', 'tree', 'graph', 'hashTable', 'matrix']),
  title: z.string().max(200).optional(),
  frames: z.array(AnimFrameSchema).min(2).max(500)
})

/* ===== 练习类 ===== */

export const QuizBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('quiz'),
  kind: z.enum(['choice', 'blank']),
  question: Md,
  /** choice 必填（superRefine） */
  options: z
    .array(
      z.object({
        key: z.string().min(1).max(4),
        text: Md
      })
    )
    .max(8)
    .optional(),
  /** choice: 选项 key（多选用逗号分隔）；blank: 参考答案文本 */
  answer: z.string().min(1).max(2_000),
  explanation: Md.optional()
})

/** 编程题：引用 exercises/ex-*.json（跨文件引用由课程包级校验） */
export const CodingBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('coding'),
  exerciseId: z.string().min(1).max(64)
})

/**
 * interactive 桥接白名单（2026-11-10 选型确认，见 design/renderer-libs-survey.md）：
 * - react: React 内置 hook/组件          - echarts: 按需注册封装的 <EChart option>
 * - motion: 动画（framer-motion 新包名）  - konva: 2D 画布（react-konva）
 * - xyflow: 节点图/流程图（@xyflow/react） - matter: 2D 物理（matter-js）
 * - three: 3D（@react-three/fiber + drei + rapier）
 * - controls: 统一风格参数控件（Slider/Toggle 等，自封装）
 * - mafs: 数学坐标图（冒烟通过后启用）
 * - fs/system/agent: 宿主能力桥（文件/系统/Agent）
 */
export const BRIDGE_IMPORTS = [
  'react',
  'echarts',
  'motion',
  'konva',
  'xyflow',
  'matter',
  'three',
  'controls',
  'mafs',
  'fs',
  'system',
  'agent'
] as const
export type BridgeImport = (typeof BRIDGE_IMPORTS)[number]

/** D2 决策：AI 生成的 React 交互组件（无沙箱、Node 全能力、Skill 约束 + 人工审核） */
export const InteractiveBlockSchema = z.object({
  ...BlockBaseShape,
  type: z.literal('interactive'),
  title: z.string().min(1).max(200),
  /** TSX 组件源码（默认导出 React 组件；渲染进程编译加载） */
  source: z.string().min(1).max(500_000),
  /** 声明需要的桥（能力清单，供校对页人审展示） */
  bridgeImports: z.array(z.enum(BRIDGE_IMPORTS)).max(BRIDGE_IMPORTS.length).optional()
})

/* ===== 联合类型与校验器 ===== */

export const LessonBlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  ConceptBlockSchema,
  DefinitionBlockSchema,
  TheoremBlockSchema,
  MathBlockSchema,
  CalloutBlockSchema,
  QuoteBlockSchema,
  KeypointBlockSchema,
  ThinkingBlockSchema,
  ExampleBlockSchema,
  CompareBlockSchema,
  TableBlockSchema,
  TimelineBlockSchema,
  FormulaListBlockSchema,
  ImageBlockSchema,
  SummaryBlockSchema,
  CodeBlockSchema,
  DiagramBlockSchema,
  ChartBlockSchema,
  AnimBlockSchema,
  QuizBlockSchema,
  CodingBlockSchema,
  InteractiveBlockSchema
])

export type LessonBlock = z.infer<typeof LessonBlockSchema>

/** 常用单块类型（渲染器分派用）。 */
export type AnimBlock = z.infer<typeof AnimBlockSchema>
export type QuizBlock = z.infer<typeof QuizBlockSchema>
export type CodeBlock = z.infer<typeof CodeBlockSchema>
export type MathBlock = z.infer<typeof MathBlockSchema>
export type InteractiveBlock = z.infer<typeof InteractiveBlockSchema>

export const LessonSchema = z.object({
  /** 课件格式版本 */
  schemaVersion: z.literal('2.0'),
  lessonId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  /** 生成信息（模型/技能版本），校对页展示 */
  generatedBy: z
    .object({
      model: z.string().max(100).optional(),
      skillVersion: z.string().max(40).optional(),
      generatedAt: z.string().max(40).optional()
    })
    .optional(),
  blocks: z.array(LessonBlockSchema).min(1).max(500)
})

export type LessonDocument = z.infer<typeof LessonSchema>

export interface ValidationResult {
  ok: boolean
  errors: { path: string; message: string }[]
}

/** 单课文档校验（Agent 自检与主进程校验共用）。 */
export function validateLessonDocument(json: unknown): ValidationResult {
  const result = LessonSchema.safeParse(json)
  if (result.success) {
    const errors: ValidationResult['errors'] = []
    const ids = new Set(result.data.blocks.map((b) => b.id))
    for (const block of result.data.blocks) {
      // 铁律 1：声明来自教材的块必须带页码引用
      if (block.origin === 'book' && block.source == null) {
        errors.push({ path: `${block.id}.source`, message: 'origin="book" 的块必须携带教材页码引用 source' })
      }
      // 铁律 2：选择题必须提供选项
      if (block.type === 'quiz' && block.kind === 'choice' && (block.options == null || block.options.length < 2)) {
        errors.push({ path: `${block.id}.options`, message: '选择题至少提供 2 个选项' })
      }
      // 引用完整性：summary.links 指向的块 id 必须存在
      if (block.type === 'summary' && block.links != null) {
        for (const link of block.links) {
          if (!ids.has(link)) {
            errors.push({ path: `${block.id}.links`, message: `引用的块不存在: ${link}` })
          }
        }
      }
    }
    return { ok: errors.length === 0, errors }
  }
  return {
    ok: false,
    errors: result.error.issues.map((i) => ({
      path: i.path.map(String).join('.') || '(root)',
      message: i.message
    }))
  }
}

/* ===== v1 → v2 适配（旧课程包的知识点 markdown 自动包装） ===== */

/** v1 知识点（course-schema.ts 的 KnowledgePoint）→ v2 blocks。 */
export function adaptV1KnowledgePointToBlocks(kp: {
  id: string
  title: string
  content: string
  bookRef?: { pdfPage: number; bookPage?: number; ocrFile?: string }
}): LessonBlock[] {
  // 有页码 → book（铁律 1 成立）；无页码 → 降级 ai-supplement，避免违反铁律 1
  const origin: BlockOrigin = kp.bookRef != null ? 'book' : 'ai-supplement'
  const blocks: LessonBlock[] = [
    {
      id: `${kp.id}-concept`,
      type: 'concept',
      origin,
      ...(kp.bookRef != null
        ? {
            source: {
              pdfPage: kp.bookRef.pdfPage,
              bookPage: kp.bookRef.bookPage ?? null,
              ocrFile: kp.bookRef.ocrFile
            }
          }
        : {}),
      title: kp.title,
      md: kp.content
    }
  ]
  return blocks
}
