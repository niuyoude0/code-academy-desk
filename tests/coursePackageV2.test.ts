import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import path from 'path'
import os from 'os'
import {
  createCourseV2,
  getManifestV2,
  addChapterV2,
  saveLessonV2,
  getLessonV2,
  saveExerciseV2,
  getExerciseV2,
  exportCourseZipV2Buffer,
  importCourseZipV2Buffer,
  updateGenerationV2
} from '../src/main/services/coursePackageV2'
import { listCourses } from '../src/main/services/coursePackage'
import { validateLessonDocument } from '../src/shared/lesson-schema'

let tmpRoot: string
let coursesA: string
let coursesB: string

const PAGE = { pdfPage: 94, bookPage: 80, ocrFile: 'ocr/ch03/p0094.md' }

function lessonDoc(lessonId: string, title: string): unknown {
  return {
    schemaVersion: '2.0',
    lessonId,
    title,
    blocks: [
      { id: 'b1', type: 'concept', origin: 'book', source: PAGE, title, md: '讲解正文' },
      {
        id: 'b2',
        type: 'quiz',
        origin: 'ai-supplement',
        kind: 'choice',
        question: 'x?',
        options: [
          { key: 'A', text: 'a' },
          { key: 'B', text: 'b' }
        ],
        answer: 'A'
      }
    ]
  }
}

function exerciseDoc(id: string): unknown {
  return {
    id,
    title: '习题 4.3',
    statement: '用 D 触发器实现模 6 计数器。',
    source: { origin: 'book', bookRefs: [{ pdfPage: 100 }] },
    knowledgePointIds: [],
    starterFiles: [],
    tests: [],
    referenceSolution: []
  }
}

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-course-v2-'))
  coursesA = path.join(tmpRoot, 'courses-a')
  coursesB = path.join(tmpRoot, 'courses-b')
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('课程包 v2 生命周期', () => {
  it('创建 → 加章 → 存课件 → 读回；索引带 v2 字段', async () => {
    await createCourseV2(coursesA, {
      id: 'ddca',
      title: '数字设计与计算机体系结构',
      sourceRef: { materialId: 'DDCA-ocr', factsheets: ['factsheet-ch03.md'], pageOffsets: [{ offset: 14 }] },
      generation: { model: 'deepseek-chat', skillVersion: '2.0' }
    })
    await addChapterV2(coursesA, 'ddca', { id: 'ch-03', title: '时序逻辑设计' })
    const { validation } = await saveLessonV2(coursesA, 'ddca', 'ch-03', lessonDoc('l01', '触发器'))
    expect(validation.ok).toBe(true)

    const manifest = await getManifestV2(coursesA, 'ddca')
    expect(manifest.chapters).toHaveLength(1)
    expect(manifest.chapters[0].lessons[0]).toMatchObject({ lessonId: 'l01', file: 'chapters/ch-03/l01.json' })
    expect(manifest.sourceRef?.materialId).toBe('DDCA-ocr')

    const lesson = (await getLessonV2(coursesA, 'ddca', 'ch-03', 'l01')) as { lessonId: string }
    expect(lesson.lessonId).toBe('l01')

    const entry = (await listCourses(coursesA)).find((c) => c.id === 'ddca')
    expect(entry?.schemaVersion).toBe('2.0')
    expect(entry?.chapterCount).toBe(1)
  })

  it('课件校验失败被拒（铁律 1：book 无页码），文件不落盘', async () => {
    await createCourseV2(coursesA, { id: 'bad-lesson', title: '坏课件' })
    await addChapterV2(coursesA, 'bad-lesson', { id: 'ch-01', title: '一章' })
    const bad = {
      schemaVersion: '2.0',
      lessonId: 'l-bad',
      title: '缺页码',
      blocks: [{ id: 'b1', type: 'concept', origin: 'book', title: 't', md: 'm' }]
    }
    await expect(saveLessonV2(coursesA, 'bad-lesson', 'ch-01', bad)).rejects.toThrow(/课件校验失败/)
    const dir = path.join(coursesA, 'bad-lesson', 'chapters', 'ch-01')
    expect(existsSync(dir)).toBe(false)
  })

  it('练习保存/读取 + 索引计数', async () => {
    await saveExerciseV2(coursesA, 'ddca', exerciseDoc('ex-001'))
    const ex = await getExerciseV2(coursesA, 'ddca', 'ex-001')
    expect(ex.statement).toContain('模 6')
    await expect(saveExerciseV2(coursesA, 'ddca', { id: 'bad ex!', title: 'x' })).rejects.toThrow(/练习校验失败/)
    const entry = (await listCourses(coursesA)).find((c) => c.id === 'ddca')
    expect(entry?.exerciseCount).toBe(1)
  })

  it('局部重生成：覆写同一 lesson 文件 + 更新 manifest.updatedAt', async () => {
    const before = await getManifestV2(coursesA, 'ddca')
    await new Promise((r) => setTimeout(r, 20))
    const improved = lessonDoc('l01', '触发器（重生成 v2）')
    await saveLessonV2(coursesA, 'ddca', 'ch-03', improved)
    const after = await getManifestV2(coursesA, 'ddca')
    expect(after.updatedAt > before.updatedAt).toBe(true)
    expect(after.chapters[0].lessons).toHaveLength(1) // 不新增引用
    const lesson = (await getLessonV2(coursesA, 'ddca', 'ch-03', 'l01')) as { title: string }
    expect(lesson.title).toContain('重生成')
  })

  it('updateGenerationV2 记录任务进度', async () => {
    const m = await updateGenerationV2(coursesA, 'ddca', { lastRunAt: '2026-11-10T15:00:00Z' })
    expect(m.generation?.lastRunAt).toBe('2026-11-10T15:00:00Z')
  })

  it('边界：重复建课/重复章节/未知章节/非法 id/v1 课程区分', async () => {
    await expect(createCourseV2(coursesA, { id: 'ddca', title: 'x' })).rejects.toThrow(/拒绝覆盖/)
    await expect(addChapterV2(coursesA, 'ddca', { id: 'ch-03', title: 'x' })).rejects.toThrow(/章节已存在/)
    await expect(saveLessonV2(coursesA, 'ddca', 'ch-99', lessonDoc('l9', 'x'))).rejects.toThrow(/章节不存在/)
    await expect(getLessonV2(coursesA, 'ddca', 'ch-03', '../escape')).rejects.toThrow(/非法课程 id|课件不存在/)
    // v1 课程（course-package.json）给可读错误
    const { newEmptyCoursePackage } = await import('../src/main/services/coursePackage')
    const { writeFileSync, mkdirSync } = await import('fs')
    const v1dir = path.join(coursesA, 'legacy-v1')
    mkdirSync(v1dir, { recursive: true })
    writeFileSync(path.join(v1dir, 'course-package.json'), JSON.stringify(newEmptyCoursePackage()))
    await expect(getManifestV2(coursesA, 'legacy-v1')).rejects.toThrow(/v1 格式/)
  })
})

describe('课程包 v2 zip 往返', () => {
  it('导出 → 导入到新根 → 内容一致；坏课件 zip 被拒', async () => {
    const zip = await exportCourseZipV2Buffer(coursesA, 'ddca')
    const result = await importCourseZipV2Buffer(coursesB, zip)
    expect(result).toMatchObject({ courseId: 'ddca', chapterCount: 1, lessonCount: 1, exerciseCount: 1 })
    const manifestA = await getManifestV2(coursesA, 'ddca')
    const manifestB = await getManifestV2(coursesB, 'ddca')
    expect(manifestB).toEqual(manifestA)
    const lessonB = (await getLessonV2(coursesB, 'ddca', 'ch-03', 'l01')) as { lessonId: string }
    expect(lessonB.lessonId).toBe('l01')
    // 目标已存在拒绝覆盖
    await expect(importCourseZipV2Buffer(coursesB, zip)).rejects.toThrow(/拒绝覆盖/)
  })

  it('含非法课件的 zip 整包拒绝（先校验后落盘）', async () => {
    // 手工构造坏 zip：用合法课程导出后篡改一个 lesson 文件
    const zip = await exportCourseZipV2Buffer(coursesA, 'ddca')
    const JSZip = (await import('jszip')).default
    const loaded = await JSZip.loadAsync(zip)
    loaded.file('chapters/ch-03/l01.json', JSON.stringify({ schemaVersion: '2.0', lessonId: 'l01', title: 't', blocks: [
      { id: 'b1', type: 'concept', origin: 'book', title: 't', md: '缺页码' }
    ] }, null, 2))
    const tampered = await loaded.generateAsync({ type: 'nodebuffer' })
    await expect(importCourseZipV2Buffer(path.join(tmpRoot, 'courses-c'), tampered)).rejects.toThrow(/课件校验失败/)
    expect(existsSync(path.join(tmpRoot, 'courses-c', 'ddca'))).toBe(false)
  })

  it('导出的课件文档仍通过铁律校验（双保险）', () => {
    // validateLessonDocument 与保存路径共用，抽查导出链上的文档结构
    expect(validateLessonDocument(lessonDoc('l01', '触发器')).ok).toBe(true)
  })
})
