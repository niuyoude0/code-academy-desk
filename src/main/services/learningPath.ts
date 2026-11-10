import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import type { ZodType } from 'zod'
import {
  PathFileSchema,
  ProgressFileSchema,
  PATH_FILE,
  PROGRESS_FILE
} from '../../shared/learning-path-schema'
import type { PathFile, PathEntry, ProgressFile, ProgressKpEntry, KpLearningContext } from '../../shared/learning-path-schema'
import { getLessonV2, getManifestV2, saveLessonV2, CourseV2Error } from './coursePackageV2'

/**
 * P5.3a 学习路径服务（知识点驱动，2026-11-10 用户六原则拍板）：
 *  - path.json / progress.json 存于课程包根（zip 随包迁移，见 coursePackageV2 导入导出）
 *  - 课件落盘仍走 saveLessonV2（先校验后落盘），本服务只负责 KP 状态机与解锁规则
 *  - 解锁：线性 + 可回溯 + 可跳过；判定门槛在调用方（学习页）执行，服务只记录与校验记录合法性
 */

const now = (): string => new Date().toISOString()

function assertKpId(kpId: string): void {
  if (!/^[\w\-]+$/.test(kpId) || kpId.length > 80) throw new CourseV2Error(`非法知识点 id: ${kpId}`)
}

async function readJson<T>(file: string, schema: ZodType<T>, label: string): Promise<T> {
  if (!existsSync(file)) throw new CourseV2Error(`${label} 不存在`)
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    throw new CourseV2Error(`${label} 不是合法 JSON`)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new CourseV2Error(`${label} 校验失败: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  return parsed.data
}

async function readPath(coursesRoot: string, courseId: string): Promise<PathFile> {
  return readJson<PathFile>(
    path.join(coursesRoot, courseId, PATH_FILE),
    PathFileSchema,
    'path.json'
  )
}

async function writePath(coursesRoot: string, courseId: string, p: PathFile): Promise<void> {
  await fs.writeFile(
    path.join(coursesRoot, courseId, PATH_FILE),
    JSON.stringify({ ...p, updatedAt: now() }, null, 2),
    'utf-8'
  )
}

async function readProgress(coursesRoot: string, courseId: string): Promise<ProgressFile> {
  const file = path.join(coursesRoot, courseId, PROGRESS_FILE)
  if (!existsSync(file)) {
    // 进度文件允许缺失（导入纯内容包时）；首次访问即初始化
    const init: ProgressFile = ProgressFileSchema.parse({
      schemaVersion: '2.0',
      courseId,
      updatedAt: now(),
      kps: []
    })
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(init, null, 2), 'utf-8')
    return init
  }
  return readJson<ProgressFile>(file, ProgressFileSchema, 'progress.json')
}

async function writeProgress(coursesRoot: string, courseId: string, p: ProgressFile): Promise<void> {
  await fs.writeFile(
    path.join(coursesRoot, courseId, PROGRESS_FILE),
    JSON.stringify({ ...p, updatedAt: now() }, null, 2),
    'utf-8'
  )
}

/** 当前学习位置 = 路径顺序上第一个未完成/未跳过的 KP。 */
function deriveCurrentKp(pathFile: PathFile, progress: ProgressFile): string | undefined {
  const settled = new Set(progress.kps.filter((k) => k.state !== 'learning').map((k) => k.kpId))
  return pathFile.kps.find((k) => !settled.has(k.id))?.id
}

/** KP 是否已解锁：路径顺序上它之前的 KP 全部 completed/skipped。 */
export function isKpUnlocked(pathFile: PathFile, progress: ProgressFile, kpId: string): boolean {
  const idx = pathFile.kps.findIndex((k) => k.id === kpId)
  if (idx < 0) throw new CourseV2Error(`知识点不在学习路径中: ${kpId}`)
  const settled = new Set(progress.kps.filter((k) => k.state === 'completed' || k.state === 'skipped').map((k) => k.kpId))
  return pathFile.kps.slice(0, idx).every((k) => settled.has(k.id))
}

/** 初始化学习路径（factsheet 知识点清单直译；已存在则拒绝，骨架调整走 replacePath）。 */
export async function initPath(
  coursesRoot: string,
  courseId: string,
  kps: { id: string; chapterId: string; title: string; bookPage?: number; interactivity?: PathEntry['interactivity'] }[]
): Promise<PathFile> {
  const file = path.join(coursesRoot, courseId, PATH_FILE)
  if (existsSync(file)) throw new CourseV2Error('path.json 已存在，拒绝覆盖（调整骨架请用 replacePath）')
  const manifest = await getManifestV2(coursesRoot, courseId)
  const chapterIds = new Set(manifest.chapters.map((c) => c.id))
  const seen = new Set<string>()
  for (const kp of kps) {
    assertKpId(kp.id)
    if (seen.has(kp.id)) throw new CourseV2Error(`知识点 id 重复: ${kp.id}`)
    seen.add(kp.id)
    if (!chapterIds.has(kp.chapterId)) throw new CourseV2Error(`知识点 ${kp.id} 的章节不存在: ${kp.chapterId}`)
  }
  const pathFile: PathFile = PathFileSchema.parse({
    schemaVersion: '2.0',
    courseId,
    updatedAt: now(),
    kps: kps.map((k) => ({
      id: k.id,
      chapterId: k.chapterId,
      title: k.title,
      ...(k.bookPage != null ? { bookPage: k.bookPage } : {}),
      ...(k.interactivity != null ? { interactivity: k.interactivity } : {}),
      genStatus: 'pending'
    }))
  })
  await writePath(coursesRoot, courseId, pathFile)
  return pathFile
}

/** 全量替换学习路径骨架（校对界面调整 KP 用；已产生的课件文件不动）。 */
export async function replacePath(
  coursesRoot: string,
  courseId: string,
  kps: Parameters<typeof initPath>[2]
): Promise<PathFile> {
  const file = path.join(coursesRoot, courseId, PATH_FILE)
  if (existsSync(file)) await fs.rm(file)
  return initPath(coursesRoot, courseId, kps)
}

export async function getPath(coursesRoot: string, courseId: string): Promise<PathFile> {
  return readPath(coursesRoot, courseId)
}

/** 保存 KP 课件：lessonId 必须是路径上的 KP id，落盘走 saveLessonV2（铁律校验/manifest 回填）后更新生成状态。 */
export async function saveKpLesson(
  coursesRoot: string,
  courseId: string,
  lesson: unknown
): Promise<{ file: string; kpId: string }> {
  const pathFile = await readPath(coursesRoot, courseId)
  const doc = lesson as { lessonId?: unknown }
  const kpId = typeof doc?.lessonId === 'string' ? doc.lessonId : ''
  const entry = pathFile.kps.find((k) => k.id === kpId)
  if (entry == null) throw new CourseV2Error(`lessonId 不是路径上的知识点: ${kpId || '(空)'}`)
  const { file } = await saveLessonV2(coursesRoot, courseId, entry.chapterId, lesson)
  const nextKps = pathFile.kps.map((k) =>
    k.id === kpId ? { ...k, genStatus: 'ready' as const, lessonFile: file, genError: undefined } : k
  )
  await writePath(coursesRoot, courseId, { ...pathFile, kps: nextKps })
  return { file, kpId }
}

/** 标记生成失败（返工上限到达后；失败原因写 path.json 该 KP 的 genError）。 */
export async function setKpGenFailed(
  coursesRoot: string,
  courseId: string,
  kpId: string,
  reason: string
): Promise<void> {
  assertKpId(kpId)
  const pathFile = await readPath(coursesRoot, courseId)
  if (!pathFile.kps.some((k) => k.id === kpId)) throw new CourseV2Error(`知识点不存在: ${kpId}`)
  const nextKps = pathFile.kps.map((k) =>
    k.id === kpId ? { ...k, genStatus: 'failed' as const, genError: reason.slice(0, 2000) } : k
  )
  await writePath(coursesRoot, courseId, { ...pathFile, kps: nextKps })
}

export async function getProgress(coursesRoot: string, courseId: string): Promise<ProgressFile> {
  return readProgress(coursesRoot, courseId)
}

/** 开始/回溯学习某 KP。仅解锁的 KP 可开始；currentKpId 始终按「首个未结算 KP」重算（回溯不拨动指针）。 */
export async function startKp(coursesRoot: string, courseId: string, kpId: string): Promise<ProgressFile> {
  assertKpId(kpId)
  const pathFile = await readPath(coursesRoot, courseId)
  const progress = await readProgress(coursesRoot, courseId)
  if (!isKpUnlocked(pathFile, progress, kpId)) {
    throw new CourseV2Error(`知识点未解锁: ${kpId}（渐进式：需先完成/跳过前面的知识点）`)
  }
  const old = progress.kps.find((k) => k.kpId === kpId)
  const entry: ProgressKpEntry = {
    kpId,
    state: 'learning',
    ...(old?.digest != null ? { digest: old.digest } : {})
  }
  const others = progress.kps.filter((k) => k.kpId !== kpId)
  const next: ProgressFile = {
    ...progress,
    currentKpId: deriveCurrentKp(pathFile, progress),
    kps: [...others, entry]
  }
  await writeProgress(coursesRoot, courseId, next)
  return next
}

/** '2/3' → 0.667；格式非法返回 null。 */
function parseRatio(quizBest: string | undefined): number | null {
  if (quizBest == null) return null
  const m = /^(\d+)\/(\d+)$/.exec(quizBest)
  if (m == null) return null
  const got = Number(m[1])
  const total = Number(m[2])
  if (!Number.isFinite(got) || !Number.isFinite(total) || total <= 0 || got < 0 || got > total) return null
  return got / total
}

/* ===== digest 链（P5.7：判定通过即定稿，链不再断） ===== */

/**
 * 从课件文档提取 digest（completeKp 的兜底提取；Agent 未调 cad_save_kp_digest 时保证链不断）。
 * 规则：core = summary 块要点全文（≤500 字）；takeaway = 第一个要点卡背面（缺省正面）（≤500 字）。
 * 无 summary 时 core 退化为要点卡正面拼接；两者皆无返回 null（保持链上空缺，不造假摘要）。
 */
export function extractDigestFromDoc(doc: unknown): { core: string; takeaway: string } | null {
  const blocks = (doc as { blocks?: unknown } | null)?.blocks
  if (!Array.isArray(blocks)) return null
  const summaryPoints: string[] = []
  const kpFronts: string[] = []
  let takeaway = ''
  for (const b of blocks) {
    if (b == null || typeof b !== 'object') continue
    const block = b as Record<string, unknown>
    if (block.type === 'summary' && Array.isArray(block.points)) {
      for (const p of block.points) {
        if (typeof p === 'string' && p.trim().length > 0) summaryPoints.push(p)
      }
    } else if (block.type === 'keypoint') {
      const front = typeof block.front === 'string' ? block.front : ''
      const back = typeof block.back === 'string' ? block.back : ''
      if (takeaway === '' && back.trim().length > 0) takeaway = back
      if (front.trim().length > 0) kpFronts.push(front)
    }
  }
  const coreSource = summaryPoints.length > 0 ? summaryPoints.join('\n') : kpFronts.join('\n')
  const core = coreSource.trim().slice(0, 500)
  if (core.length === 0) return null
  if (takeaway.trim().length === 0) takeaway = summaryPoints[summaryPoints.length - 1] ?? core
  return { core, takeaway: takeaway.trim().slice(0, 500) }
}

/**
 * 直接写入/修订某 KP 的 digest（Agent cad_save_kp_digest 与校对页人工定稿共用）。
 * 无学习条目时创建 learning 态条目（不影响解锁与当前位推导）；已有条目只补 digest 不动状态。
 */
export async function saveKpDigest(
  coursesRoot: string,
  courseId: string,
  kpId: string,
  digest: { core: string; takeaway: string }
): Promise<ProgressFile> {
  assertKpId(kpId)
  const core = digest.core.trim()
  const takeaway = digest.takeaway.trim()
  if (core.length === 0 || takeaway.length === 0) {
    throw new CourseV2Error('digest 的 core/takeaway 不能为空')
  }
  if (core.length > 500 || takeaway.length > 500) {
    throw new CourseV2Error('digest 的 core/takeaway 超过 500 字上限')
  }
  const pathFile = await readPath(coursesRoot, courseId)
  if (!pathFile.kps.some((k) => k.id === kpId)) throw new CourseV2Error(`知识点不在学习路径中: ${kpId}`)
  const progress = await readProgress(coursesRoot, courseId)
  const old = progress.kps.find((k) => k.kpId === kpId)
  const entry: ProgressKpEntry = {
    kpId,
    ...(old?.state != null ? { state: old.state } : { state: 'learning' as const }),
    ...(old?.forced != null ? { forced: old.forced } : {}),
    ...(old?.quizBest != null ? { quizBest: old.quizBest } : {}),
    ...(old?.codingPassed != null ? { codingPassed: old.codingPassed } : {}),
    ...(old?.completedAt != null ? { completedAt: old.completedAt } : {}),
    digest: { core, takeaway }
  }
  const others = progress.kps.filter((k) => k.kpId !== kpId)
  const next: ProgressFile = {
    ...progress,
    currentKpId: deriveCurrentKp(pathFile, progress),
    kps: [...others, entry]
  }
  await writeProgress(coursesRoot, courseId, next)
  return next
}

/**
 * 完成知识点（判定门槛：quiz ≥ 2/3 且编程题未失败）。
 * - 达标 → completed；未达标但 forced=true → completed（记 forced，应急门）
 * - digest 随完成定稿（生成任务时产出的摘要在此入链）
 */
export async function completeKp(
  coursesRoot: string,
  courseId: string,
  kpId: string,
  result: { quizBest?: string; codingPassed?: boolean; forced?: boolean; digest?: { core: string; takeaway: string } }
): Promise<ProgressFile> {
  assertKpId(kpId)
  const pathFile = await readPath(coursesRoot, courseId)
  const progress = await readProgress(coursesRoot, courseId)
  if (!pathFile.kps.some((k) => k.id === kpId)) throw new CourseV2Error(`知识点不在学习路径中: ${kpId}`)

  const ratio = parseRatio(result.quizBest)
  if (!result.forced) {
    if (ratio == null || ratio < 2 / 3) {
      throw new CourseV2Error(`完成判定未达标（quiz ≥ 2/3）: quizBest=${result.quizBest ?? '(无)'}；如需应急继续请 forced=true`)
    }
    if (result.codingPassed === false) {
      throw new CourseV2Error('编程题判定未通过；如需应急继续请 forced=true')
    }
  }

  const old = progress.kps.find((k) => k.kpId === kpId)
  // digest 定稿：显式传入 > 链上已有 > 课件自动提取（P5.4 残留修复：判定通过即入链，前序 KP 不再被当 gap）
  let digest = result.digest ?? old?.digest
  if (digest == null) {
    const pathEntry = pathFile.kps.find((k) => k.id === kpId)
    if (pathEntry != null) {
      try {
        digest = extractDigestFromDoc(await getLessonV2(coursesRoot, courseId, pathEntry.chapterId, kpId)) ?? undefined
      } catch {
        // 课件缺失/损坏不阻断完成判定，digest 链留待 cad_save_kp_digest 或校对页人工定稿
      }
    }
  }
  const entry: ProgressKpEntry = {
    kpId,
    state: 'completed',
    ...(result.forced === true ? { forced: true } : {}),
    ...(result.quizBest != null ? { quizBest: result.quizBest } : {}),
    ...(result.codingPassed != null ? { codingPassed: result.codingPassed } : {}),
    completedAt: now(),
    // 回溯重学未带新 digest 时保留旧摘要（digest 链只增不改坏）
    ...(digest != null ? { digest } : {})
  }
  const others = progress.kps.filter((k) => k.kpId !== kpId)
  const next: ProgressFile = {
    ...progress,
    currentKpId: deriveCurrentKp(pathFile, { ...progress, kps: [...others, entry] }),
    kps: [...others, entry]
  }
  await writeProgress(coursesRoot, courseId, next)
  return next
}

/** 跳过知识点（须已解锁；digest 链留下空缺，getLearningContext 会以 gap 提示生成侧）。 */
export async function skipKp(coursesRoot: string, courseId: string, kpId: string): Promise<ProgressFile> {
  assertKpId(kpId)
  const pathFile = await readPath(coursesRoot, courseId)
  const progress = await readProgress(coursesRoot, courseId)
  if (!pathFile.kps.some((k) => k.id === kpId)) throw new CourseV2Error(`知识点不在学习路径中: ${kpId}`)
  if (!isKpUnlocked(pathFile, progress, kpId)) {
    throw new CourseV2Error(`知识点未解锁，不能跳过: ${kpId}`)
  }
  const entry: ProgressKpEntry = { kpId, state: 'skipped' }
  const others = progress.kps.filter((k) => k.kpId !== kpId)
  const next: ProgressFile = {
    ...progress,
    currentKpId: deriveCurrentKp(pathFile, { ...progress, kps: [...others, entry] }),
    kps: [...others, entry]
  }
  await writeProgress(coursesRoot, courseId, next)
  return next
}

/**
 * 组装生成上下文包：已完成 KP 的 digest 链（跳过的以 gap 占位）+ 当前 KP factsheet 定位 + 下一 KP 预告。
 * 生成侧拿这个拼提示词，不回读旧课件全文（token 可控）。
 */
export async function getLearningContext(
  coursesRoot: string,
  courseId: string,
  kpId: string
): Promise<KpLearningContext> {
  assertKpId(kpId)
  const pathFile = await readPath(coursesRoot, courseId)
  const progress = await readProgress(coursesRoot, courseId)
  const idx = pathFile.kps.findIndex((k) => k.id === kpId)
  if (idx < 0) throw new CourseV2Error(`知识点不在学习路径中: ${kpId}`)
  const entry = pathFile.kps[idx]
  const byKp = new Map(progress.kps.map((k) => [k.kpId, k]))
  const preceding = pathFile.kps.slice(0, idx).map((k) => {
    const p = byKp.get(k.id)
    if (p?.state === 'completed' && p.digest != null) {
      return { kpId: k.id, title: k.title, core: p.digest.core, takeaway: p.digest.takeaway }
    }
    if (p?.state === 'skipped') return { kpId: k.id, title: k.title, gap: true as const }
    // 未完成但在前面（理论上仅回溯场景出现）：按空缺处理
    return { kpId: k.id, title: k.title, gap: true as const }
  })
  return {
    kpId: entry.id,
    title: entry.title,
    chapterId: entry.chapterId,
    ...(entry.bookPage != null ? { bookPage: entry.bookPage } : {}),
    ...(entry.interactivity != null ? { interactivity: entry.interactivity } : {}),
    preceding,
    nextKpTitle: pathFile.kps[idx + 1]?.title ?? null
  }
}
