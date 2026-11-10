import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import path from 'path'
import os from 'os'
import { createCourseV2, addChapterV2, saveLessonV2 } from '../src/main/services/coursePackageV2'
import { getReviewOverview, validateLessonForReview, getOcrPageForCourse } from '../src/main/services/reviewView'
import { initPath } from '../src/main/services/learningPath'

/**
 * P5.7 校对视图服务测试（零 AI 消耗）：
 *  - 全量扫课 + 损坏课件折进 errors（不抛）+ book 块页码锚 + 容量 warn
 *  - 页码抽查：ocrFile 直读 / bookPage 扫描自证 / 未命中 null / 未关联教材报错
 */

let tmpRoot: string
let materialsRoot: string
const COURSE = 'ddca'
const MID = 'book-demo'
const PAGE = { pdfPage: 94, bookPage: 80, ocrFile: 'ocr/ch03/p0094.md' }

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-review-view-'))
  materialsRoot = path.join(tmpRoot, 'materials')
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function goodLesson(lessonId: string, title: string, extraBlocks: unknown[] = []): unknown {
  return {
    schemaVersion: '2.0',
    lessonId,
    title,
    blocks: [
      { id: `${lessonId}-q`, type: 'quote', origin: 'book', source: PAGE, md: '原书摘录：S=1 置位，R=1 清零' },
      ...extraBlocks
    ]
  }
}

describe('P5.7 getReviewOverview', () => {
  it('全量扫课：好课 validate+warn、坏 JSON/缺页码课折进 errors 不抛、book 锚收集', async () => {
    const root = path.join(tmpRoot, 'r1')
    const coursesRoot = path.join(root, 'courses')
    await createCourseV2(coursesRoot, { id: COURSE, title: '数字设计' })
    await addChapterV2(coursesRoot, COURSE, { id: 'ch-03', title: '时序逻辑' })
    await saveLessonV2(coursesRoot, COURSE, 'ch-03', goodLesson('k1', '锁存器'))
    // 缺页码课件（铁律 error）：先合法落盘进 manifest，再覆写文件绕过校验——校对页就是要看它
    await saveLessonV2(coursesRoot, COURSE, 'ch-03', {
      schemaVersion: '2.0',
      lessonId: 'k2',
      title: '缺页码',
      blocks: [{ id: 'b1', type: 'text', origin: 'book', source: PAGE, md: '占位' }]
    })
    const badRef = {
      schemaVersion: '2.0',
      lessonId: 'k2',
      title: '缺页码',
      blocks: [{ id: 'b1', type: 'text', origin: 'book', md: '没有 source 的 book 块' }]
    }
    writeFileSync(path.join(coursesRoot, COURSE, 'chapters', 'ch-03', 'k2.json'), JSON.stringify(badRef), 'utf-8')
    // 非 JSON 垃圾文件 + manifest 引用（addChapterV2 需要合法文件，先写合法再覆写垃圾）
    await addChapterV2(coursesRoot, COURSE, { id: 'ch-04', title: '处理器' })
    await saveLessonV2(coursesRoot, COURSE, 'ch-04', goodLesson('k3', '指令执行'))
    writeFileSync(path.join(coursesRoot, COURSE, 'chapters', 'ch-04', 'k3.json'), '{oops', 'utf-8')

    const ov = await getReviewOverview(coursesRoot, COURSE)
    expect(ov.title).toBe('数字设计')
    expect(ov.lessons).toHaveLength(3)

    const k1 = ov.lessons.find((l) => l.lessonId === 'k1')!
    expect(k1.errors).toHaveLength(0)
    expect(k1.doc).not.toBeNull()
    expect(k1.blockCount).toBe(1)
    expect(k1.bookBlocks).toHaveLength(1)
    expect(k1.bookBlocks[0]).toMatchObject({ blockId: 'k1-q', blockType: 'quote', pdfPage: 94, bookPage: 80 })
    expect(k1.bookBlocks[0].excerpt).toContain('S=1 置位')

    const k2 = ov.lessons.find((l) => l.lessonId === 'k2')!
    expect(k2.errors.length).toBeGreaterThan(0)
    expect(k2.errors[0].path).toBe('b1.source')
    expect(k2.doc).not.toBeNull() // raw 照给，渲染层尽力渲染

    const k3 = ov.lessons.find((l) => l.lessonId === 'k3')!
    expect(k3.errors).toHaveLength(1)
    expect(k3.errors[0].path).toBe('(file)')
    expect(k3.doc).toBeNull()

    expect(ov.pathKpIds).toEqual([]) // 无 path.json
    expect(ov.digests).toEqual({})
  })

  it('manifest 引用缺失文件折进 errors；容量 warn 聚合；path KP 集与 digest 现值回显', async () => {
    const root = path.join(tmpRoot, 'r2')
    const coursesRoot = path.join(root, 'courses')
    await createCourseV2(coursesRoot, { id: COURSE, title: '数字设计', sourceRef: { materialId: MID, factsheets: [], pageOffsets: [] } })
    await addChapterV2(coursesRoot, COURSE, { id: 'ch-03', title: '时序逻辑' })
    await saveLessonV2(coursesRoot, COURSE, 'ch-03', goodLesson('k1', '锁存器'))
    await initPath(coursesRoot, COURSE, [{ id: 'k1', chapterId: 'ch-03', title: '锁存器' }])
    // 手写 progress 带 digest（模拟链上现值）
    writeFileSync(
      path.join(coursesRoot, COURSE, 'progress.json'),
      JSON.stringify({
        schemaVersion: '2.0',
        courseId: COURSE,
        updatedAt: '2026-11-11T00:00:00.000Z',
        kps: [{ kpId: 'k1', state: 'completed', digest: { core: '链上现值', takeaway: '一句话' } }]
      }),
      'utf-8'
    )

    const ov = await getReviewOverview(coursesRoot, COURSE)
    expect(ov.materialId).toBe(MID)
    expect(ov.pathKpIds).toEqual(['k1'])
    expect(ov.digests.k1).toEqual({ core: '链上现值', takeaway: '一句话' })
    // 单块课件容量硬标准全线 warn（字数/quiz/example/visual）
    const k1 = ov.lessons.find((l) => l.lessonId === 'k1')!
    expect(k1.errors).toHaveLength(0)
    expect(k1.warns.length).toBeGreaterThanOrEqual(3)
    expect(k1.words).toBeGreaterThan(0)

    // manifest 引用缺失文件：直接改 manifest 加一个不存在文件的引用
    const manifestPath = path.join(coursesRoot, COURSE, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    manifest.chapters[0].lessons.push({ lessonId: 'ghost', title: '幽灵课', file: 'chapters/ch-03/ghost.json' })
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8')
    const ov2 = await getReviewOverview(coursesRoot, COURSE)
    const ghost = ov2.lessons.find((l) => l.lessonId === 'ghost')!
    expect(ghost.doc).toBeNull()
    expect(ghost.errors[0].message).toContain('缺失')
  })

  it('validateLessonForReview 单课重校验；未知课件拒绝', async () => {
    const root = path.join(tmpRoot, 'r3')
    const coursesRoot = path.join(root, 'courses')
    await createCourseV2(coursesRoot, { id: COURSE, title: 'x' })
    await addChapterV2(coursesRoot, COURSE, { id: 'ch-03', title: 'c' })
    await saveLessonV2(coursesRoot, COURSE, 'ch-03', goodLesson('k1', 't'))
    const v = await validateLessonForReview(coursesRoot, COURSE, 'k1')
    expect(v.errors).toHaveLength(0)
    expect(v.warns.length).toBeGreaterThan(0)
    await expect(validateLessonForReview(coursesRoot, COURSE, 'nope')).rejects.toThrow(/不在课程中/)
  })
})

describe('P5.7 页码抽查 getOcrPageForCourse', () => {
  async function seedMaterial(): Promise<{ coursesRoot: string }> {
    const root = path.join(tmpRoot, 'ocr-' + Math.random().toString(36).slice(2, 7))
    const coursesRoot = path.join(root, 'courses')
    await createCourseV2(coursesRoot, { id: COURSE, title: 'x', sourceRef: { materialId: MID, factsheets: [], pageOffsets: [] } })
    // 造教材资料：两章各一页，页首头部自证
    mkdirSync(path.join(materialsRoot, MID, 'ocr', 'ch03'), { recursive: true })
    mkdirSync(path.join(materialsRoot, MID, 'ocr', 'ch04'), { recursive: true })
    writeFileSync(
      path.join(materialsRoot, MID, 'ocr', 'ch03', 'p0094.md'),
      '## PDF p.94 | 书内页码 80\n\n原书 3.2 节正文：S=1 置位。\n',
      'utf-8'
    )
    writeFileSync(
      path.join(materialsRoot, MID, 'ocr', 'ch04', 'p0100.md'),
      '## PDF p.100 | 书内页码 86\n\n第 4 章正文。\n',
      'utf-8'
    )
    return { coursesRoot }
  }

  it('ocrFile 直读白名单通道；bookPage 扫描自证命中；未命中 null', async () => {
    const { coursesRoot } = await seedMaterial()
    const direct = await getOcrPageForCourse(coursesRoot, materialsRoot, COURSE, { ocrFile: PAGE.ocrFile, bookPage: 80 })
    expect(direct?.ocrFile).toBe(PAGE.ocrFile)
    expect(direct?.md).toContain('S=1 置位')
    expect(direct?.pdfPage).toBeNull()

    const scanned = await getOcrPageForCourse(coursesRoot, materialsRoot, COURSE, { bookPage: 80 })
    expect(scanned?.ocrFile).toBe('ocr/ch03/p0094.md')
    expect(scanned?.pdfPage).toBe(94)
    expect(scanned?.bookPage).toBe(80)
    // 邻页 = ±1 书内页码（86 距 80 为 6 → 无邻页）
    expect(scanned?.neighbors).toEqual([])

    const miss = await getOcrPageForCourse(coursesRoot, materialsRoot, COURSE, { bookPage: 999 })
    expect(miss).toBeNull()
  })

  it('邻页收集；穿越/绝对路径拒绝；未关联教材资料报错', async () => {
    const root = path.join(tmpRoot, 'ocr-nb')
    const coursesRoot = path.join(root, 'courses')
    await createCourseV2(coursesRoot, { id: COURSE, title: 'x', sourceRef: { materialId: MID, factsheets: [], pageOffsets: [] } })
    mkdirSync(path.join(materialsRoot, MID, 'ocr', 'ch03'), { recursive: true })
    writeFileSync(path.join(materialsRoot, MID, 'ocr', 'ch03', 'p0001.md'), '## PDF p.1 | 书内页码 9\nA\n', 'utf-8')
    writeFileSync(path.join(materialsRoot, MID, 'ocr', 'ch03', 'p0002.md'), '## PDF p.2 | 书内页码 10\nB\n', 'utf-8')
    writeFileSync(path.join(materialsRoot, MID, 'ocr', 'ch03', 'p0003.md'), '## PDF p.3 | 书内页码 11\nC\n', 'utf-8')

    const hit = await getOcrPageForCourse(coursesRoot, materialsRoot, COURSE, { bookPage: 10 })
    expect(hit?.neighbors.sort()).toEqual(['ocr/ch03/p0001.md', 'ocr/ch03/p0003.md'])

    await expect(
      getOcrPageForCourse(coursesRoot, materialsRoot, COURSE, { ocrFile: '../meta.json' })
    ).rejects.toThrow(/非法/)
    await expect(
      getOcrPageForCourse(coursesRoot, materialsRoot, COURSE, { ocrFile: 'factsheet-ch01.md' })
    ).rejects.toThrow(/ocr/)
    // 未关联教材
    await createCourseV2(coursesRoot, { id: 'no-src', title: 'y' })
    await expect(getOcrPageForCourse(coursesRoot, materialsRoot, 'no-src', { bookPage: 10 })).rejects.toThrow(
      /未关联教材资料/
    )
  })
})
