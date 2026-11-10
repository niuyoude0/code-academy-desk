import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import type { ZodType } from 'zod'
import JSZip from 'jszip'
import {
  CourseManifestV2Schema,
  ReviewFileSchema,
  ExerciseDocumentSchema,
  MANIFEST_V2_FILE,
  REVIEW_FILE
} from '../../shared/course-v2-schema'
import {
  PathFileSchema,
  ProgressFileSchema,
  PATH_FILE,
  PROGRESS_FILE
} from '../../shared/learning-path-schema'
import type {
  CourseManifestV2,
  ChapterNodeV2,
  ReviewFile,
  ReviewStatus,
  ExerciseDocument
} from '../../shared/course-v2-schema'
import { validateLessonDocument, type ValidationResult } from '../../shared/lesson-schema'
import { upsertCourseIndexEntry } from './coursePackage'

/**
 * P5.2 课程包 v2 读写服务：
 *  - 目录即包：manifest.json（章节树/生成信息/教材引用）+ chapters/ + exercises/ + assets/ + review.json
 *  - 内容文件落盘前全部过 zod/铁律校验（Agent 与人工两条写入路径一致）
 *  - 局部重生成 = 覆写单个 lesson 文件 + 更新 manifest.updatedAt/生成信息
 *  - 与 v1 共存同一 coursesRoot（清单文件名区分）与同一份 index.json
 */

export class CourseV2Error extends Error {}

const now = (): string => new Date().toISOString()

function assertCourseId(courseId: string): void {
  if (
    courseId.length === 0 ||
    courseId === '.' ||
    courseId === '..' ||
    courseId.includes('/') ||
    courseId.includes('\\')
  ) {
    throw new CourseV2Error(`非法课程 id: ${courseId}`)
  }
}

function courseDir(coursesRoot: string, courseId: string): string {
  assertCourseId(courseId)
  return path.join(coursesRoot, courseId)
}

async function readJson<T>(file: string, schema: ZodType<T>, label: string): Promise<T> {
  if (!existsSync(file)) throw new CourseV2Error(`${label} 不存在: ${path.basename(file)}`)
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    throw new CourseV2Error(`${label} 不是合法 JSON: ${path.basename(file)}`)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new CourseV2Error(`${label} 校验失败: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  return parsed.data
}

async function readManifest(coursesRoot: string, courseId: string): Promise<CourseManifestV2> {
  const file = path.join(courseDir(coursesRoot, courseId), MANIFEST_V2_FILE)
  if (!existsSync(file)) {
    // 与 v1 课程区分开的可读错误
    if (existsSync(path.join(coursesRoot, courseId, 'course-package.json'))) {
      throw new CourseV2Error(`课程「${courseId}」是 v1 格式，请通过 v1 路径访问`)
    }
    throw new CourseV2Error(`课程不存在: ${courseId}`)
  }
  return readJson<CourseManifestV2>(file, CourseManifestV2Schema, 'manifest.json')
}

async function writeManifest(coursesRoot: string, courseId: string, manifest: CourseManifestV2): Promise<void> {
  const dir = courseDir(coursesRoot, courseId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, MANIFEST_V2_FILE), JSON.stringify(manifest, null, 2), 'utf-8')
}

/** 重算索引条目并落盘（章节/练习/审核计数）。 */
async function refreshIndexEntry(coursesRoot: string, courseId: string): Promise<void> {
  const manifest = await readManifest(coursesRoot, courseId)
  const exercisesDir = path.join(courseDir(coursesRoot, courseId), 'exercises')
  const exerciseCount = existsSync(exercisesDir) ? (await fs.readdir(exercisesDir)).filter((f) => f.endsWith('.json')).length : 0
  let reviewApproved = 0
  const reviewFile = path.join(courseDir(coursesRoot, courseId), REVIEW_FILE)
  if (existsSync(reviewFile)) {
    const review = await readJson<ReviewFile>(reviewFile, ReviewFileSchema, 'review.json')
    reviewApproved = review.reviews.filter((r) => r.status === 'approved').length
  }
  const lessonTotal = manifest.chapters.reduce((n, c) => n + c.lessons.length, 0)
  await upsertCourseIndexEntry(coursesRoot, {
    id: manifest.id,
    title: manifest.title,
    language: manifest.language,
    chapterCount: manifest.chapters.length,
    exerciseCount,
    importedAt: manifest.createdAt,
    schemaVersion: '2.0',
    reviewApproved,
    reviewTotal: lessonTotal
  })
}

/** 创建 v2 课程（目录脚手架 + manifest + 索引）。 */
export async function createCourseV2(
  coursesRoot: string,
  input: {
    id: string
    title: string
    language?: string
    description?: string
    sourceRef?: CourseManifestV2['sourceRef']
    generation?: CourseManifestV2['generation']
  }
): Promise<CourseManifestV2> {
  const dir = courseDir(coursesRoot, input.id)
  if (existsSync(dir)) throw new CourseV2Error(`课程已存在，拒绝覆盖: ${input.id}`)
  const ts = now()
  const manifest: CourseManifestV2 = CourseManifestV2Schema.parse({
    schemaVersion: '2.0',
    id: input.id,
    title: input.title,
    language: input.language ?? 'mixed',
    ...(input.description != null ? { description: input.description } : {}),
    createdAt: ts,
    updatedAt: ts,
    ...(input.sourceRef != null ? { sourceRef: input.sourceRef } : {}),
    ...(input.generation != null ? { generation: input.generation } : {}),
    chapters: []
  })
  await fs.mkdir(path.join(dir, 'chapters'), { recursive: true })
  await fs.mkdir(path.join(dir, 'exercises'), { recursive: true })
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
  await writeManifest(coursesRoot, input.id, manifest)
  await fs.writeFile(path.join(dir, REVIEW_FILE), JSON.stringify({ reviews: [] }, null, 2), 'utf-8')
  await refreshIndexEntry(coursesRoot, input.id)
  return manifest
}

export async function getManifestV2(coursesRoot: string, courseId: string): Promise<CourseManifestV2> {
  return readManifest(coursesRoot, courseId)
}

/** 新增章节（id 重复拒绝）。 */
export async function addChapterV2(
  coursesRoot: string,
  courseId: string,
  chapter: { id: string; title: string }
): Promise<CourseManifestV2> {
  const manifest = await readManifest(coursesRoot, courseId)
  if (manifest.chapters.some((c) => c.id === chapter.id)) {
    throw new CourseV2Error(`章节已存在: ${chapter.id}`)
  }
  const node: ChapterNodeV2 = { id: chapter.id, title: chapter.title, lessons: [] }
  const next = { ...manifest, updatedAt: now(), chapters: [...manifest.chapters, node] }
  await writeManifest(coursesRoot, courseId, next)
  await refreshIndexEntry(coursesRoot, courseId)
  return next
}

/**
 * 保存课件文档（局部重生成就是再次调用本函数覆写同一文件）。
 * 校验失败抛 CourseV2Error（message 含错误清单），渲染器/插件两侧共用同一规则。
 */
export async function saveLessonV2(
  coursesRoot: string,
  courseId: string,
  chapterId: string,
  lesson: unknown
): Promise<{ validation: ValidationResult; file: string }> {
  const manifest = await readManifest(coursesRoot, courseId)
  const chapter = manifest.chapters.find((c) => c.id === chapterId)
  if (chapter == null) throw new CourseV2Error(`章节不存在: ${chapterId}`)

  const validation = validateLessonDocument(lesson)
  if (!validation.ok) {
    const first = validation.errors
      .slice(0, 5)
      .map((e) => `${e.path}: ${e.message}`)
      .join('; ')
    throw new CourseV2Error(`课件校验失败（${validation.errors.length} 处）: ${first}`)
  }
  const doc = lesson as { lessonId: string; title: string }
  const fileRel = `chapters/${chapterId}/${doc.lessonId}.json`
  const dir = path.join(courseDir(coursesRoot, courseId), 'chapters', chapterId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${doc.lessonId}.json`), JSON.stringify(lesson, null, 2), 'utf-8')

  // manifest：新增 lessonRef 或更新标题
  const lessonRef = { lessonId: doc.lessonId, title: doc.title, file: fileRel }
  const nextChapters = manifest.chapters.map((c) => {
    if (c.id !== chapterId) return c
    const exists = c.lessons.some((l) => l.lessonId === doc.lessonId)
    const lessons = exists
      ? c.lessons.map((l) => (l.lessonId === doc.lessonId ? lessonRef : l))
      : [...c.lessons, lessonRef]
    return { ...c, lessons }
  })
  await writeManifest(coursesRoot, courseId, {
    ...manifest,
    updatedAt: now(),
    chapters: nextChapters
  })
  await refreshIndexEntry(coursesRoot, courseId)
  return { validation, file: fileRel }
}

export async function getLessonV2(
  coursesRoot: string,
  courseId: string,
  chapterId: string,
  lessonId: string
): Promise<unknown> {
  assertCourseId(lessonId)
  const file = path.join(courseDir(coursesRoot, courseId), 'chapters', chapterId, `${lessonId}.json`)
  if (!existsSync(file)) throw new CourseV2Error(`课件不存在: ${chapterId}/${lessonId}`)
  const raw: unknown = JSON.parse(await fs.readFile(file, 'utf-8'))
  const validation = validateLessonDocument(raw)
  if (!validation.ok) {
    throw new CourseV2Error(`课件数据损坏（${validation.errors.length} 处）: ${validation.errors[0]?.path}`)
  }
  return raw
}

/** 保存练习（exercises/ex-<id>.json，v1 Exercise 结构复用）。 */
export async function saveExerciseV2(
  coursesRoot: string,
  courseId: string,
  exercise: unknown
): Promise<void> {
  const parsed = ExerciseDocumentSchema.safeParse(exercise)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new CourseV2Error(`练习校验失败: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  const dir = path.join(courseDir(coursesRoot, courseId), 'exercises')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${parsed.data.id}.json`), JSON.stringify(parsed.data, null, 2), 'utf-8')
  await refreshIndexEntry(coursesRoot, courseId)
}

export async function getExerciseV2(
  coursesRoot: string,
  courseId: string,
  exerciseId: string
): Promise<ExerciseDocument> {
  assertCourseId(exerciseId)
  const file = path.join(courseDir(coursesRoot, courseId), 'exercises', `${exerciseId}.json`)
  return readJson<ExerciseDocument>(file, ExerciseDocumentSchema, '练习')
}

/* ===== assets 资源（P5.5 image 块渲染） ===== */

const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
}
const ASSET_MAX_BYTES = 20 * 1024 * 1024

/** 读课程包 assets/ 内图片 → data URL（路径铁律：仅 assets/ 前缀、禁 .. 与绝对路径、≤20MB）。 */
export async function getCourseAssetDataUrl(coursesRoot: string, courseId: string, relPath: string): Promise<string> {
  const norm = relPath.replaceAll('\\', '/')
  if (path.isAbsolute(norm) || norm.includes('..')) {
    throw new CourseV2Error(`非法资源路径: ${relPath}`)
  }
  const parts = norm.split('/').filter((p) => p.length > 0 && p !== '.')
  if (parts[0] !== 'assets' || parts.length < 2) {
    throw new CourseV2Error('image.path 仅允许引用 assets/ 内文件（包内相对路径）')
  }
  const file = path.join(courseDir(coursesRoot, courseId), ...parts)
  const st = await fs.stat(file).catch(() => null)
  if (st == null || !st.isFile()) throw new CourseV2Error(`资源不存在: ${relPath}`)
  if (st.size > ASSET_MAX_BYTES) throw new CourseV2Error(`资源超过 20MB 上限: ${relPath}`)
  const mime = ASSET_MIME[path.extname(file).toLowerCase()]
  if (mime == null) throw new CourseV2Error(`不支持的图片格式: ${path.extname(file) || '(无扩展名)'}`)
  const buf = await fs.readFile(file)
  return `data:${mime};base64,${buf.toString('base64')}`
}

/** 更新生成信息（任务页进度用；不改则不写字段）。 */
export async function updateGenerationV2(
  coursesRoot: string,
  courseId: string,
  patch: { model?: string; skillVersion?: string; lastRunAt?: string }
): Promise<CourseManifestV2> {
  const manifest = await readManifest(coursesRoot, courseId)
  const next = {
    ...manifest,
    updatedAt: now(),
    generation: { ...manifest.generation, ...patch }
  }
  await writeManifest(coursesRoot, courseId, next)
  return next
}

async function readReviewFile(coursesRoot: string, courseId: string): Promise<ReviewFile> {
  const file = path.join(courseDir(coursesRoot, courseId), REVIEW_FILE)
  if (!existsSync(file)) return { reviews: [] }
  return readJson<ReviewFile>(file, ReviewFileSchema, 'review.json')
}

export async function getReviewsV2(coursesRoot: string, courseId: string): Promise<ReviewFile> {
  return readReviewFile(coursesRoot, courseId)
}

/** 设置课件审核状态（校对页动作；failed 必须带错误清单）。 */
export async function setReviewStatusV2(
  coursesRoot: string,
  courseId: string,
  lessonId: string,
  status: ReviewStatus,
  extra?: { errors?: ValidationResult['errors']; feedback?: string }
): Promise<ReviewFile> {
  assertCourseId(lessonId)
  const review = await readReviewFile(coursesRoot, courseId)
  const record = {
    lessonId,
    status,
    ...(extra?.errors != null ? { errors: extra.errors } : {}),
    ...(extra?.feedback != null ? { feedback: extra.feedback } : {}),
    updatedAt: now()
  }
  const others = review.reviews.filter((r) => r.lessonId !== lessonId)
  const next: ReviewFile = { reviews: [...others, record] }
  await fs.writeFile(
    path.join(courseDir(coursesRoot, courseId), REVIEW_FILE),
    JSON.stringify(next, null, 2),
    'utf-8'
  )
  await refreshIndexEntry(coursesRoot, courseId)
  return next
}

/* ===== zip 导入导出（v2 结构整体打包；内容文件逐个校验） ===== */

async function addDirToZip(zip: JSZip, fsDir: string, zipPath: string): Promise<void> {
  if (!existsSync(fsDir)) return
  for (const name of await fs.readdir(fsDir)) {
    const abs = path.join(fsDir, name)
    const stat = await fs.stat(abs)
    const entryPath = `${zipPath}/${name}`
    if (stat.isDirectory()) await addDirToZip(zip, abs, entryPath)
    else zip.file(entryPath, await fs.readFile(abs))
  }
}

export async function exportCourseZipV2Buffer(coursesRoot: string, courseId: string): Promise<Buffer> {
  const manifest = await readManifest(coursesRoot, courseId)
  const dir = courseDir(coursesRoot, courseId)
  const zip = new JSZip()
  zip.file(MANIFEST_V2_FILE, JSON.stringify(manifest, null, 2))
  const review = await getReviewsV2(coursesRoot, courseId)
  zip.file(REVIEW_FILE, JSON.stringify(review, null, 2))
  // 学习路径与进度随包迁移（P5.3a）
  for (const name of [PATH_FILE, PROGRESS_FILE]) {
    const f = path.join(dir, name)
    if (existsSync(f)) zip.file(name, await fs.readFile(f))
  }
  await addDirToZip(zip, path.join(dir, 'chapters'), 'chapters')
  await addDirToZip(zip, path.join(dir, 'exercises'), 'exercises')
  await addDirToZip(zip, path.join(dir, 'assets'), 'assets')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export async function exportCourseZipV2(
  coursesRoot: string,
  courseId: string,
  outZipPath: string
): Promise<void> {
  const buffer = await exportCourseZipV2Buffer(coursesRoot, courseId)
  await fs.mkdir(path.dirname(outZipPath), { recursive: true })
  await fs.writeFile(outZipPath, buffer)
}

export interface ImportCourseV2Result {
  courseId: string
  title: string
  chapterCount: number
  lessonCount: number
  exerciseCount: number
}

/** 从内存 zip 导入 v2 课程（先整体校验后落盘，失败回滚）。 */
export async function importCourseZipV2Buffer(
  coursesRoot: string,
  zipBuffer: Buffer
): Promise<ImportCourseV2Result> {
  const zip = await JSZip.loadAsync(zipBuffer)
  const manifestEntry = zip.file(MANIFEST_V2_FILE)
  if (manifestEntry == null) throw new CourseV2Error(`课程包缺少 ${MANIFEST_V2_FILE}`)
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(await manifestEntry.async('string'))
  } catch {
    throw new CourseV2Error('manifest.json 不是合法 JSON')
  }
  const parsedManifest = CourseManifestV2Schema.safeParse(manifestRaw)
  if (!parsedManifest.success) {
    const issue = parsedManifest.error.issues[0]
    throw new CourseV2Error(`manifest.json 校验失败: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  const manifest = parsedManifest.data
  const dir = courseDir(coursesRoot, manifest.id)
  if (existsSync(dir)) throw new CourseV2Error(`课程已存在，拒绝覆盖: ${manifest.id}`)

  const contentEntries: { name: string; json: unknown }[] = []
  const assetEntries: { name: string; data: Buffer }[] = []
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name]
    if (entry.dir) continue
    if (name === MANIFEST_V2_FILE || name === REVIEW_FILE || name === PATH_FILE || name === PROGRESS_FILE) continue
    if (name.endsWith('.json')) {
      contentEntries.push({ name, json: await readEntryJson(entry, name) })
    } else {
      assetEntries.push({ name, data: await entry.async('nodebuffer') })
    }
  }

  // 内容文件先全量校验（课件过铁律、练习过 Exercise schema；其余 json 拒绝）
  const lessonFiles = contentEntries.filter((e) => e.name.startsWith('chapters/'))
  const exerciseFiles = contentEntries.filter((e) => e.name.startsWith('exercises/'))
  const unknownFiles = contentEntries.filter(
    (e) => !e.name.startsWith('chapters/') && !e.name.startsWith('exercises/')
  )
  if (unknownFiles.length > 0) {
    throw new CourseV2Error(`课程包包含未知内容文件（只允许 chapters/ 与 exercises/ 下的 .json）: ${unknownFiles[0].name}`)
  }
  for (const f of lessonFiles) {
    const validation = validateLessonDocument(f.json)
    if (!validation.ok) {
      throw new CourseV2Error(
        `课件校验失败 ${f.name}（${validation.errors.length} 处）: ${validation.errors[0]?.path} ${validation.errors[0]?.message}`
      )
    }
  }
  for (const f of exerciseFiles) {
    const parsed = ExerciseDocumentSchema.safeParse(f.json)
    if (!parsed.success) {
      throw new CourseV2Error(`练习校验失败 ${f.name}: ${parsed.error.issues[0]?.message}`)
    }
  }

  await fs.mkdir(dir, { recursive: true })
  try {
    for (const f of lessonFiles) {
      const dest = path.join(dir, ...f.name.split('/'))
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, JSON.stringify(f.json, null, 2), 'utf-8')
    }
    for (const f of exerciseFiles) {
      const dest = path.join(dir, ...f.name.split('/'))
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, JSON.stringify(f.json, null, 2), 'utf-8')
    }
    for (const a of assetEntries) {
      if (a.data.byteLength > 64 * 1024 * 1024) {
        throw new CourseV2Error(`资源超过单文件上限（64MB）: ${a.name}`)
      }
      const dest = path.join(dir, ...a.name.split('/'))
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, a.data)
    }
    const reviewEntry = zip.file(REVIEW_FILE)
    if (reviewEntry != null) {
      const parsedReview = ReviewFileSchema.parse(await readEntryJson(reviewEntry, REVIEW_FILE))
      await fs.writeFile(path.join(dir, REVIEW_FILE), JSON.stringify(parsedReview, null, 2), 'utf-8')
    }
    // path.json / progress.json：有则校验后写入，courseId 必须与 manifest 一致
    for (const [name, schema] of [
      [PATH_FILE, PathFileSchema],
      [PROGRESS_FILE, ProgressFileSchema]
    ] as const) {
      const entry = zip.file(name)
      if (entry == null) continue
      const parsed = schema.safeParse(await readEntryJson(entry, name))
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw new CourseV2Error(`${name} 校验失败: ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      }
      if (parsed.data.courseId !== manifest.id) {
        throw new CourseV2Error(`${name} 的 courseId 与 manifest 不一致: ${parsed.data.courseId}`)
      }
      await fs.writeFile(path.join(dir, name), JSON.stringify(parsed.data, null, 2), 'utf-8')
    }
    await writeManifest(coursesRoot, manifest.id, manifest)
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true })
    throw err
  }

  await refreshIndexEntry(coursesRoot, manifest.id)
  return {
    courseId: manifest.id,
    title: manifest.title,
    chapterCount: manifest.chapters.length,
    lessonCount: manifest.chapters.reduce((n, c) => n + c.lessons.length, 0),
    exerciseCount: exerciseFiles.length
  }
}

/** JSZip 条目安全读取为 JSON（未知文件直接拒绝由调用方处理）。 */
async function readEntryJson(entry: JSZip.JSZipObject, label: string): Promise<unknown> {
  try {
    return JSON.parse(await entry.async('string'))
  } catch {
    throw new CourseV2Error(`${label} 不是合法 JSON`)
  }
}
