import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import path from 'path'
import os from 'os'
import { createCourseV2, addChapterV2, getManifestV2, exportCourseZipV2Buffer, importCourseZipV2Buffer } from '../src/main/services/coursePackageV2'
import {
  initPath,
  replacePath,
  getPath,
  saveKpLesson,
  setKpGenFailed,
  getProgress,
  startKp,
  completeKp,
  skipKp,
  getLearningContext,
  isKpUnlocked
} from '../src/main/services/learningPath'

let tmpRoot: string
const COURSE = 'ddca'
const PAGE = { pdfPage: 94, bookPage: 80, ocrFile: 'ocr/ch03/p0094.md' }

function kpLesson(kpId: string, title: string): unknown {
  return {
    schemaVersion: '2.0',
    lessonId: kpId,
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

async function seedCourse(coursesRoot: string, courseId: string): Promise<void> {
  await createCourseV2(coursesRoot, { id: courseId, title: '数字设计' })
  await addChapterV2(coursesRoot, courseId, { id: 'ch-03', title: '时序逻辑' })
  await addChapterV2(coursesRoot, courseId, { id: 'ch-04', title: '处理器' })
}

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-learning-path-'))
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('P5.3a 学习路径：path.json', () => {
  it('initPath 直译 factsheet 清单；重复 id/未知章节/重复初始化拒绝', async () => {
    const root = path.join(tmpRoot, 'p1')
    await seedCourse(root, COURSE)
    const kps = [
      { id: 'ch03-k01', chapterId: 'ch-03', title: 'SR 锁存器', bookPage: 78, interactivity: 'strong' as const },
      { id: 'ch03-k02', chapterId: 'ch-03', title: 'D 触发器', bookPage: 80 },
      { id: 'ch04-k01', chapterId: 'ch-04', title: '指令执行', interactivity: 'weak' as const }
    ]
    const p = await initPath(root, COURSE, kps)
    expect(p.kps).toHaveLength(3)
    expect(p.kps.every((k) => k.genStatus === 'pending')).toBe(true)
    await expect(initPath(root, COURSE, kps)).rejects.toThrow(/拒绝覆盖/)
    // 不存在的课程 → 可读错误
    await expect(initPath(path.join(tmpRoot, 'p1b'), 'no-such', [{ id: 'k', chapterId: 'c', title: 'x' }])).rejects.toThrow()
    const root2 = path.join(tmpRoot, 'p2')
    await seedCourse(root2, COURSE)
    await expect(
      initPath(root2, COURSE, [
        { id: 'dup', chapterId: 'ch-03', title: 'a' },
        { id: 'dup', chapterId: 'ch-03', title: 'b' }
      ])
    ).rejects.toThrow(/重复/)
    await expect(initPath(root2, COURSE, [{ id: 'k1', chapterId: 'ch-99', title: 'x' }])).rejects.toThrow(/章节不存在/)
  })

  it('replacePath 可整体替换骨架；saveKpLesson 校验+落盘+genStatus 回填', async () => {
    const root = path.join(tmpRoot, 'p3')
    await seedCourse(root, COURSE)
    await initPath(root, COURSE, [{ id: 'ch03-k01', chapterId: 'ch-03', title: '旧骨架' }])
    const replaced = await replacePath(root, COURSE, [
      { id: 'ch03-k01', chapterId: 'ch-03', title: 'SR 锁存器' },
      { id: 'ch03-k02', chapterId: 'ch-03', title: 'D 触发器' }
    ])
    expect(replaced.kps).toHaveLength(2)

    await saveKpLesson(root, COURSE, kpLesson('ch03-k01', 'SR 锁存器'))
    const p = await getPath(root, COURSE)
    expect(p.kps[0].genStatus).toBe('ready')
    expect(p.kps[0].lessonFile).toBe('chapters/ch-03/ch03-k01.json')
    expect(p.kps[1].genStatus).toBe('pending')
    // manifest 也拿到 lessonRef（saveLessonV2 联动）
    const manifest = await getManifestV2(root, COURSE)
    expect(manifest.chapters[0].lessons[0].lessonId).toBe('ch03-k01')

    // lessonId 不是路径上的 KP → 拒绝；坏课件（缺页码）→ 铁律拒绝且不置 ready
    await expect(saveKpLesson(root, COURSE, kpLesson('ch99-k01', 'x'))).rejects.toThrow(/不是路径上的知识点/)
    const bad = kpLesson('ch03-k02', '缺页码') as { blocks: { origin: string; source?: unknown }[] }
    delete bad.blocks[0].source
    await expect(saveKpLesson(root, COURSE, bad)).rejects.toThrow(/课件校验失败/)
    const p2 = await getPath(root, COURSE)
    expect(p2.kps[1].genStatus).toBe('pending')
  })

  it('setKpGenFailed 记录原因；非法 id 拒绝', async () => {
    const root = path.join(tmpRoot, 'p4')
    await seedCourse(root, COURSE)
    await initPath(root, COURSE, [{ id: 'k1', chapterId: 'ch-03', title: 'x' }])
    await setKpGenFailed(root, COURSE, 'k1', '返工 2 轮仍校验失败')
    const p = await getPath(root, COURSE)
    expect(p.kps[0].genStatus).toBe('failed')
    expect(p.kps[0].genError).toContain('2 轮')
    await expect(setKpGenFailed(root, COURSE, '../evil', 'x')).rejects.toThrow(/非法知识点/)
  })
})

describe('P5.3a 学习进度：progress.json 与解锁规则', () => {
  it('线性解锁：未完成前 startKp 拒绝；跳过可解锁；回溯不拨动指针', async () => {
    const root = path.join(tmpRoot, 'g1')
    await seedCourse(root, COURSE)
    await initPath(root, COURSE, [
      { id: 'k1', chapterId: 'ch-03', title: '锁存器' },
      { id: 'k2', chapterId: 'ch-03', title: '触发器' },
      { id: 'k3', chapterId: 'ch-03', title: '寄存器' }
    ])
    await expect(startKp(root, COURSE, 'k2')).rejects.toThrow(/未解锁/)
    await expect(skipKp(root, COURSE, 'k2')).rejects.toThrow(/未解锁.*不能跳过|未解锁/)
    await startKp(root, COURSE, 'k1')
    let progress = await getProgress(root, COURSE)
    expect(progress.currentKpId).toBe('k1')
    await completeKp(root, COURSE, 'k1', { quizBest: '3/3' })
    progress = await getProgress(root, COURSE)
    expect(progress.currentKpId).toBe('k2')
    // 跳过 k2 → 解锁 k3
    await skipKp(root, COURSE, 'k2')
    await startKp(root, COURSE, 'k3')
    progress = await getProgress(root, COURSE)
    expect(progress.currentKpId).toBe('k3')
    await completeKp(root, COURSE, 'k3', { quizBest: '2/3', codingPassed: false, forced: true })
    progress = await getProgress(root, COURSE)
    expect(progress.currentKpId).toBeUndefined()
    // 回溯 k1 重学：状态回到 learning，指针不回拨，digest 保留
    await startKp(root, COURSE, 'k1')
    progress = await getProgress(root, COURSE)
    expect(progress.currentKpId).toBeUndefined()
    const replay = progress.kps.find((k) => k.kpId === 'k1')
    expect(replay?.state).toBe('learning')
  })

  it('完成判定门槛：quiz≥2/3 且编程未失败；forced 应急门与 digest 定稿', async () => {
    const root = path.join(tmpRoot, 'g2')
    await seedCourse(root, COURSE)
    await initPath(root, COURSE, [
      { id: 'k1', chapterId: 'ch-03', title: '锁存器' },
      { id: 'k2', chapterId: 'ch-03', title: '触发器' }
    ])
    await startKp(root, COURSE, 'k1')
    await expect(completeKp(root, COURSE, 'k1', { quizBest: '1/3' })).rejects.toThrow(/未达标/)
    await expect(completeKp(root, COURSE, 'k1', {})).rejects.toThrow(/未达标/)
    await expect(completeKp(root, COURSE, 'k1', { quizBest: 'abc' })).rejects.toThrow(/未达标/)
    await expect(completeKp(root, COURSE, 'k1', { quizBest: '3/3', codingPassed: false })).rejects.toThrow(/编程题判定未通过/)
    const done = await completeKp(root, COURSE, 'k1', {
      quizBest: '2/3',
      digest: { core: 'SR 锁存器：S=1 置位，R=1 清零，禁态 S=R=1', takeaway: '双稳态是所有触发器的物理基础' }
    })
    const e = done.kps.find((k) => k.kpId === 'k1')
    expect(e).toMatchObject({ state: 'completed', quizBest: '2/3' })
    expect(e?.digest?.core).toContain('SR')
    expect(e?.forced).toBeUndefined()
    // forced 应急门
    await startKp(root, COURSE, 'k2')
    const forcedDone = await completeKp(root, COURSE, 'k2', { quizBest: '0/3', forced: true })
    expect(forcedDone.kps.find((k) => k.kpId === 'k2')?.forced).toBe(true)
    expect(forcedDone.currentKpId).toBeUndefined()
  })

  it('getLearningContext：digest 链 + skipped 空缺 + 下一 KP 预告', async () => {
    const root = path.join(tmpRoot, 'g3')
    await seedCourse(root, COURSE)
    await initPath(root, COURSE, [
      { id: 'k1', chapterId: 'ch-03', title: '锁存器' },
      { id: 'k2', chapterId: 'ch-03', title: '触发器' },
      { id: 'k3', chapterId: 'ch-03', title: '寄存器' }
    ])
    await startKp(root, COURSE, 'k1')
    await completeKp(root, COURSE, 'k1', { quizBest: '3/3', digest: { core: '双稳态', takeaway: '反馈构成记忆' } })
    await skipKp(root, COURSE, 'k2')
    const ctx = await getLearningContext(root, COURSE, 'k3')
    expect(ctx.kpId).toBe('k3')
    expect(ctx.preceding[0]).toMatchObject({ kpId: 'k1', core: '双稳态', takeaway: '反馈构成记忆' })
    expect(ctx.preceding[1]).toMatchObject({ kpId: 'k2', gap: true })
    expect(ctx.nextKpTitle).toBeNull()
    const ctxFirst = await getLearningContext(root, COURSE, 'k1')
    expect(ctxFirst.preceding).toHaveLength(0)
    expect(ctxFirst.nextKpTitle).toBe('触发器')
  })

  it('path.json/progress.json 随 zip 往返迁移', async () => {
    const rootA = path.join(tmpRoot, 'zip-a')
    const rootB = path.join(tmpRoot, 'zip-b')
    await seedCourse(rootA, COURSE)
    await initPath(rootA, COURSE, [
      { id: 'k1', chapterId: 'ch-03', title: '锁存器' },
      { id: 'k2', chapterId: 'ch-03', title: '触发器' }
    ])
    await saveKpLesson(rootA, COURSE, kpLesson('k1', '锁存器'))
    await startKp(rootA, COURSE, 'k1')
    await completeKp(rootA, COURSE, 'k1', { quizBest: '3/3', digest: { core: 'c', takeaway: 't' } })
    await skipKp(rootA, COURSE, 'k2')

    const zip = await exportCourseZipV2Buffer(rootA, COURSE)
    await importCourseZipV2Buffer(rootB, zip)
    const pathB = await getPath(rootB, COURSE)
    expect(pathB.kps[0].genStatus).toBe('ready')
    expect(pathB.kps[0].lessonFile).toBe('chapters/ch-03/k1.json')
    const progressB = await getProgress(rootB, COURSE)
    expect(progressB.kps.find((k) => k.kpId === 'k1')).toMatchObject({ state: 'completed', quizBest: '3/3' })
    expect(progressB.kps.find((k) => k.kpId === 'k2')?.state).toBe('skipped')
    expect(progressB.currentKpId).toBeUndefined()
    expect(isKpUnlocked(pathB, progressB, 'k2')).toBe(true)
  })
})
