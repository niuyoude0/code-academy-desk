import { describe, it, expect } from 'vitest'
import {
  validateLessonDocument,
  adaptV1KnowledgePointToBlocks,
  LessonSchema
} from '../src/shared/lesson-schema'

const PAGE = { pdfPage: 94, bookPage: 80, ocrFile: 'ocr/ch03/p0094.md' }

function lessonWith(blocks: unknown[]): unknown {
  return {
    schemaVersion: '2.0',
    lessonId: 'ch03-l01',
    title: '时序逻辑设计基础',
    generatedBy: { model: 'deepseek-chat', skillVersion: '2.0', generatedAt: '2026-11-10' },
    blocks
  }
}

describe('lesson-schema v2 校验器', () => {
  it('合法文档（多种块混合）通过，含 book 页码引用', () => {
    const result = validateLessonDocument(
      lessonWith([
        { id: 'b1', type: 'concept', origin: 'book', source: PAGE, title: '触发器', md: '触发器是**时序电路**的基本单元。公式：$Q_{next}$', tags: ['时序'] },
        { id: 'b2', type: 'definition', origin: 'ai-supplement', term: '建立时间', md: '时钟沿前数据必须稳定的最小时长。' },
        { id: 'b3', type: 'theorem', origin: 'book', source: PAGE, name: '定理 3.1', md: '同步时序电路状态方程……', proof: '由 D 触发器特征方程直接代入。' },
        { id: 'b4', type: 'math', origin: 'ai-supplement', latex: 'Q_{next} = D', block: true },
        { id: 'b5', type: 'code', origin: 'book', source: PAGE, language: 'verilog', code: 'always @(posedge clk) q <= d;', runnable: true },
        { id: 'b6', type: 'diagram', origin: 'ai-supplement', engine: 'mermaid', mermaid: 'graph LR; A-->B' },
        {
          id: 'b7',
          type: 'anim',
          origin: 'ai-supplement',
          template: 'array',
          title: '扫描最大值',
          frames: [
            { data: { arr: [3, 7, 2] }, pointers: { i: 0 }, note: '初始' },
            { data: { arr: [3, 7, 2] }, pointers: { i: 1 }, highlight: [1], note: '7 更大' }
          ]
        },
        {
          id: 'b8',
          type: 'quiz',
          origin: 'book',
          source: PAGE,
          kind: 'choice',
          question: '建立时间约束属于____约束。',
          options: [
            { key: 'A', text: '时序' },
            { key: 'B', text: '组合' }
          ],
          answer: 'A',
          explanation: '数据相对时钟沿的时间要求属于时序约束。'
        },
        {
          id: 'b9',
          type: 'summary',
          origin: 'ai-supplement',
          points: ['触发器 = 基本存储单元', '建立时间/保持时间'],
          links: ['b1', 'b2']
        }
      ])
    )
    expect(result).toEqual({ ok: true, errors: [] })
    // 联合类型推断可用
    const parsed = LessonSchema.parse(lessonWith([{ id: 'x', type: 'text', origin: 'ai-supplement', md: 'hi' }]))
    expect(parsed.blocks[0].type).toBe('text')
  })

  it('铁律 1：origin=book 无页码引用被拦', () => {
    const result = validateLessonDocument(
      lessonWith([{ id: 'b1', type: 'concept', origin: 'book', title: '触发器', md: 'x' }])
    )
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toContain('页码')
  })

  it('铁律 2：选择题缺选项被拦；blank 无选项通过', () => {
    const bad = validateLessonDocument(
      lessonWith([{ id: 'q1', type: 'quiz', origin: 'ai-supplement', kind: 'choice', question: 'x', answer: 'A' }])
    )
    expect(bad.ok).toBe(false)
    expect(bad.errors[0].message).toContain('选项')

    const blank = validateLessonDocument(
      lessonWith([
        { id: 'q2', type: 'quiz', origin: 'book', source: PAGE, kind: 'blank', question: '建立时间为____', answer: '时钟沿前数据稳定的最小时长' }
      ])
    )
    expect(blank.ok).toBe(true)
  })

  it('summary.links 悬空引用被拦', () => {
    const result = validateLessonDocument(
      lessonWith([
        { id: 'b1', type: 'concept', origin: 'ai-supplement', title: 't', md: 'm' },
        {
          id: 's1',
          type: 'summary',
          origin: 'ai-supplement',
          points: ['p'],
          links: ['不存在的块']
        }
      ])
    )
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toContain('不存在')
  })

  it('interactive 块（D2）接受源码与桥声明；未知 type 被拒', () => {
    const ok = validateLessonDocument(
      lessonWith([
        {
          id: 'iv1',
          type: 'interactive',
          origin: 'ai-supplement',
          title: '触发器交互演示',
          source: 'export default function D() { return <div>ff</div> }',
          bridgeImports: ['react', 'echarts']
        }
      ])
    )
    expect(ok.ok).toBe(true)

    const bad = validateLessonDocument(
      lessonWith([{ id: 'x1', type: 'video', origin: 'ai-supplement', url: 'x' }])
    )
    expect(bad.ok).toBe(false)
  })

  it('schema 非法（缺 title / 空块表 / 块数超限）给出带路径的错误', () => {
    const r1 = validateLessonDocument(lessonWith([]))
    expect(r1.ok).toBe(false)
    expect(r1.errors[0].path).toContain('blocks')

    const r2 = validateLessonDocument({ schemaVersion: '2.0', lessonId: '', title: 't', blocks: [
      { id: 'b', type: 'text', origin: 'ai-supplement', md: 'x' }
    ] })
    expect(r2.ok).toBe(false)
    expect(r2.errors[0].path).toContain('lessonId')

    const r3 = validateLessonDocument({ schemaVersion: '1.0', lessonId: 'a', title: 't', blocks: [
      { id: 'b', type: 'text', origin: 'ai-supplement', md: 'x' }
    ] })
    expect(r3.ok).toBe(false)
  })
})

describe('v1 → v2 适配', () => {
  it('知识点 markdown 包装为 concept 块并携带页码', () => {
    const blocks = adaptV1KnowledgePointToBlocks({
      id: 'kp-1',
      title: '动态准则',
      content: '输入必须稳定……',
      bookRef: { pdfPage: 94, bookPage: 80, ocrFile: 'ocr/ch03/p0094.md' }
    })
    expect(blocks[0].type).toBe('concept')
    expect(blocks[0].origin).toBe('book')
    if (blocks[0].type === 'concept') {
      expect(blocks[0].source?.pdfPage).toBe(94)
      expect(blocks[0].md).toContain('输入必须稳定')
    }
    const r = validateLessonDocument(lessonWith(blocks))
    expect(r.ok).toBe(true)
  })

  it('无页码的 v1 知识点降级为 ai-supplement（不违反铁律 1）', () => {
    const blocks = adaptV1KnowledgePointToBlocks({ id: 'kp-2', title: 't', content: 'c' })
    expect(blocks[0].origin).toBe('ai-supplement')
    expect(validateLessonDocument(lessonWith(blocks)).ok).toBe(true)
  })

  it('内置技能的 example 课件必须通过校验（随包分发，坏了就修复）', async () => {
    const { readFileSync } = await import('fs')
    const { fileURLToPath } = await import('url')
    const examplePath = fileURLToPath(
      new URL('../resources/skills/course-material-processor/examples/lesson-example.json', import.meta.url)
    )
    const example: unknown = JSON.parse(readFileSync(examplePath, 'utf-8'))
    const result = validateLessonDocument(example)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    // diagram 块用独立 mermaid 字段，页码引用不受污染（回归 P5.1 字段冲突修复）
    const doc = LessonSchema.parse(example)
    const diagram = doc.blocks.find((b): b is Extract<typeof b, { type: 'diagram' }> => b.type === 'diagram')
    if (diagram == null) throw new Error('示例课件缺少 diagram 块')
    expect(typeof diagram.mermaid).toBe('string')
    expect((diagram as unknown as { source: unknown }).source).toMatchObject({ pdfPage: 94 })
  })
})
