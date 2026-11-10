import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import path from 'path'
import os from 'os'
import { countTextWords, checkLessonCapacity } from '../src/shared/lesson-quality'
import { getKpSource, readMaterialPage, listMaterialFiles } from '../src/main/services/kpSource'
import { getCourseStats } from '../src/main/services/courseStats'
import { createCourseV2, addChapterV2, saveExerciseV2 } from '../src/main/services/coursePackageV2'
import { initPath, saveKpLesson } from '../src/main/services/learningPath'

let tmp: string
let materialsRoot: string
let coursesRoot: string
const PAGE = { pdfPage: 94, bookPage: 80, ocrFile: 'ocr/ch03/p0094.md' }

const FACTSHEET = `# factsheet · 第 3 章《时序逻辑设计》

## 0. 章节地图
（略）

## 1. 知识点清单
（略）

## 2. 知识点详情

### K1 · SR 锁存器 · 书内 p.78
- 必用事实：S=1 置位。

### K2 · D 触发器（D flip-flop） · 书内 p.80
- 交互命题：展示时钟沿采样瞬间
- 必用事实：仅在时钟上升沿采样 D 输入并更新 Q（书内 p.80）。
- 易错点：建立时间违例导致亚稳态。
- 可直接用的例题：按波形读 Q。

### K3 · 寄存器 · 书内 p.82
- 必用事实：多个 D 触发器共享时钟。

## 3. 章末习题清单
（待补）
`

function ocrPage(pdf: number, book: number, body: string): string {
  return `## PDF p.${pdf} | 书内页码 ${book}\n\n${body}\n`
}

async function seedMaterial(): Promise<string> {
  const matDir = path.join(materialsRoot, 'mat-1')
  mkdirSync(path.join(matDir, 'ocr', 'ch03'), { recursive: true })
  writeFileSync(path.join(matDir, 'factsheet-ch03.md'), FACTSHEET, 'utf-8')
  writeFileSync(path.join(matDir, 'meta.json'), JSON.stringify({ title: 'DDCA', pageOffsets: [{ section: '正文', offset: 14 }] }), 'utf-8')
  writeFileSync(path.join(matDir, 'ocr', 'ch03', 'p0093.md'), ocrPage(93, 79, '锁存器内容。'), 'utf-8')
  writeFileSync(path.join(matDir, 'ocr', 'ch03', 'p0094.md'), ocrPage(94, 80, 'D 触发器仅在时钟上升沿采样 D 并更新 Q。'), 'utf-8')
  writeFileSync(path.join(matDir, 'ocr', 'ch03', 'p0095.md'), ocrPage(95, 81, '建立时间与保持时间。'), 'utf-8')
  return matDir
}

/** 满足全部容量硬标准的课件（2600 字正文 + 3 quiz + 2 example + 1 diagram）。 */
function goodLesson(): unknown {
  const filler = '触发器是时序电路的基本存储单元，它的双稳态来自正反馈回路。'.repeat(80) // ≈1680 字
  return {
    schemaVersion: '2.0',
    lessonId: 'ch03-k02',
    title: 'D 触发器',
    blocks: [
      { id: 't1', type: 'text', origin: 'book', source: PAGE, md: filler },
      { id: 'c1', type: 'concept', origin: 'book', source: PAGE, title: 'D 触发器', md: '时钟上升沿采样 D 并更新 Q，其余时间保持。这是同步系统的基石元件。'.repeat(12) },
      {
        id: 'e1', type: 'example', origin: 'ai-supplement', title: '正例',
        steps: [{ md: '沿上 D=1 则 Q=1。' }, { md: '沿后 D 变化被忽略。' }]
      },
      {
        id: 'e2', type: 'example', origin: 'ai-supplement', title: '反例',
        steps: [{ md: '把触发器当锁存器用，CLK=1 期间改 D 无效。' }, { md: '结果流水线错位一个周期。' }]
      },
      { id: 'd1', type: 'diagram', origin: 'book', source: PAGE, engine: 'mermaid', mermaid: 'stateDiagram-v2\n [*] --> Q0' },
      {
        id: 'q1', type: 'quiz', origin: 'ai-supplement', kind: 'choice', question: '沿后 D 变化会怎样？',
        options: [{ key: 'A', text: '被忽略' }, { key: 'B', text: '跟随' }], answer: 'A'
      },
      {
        id: 'q2', type: 'quiz', origin: 'ai-supplement', kind: 'choice', question: '特性方程？',
        options: [{ key: 'A', text: 'Q+=D' }, { key: 'B', text: 'Q+=Q' }], answer: 'A'
      },
      { id: 'q3', type: 'quiz', origin: 'ai-supplement', kind: 'blank', question: 'D 必须提前稳定的时间叫____。', answer: '建立时间' }
    ]
  }
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'cad-kp-source-'))
  materialsRoot = path.join(tmp, 'materials')
  coursesRoot = path.join(tmp, 'courses')
  mkdirSync(materialsRoot, { recursive: true })
  mkdirSync(coursesRoot, { recursive: true })
  await seedMaterial()
  await createCourseV2(coursesRoot, {
    id: 'ddca',
    title: 'DDCA',
    sourceRef: { materialId: 'mat-1', factsheets: ['factsheet-ch03.md'], pageOffsets: [{ section: '正文', offset: 14 }] }
  })
  await addChapterV2(coursesRoot, 'ddca', { id: 'ch-03', title: '时序逻辑' })
  await initPath(coursesRoot, 'ddca', [
    { id: 'ch03-k01', chapterId: 'ch-03', title: 'SR 锁存器', bookPage: 78 },
    { id: 'ch03-k02', chapterId: 'ch-03', title: 'D 触发器', bookPage: 80 }
  ])
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('lesson-quality 容量机检', () => {
  it('countTextWords：CJK 逐字 + 拉丁按词', () => {
    expect(countTextWords('触发器 flip-flop Q')).toBe(3 + 1 + 1)
    expect(countTextWords('')).toBe(0)
  })

  it('达标课件全绿；缺项逐条报 warn', () => {
    const good = checkLessonCapacity((goodLesson() as { blocks: never[] }).blocks)
    expect(good.ok).toBe(true)
    expect(good.warns).toEqual([])
    expect(good.words).toBeGreaterThanOrEqual(2500)

    const weak = checkLessonCapacity([
      { id: 'x1', type: 'text', origin: 'ai-supplement', md: '太短' },
      { id: 'x2', type: 'interactive', origin: 'ai-supplement', title: 'a', source: 'export default ()=>null' },
      { id: 'x3', type: 'interactive', origin: 'ai-supplement', title: 'b', source: 'export default ()=>null' },
      {
        id: 'x4', type: 'quiz', origin: 'ai-supplement', kind: 'choice', question: 'q',
        options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: 'C'
      }
    ] as never[])
    const codes = weak.warns.map((w) => w.code)
    expect(codes).toContain('words')
    expect(codes).toContain('quiz')
    expect(codes).toContain('example')
    expect(codes).toContain('interactive')
    expect(codes).toContain('quiz-answer')
    expect(codes).not.toContain('visual') // interactive 计入可视化，2 个已满足 visual≥1
    expect(weak.ok).toBe(false)
  })
})

describe('kpSource 结构化取料', () => {
  it('getKpSource：factsheet 节 + ocr 页码自证 + 相邻页', async () => {
    const r = await getKpSource(coursesRoot, materialsRoot, 'ddca', 'ch03-k02')
    expect(r.factsheetFile).toBe('factsheet-ch03.md')
    expect(r.factsheetSection).toContain('### K2')
    expect(r.factsheetSection).toContain('仅在时钟上升沿采样')
    expect(r.ocrFile).toBe('ocr/ch03/p0094.md')
    expect(r.pdfPage).toBe(94)
    expect(r.bookPage).toBe(80)
    expect(r.pageMd).toContain('书内页码 80')
    expect(r.neighborOcrFiles).toContain('ocr/ch03/p0093.md')
  })

  it('标题容错匹配（path 里的 KP 名与 factsheet 标题不必逐字符相等）', async () => {
    // ch03-k01「SR 锁存器」 factsheet 标题「SR 锁存器」完全一致；换一个部分匹配的
    const { replacePath } = await import('../src/main/services/learningPath')
    await replacePath(coursesRoot, 'ddca', [
      { id: 'ch03-k01', chapterId: 'ch-03', title: 'SR 锁存器（Set-Reset Latch）', bookPage: 78 },
      { id: 'ch03-k02', chapterId: 'ch-03', title: 'D 触发器', bookPage: 80 }
    ])
    const r = await getKpSource(coursesRoot, materialsRoot, 'ddca', 'ch03-k01')
    expect(r.factsheetSection).toContain('S=1 置位')
    // 页码优先：78 → p0093
    expect(r.ocrFile).toBe('ocr/ch03/p0093.md')
  })

  it('错误路径：无 sourceRef / KP 不在路径 / 找不到节', async () => {
    await createCourseV2(coursesRoot, { id: 'bare', title: '无资料' })
    await expect(getKpSource(coursesRoot, materialsRoot, 'bare', 'k')).rejects.toThrow(/未关联教材资料/)
    await expect(getKpSource(coursesRoot, materialsRoot, 'ddca', 'no-such')).rejects.toThrow(/不在学习路径/)
    const { replacePath } = await import('../src/main/services/learningPath')
    await replacePath(coursesRoot, 'ddca', [{ id: 'zz', chapterId: 'ch-03', title: '不存在的知识点标题', bookPage: 999 }])
    await expect(getKpSource(coursesRoot, materialsRoot, 'ddca', 'zz')).rejects.toThrow(/找不到知识点/)
    // 恢复骨架（后续 courseStats 测试还要用 ch03-k02）
    await replacePath(coursesRoot, 'ddca', [
      { id: 'ch03-k01', chapterId: 'ch-03', title: 'SR 锁存器', bookPage: 78 },
      { id: 'ch03-k02', chapterId: 'ch-03', title: 'D 触发器', bookPage: 80 }
    ])
  })

  it('readMaterialPage / listMaterialFiles：白名单与逃逸防护', async () => {
    const page = await readMaterialPage(materialsRoot, 'mat-1', 'ocr\\ch03\\p0094.md')
    expect(page.md).toContain('书内页码 80')
    await expect(readMaterialPage(materialsRoot, 'mat-1', '../evil.md')).rejects.toThrow(/非法/)
    await expect(readMaterialPage(materialsRoot, 'mat-1', 'meta.json')).rejects.toThrow(/只允许读取 ocr/)
    const list = await listMaterialFiles(materialsRoot, 'mat-1')
    expect(list.entries.map((e) => e.name)).toContain('factsheet-ch03.md')
    expect(list.entries.map((e) => e.name)).toContain('ocr')
    const ocrList = await listMaterialFiles(materialsRoot, 'mat-1', 'ocr/ch03')
    expect(ocrList.entries).toHaveLength(3)
    await expect(listMaterialFiles(materialsRoot, 'mat-1', '../..')).rejects.toThrow(/非法/)
  })
})

describe('courseStats 课程统计', () => {
  it('生成/学习/审核/块型/字数一次聚合', async () => {
    await saveKpLesson(coursesRoot, 'ddca', goodLesson())
    await saveExerciseV2(coursesRoot, 'ddca', {
      id: 'ex-1',
      title: '实现 D 触发器',
      statement: '用 always @(posedge clk) 实现。',
      source: { origin: 'book', bookRefs: [{ pdfPage: 94 }] },
      knowledgePointIds: [],
      starterFiles: [],
      tests: [],
      referenceSolution: []
    })
    const s = await getCourseStats(coursesRoot, 'ddca')
    expect(s.chapters).toBe(1)
    expect(s.lessons).toBe(1)
    expect(s.path?.total).toBe(2)
    expect(s.path?.gen).toMatchObject({ ready: 1, pending: 1 })
    expect(s.blocks).toMatchObject({ text: 1, concept: 1, example: 2, diagram: 1, quiz: 3 })
    expect(s.words).toBeGreaterThan(2500)
    expect(s.invalidLessons).toEqual([])
    expect(s.review).toEqual({}) // 未审核
  })
})
