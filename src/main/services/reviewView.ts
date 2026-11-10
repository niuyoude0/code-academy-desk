import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import { getManifestV2, CourseV2Error } from './coursePackageV2'
import { getProgress, getPath } from './learningPath'
import { readMaterialPage } from './kpSource'
import { ReviewFileSchema } from '../../shared/course-v2-schema'
import type { ReviewRecord } from '../../shared/course-v2-schema'
import { validateLessonDocument } from '../../shared/lesson-schema'
import { checkLessonCapacity } from '../../shared/lesson-quality'
import type { CapacityWarning } from '../../shared/lesson-quality'

/**
 * P5.7 校对视图服务（review.json 人审的数据面）：
 *  - 全量扫 manifest 章节 → 逐课读盘（损坏课件不抛错，收集进 errors——校对页就是要看坏课件的）
 *  - error 级 = validateLessonDocument；warn 级 = checkLessonCapacity（容量硬标准）
 *  - 页码抽查：块 source（ocrFile 直读优先，缺省按书内页码扫 ocr 页首头部自证）→ OCR 原文
 */

/** book 块的页码锚（页码抽查面板行）。 */
export interface BookBlockAnchor {
  blockId: string
  blockType: string
  pdfPage: number
  bookPage: number | null
  ocrFile?: string
  /** quote 块带摘录前 120 字（面板预览） */
  excerpt?: string
}

export interface LessonReviewItem {
  lessonId: string
  chapterId: string
  chapterTitle: string
  title: string
  file: string
  blockCount: number
  bookBlocks: BookBlockAnchor[]
  review: ReviewRecord | null
  /** error 级（schema/铁律）+ warn 级（容量机检）；文件缺失/JSON 损坏也折进 errors */
  errors: { path: string; message: string }[]
  warns: CapacityWarning[]
  /** 课件原文档（无效课件也给 raw——渲染层尽力渲染，失败显示错误卡）；文件缺失为 null */
  doc: unknown | null
  words: number
}

export interface ReviewOverview {
  courseId: string
  title: string
  /** 教材资料 id（页码抽查用；未关联为 null） */
  materialId: string | null
  reviews: ReviewRecord[]
  lessons: LessonReviewItem[]
  /** 学习路径上的 KP id 集（lessonId 命中 = KP 课件，显示 digest 定稿区） */
  pathKpIds: string[]
  /** progress.json 中已有 digest 的 KP 现值（校对页 digest 定稿区回显） */
  digests: Record<string, { core: string; takeaway: string }>
}

const MAX_LESSON_CHARS = 2_000_000
const MAX_SCAN_FILES = 400

/** 读单课 raw（不校验不抛——损坏/缺失由调用方折进 errors）。 */
async function readLessonRaw(coursesRoot: string, courseId: string, fileRel: string): Promise<unknown | null> {
  const abs = path.join(coursesRoot, courseId, path.posix.normalize(fileRel))
  if (!existsSync(abs)) return null
  const text = (await fs.readFile(abs, 'utf-8')).slice(0, MAX_LESSON_CHARS)
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function readReviewFile(coursesRoot: string, courseId: string): Promise<ReviewRecord[]> {
  const file = path.join(coursesRoot, courseId, 'review.json')
  if (!existsSync(file)) return []
  const raw: unknown = JSON.parse(await fs.readFile(file, 'utf-8'))
  return ReviewFileSchema.parse(raw).reviews
}

/** 组装校对总览：全量课件 + 校验结果 + 人审记录。 */
export async function getReviewOverview(coursesRoot: string, courseId: string): Promise<ReviewOverview> {
  const manifest = await getManifestV2(coursesRoot, courseId)
  const reviews = await readReviewFile(coursesRoot, courseId)
  const reviewByLesson = new Map(reviews.map((r) => [r.lessonId, r]))
  const materialId = manifest.sourceRef?.materialId ?? null

  let pathKpIds: Set<string> | null = null
  let digests: Record<string, { core: string; takeaway: string }> = {}
  try {
    pathKpIds = new Set((await getPath(coursesRoot, courseId)).kps.map((k) => k.id))
    const progress = await getProgress(coursesRoot, courseId)
    digests = Object.fromEntries(
      progress.kps.flatMap((k) => (k.digest != null ? [[k.kpId, k.digest] as const] : []))
    )
  } catch {
    // path 未初始化：全部 lesson 按「非 KP 课件」处理（digest 定稿区不显示）
  }

  const lessons: LessonReviewItem[] = []
  for (const chapter of manifest.chapters) {
    for (const ref of chapter.lessons) {
      const doc = await readLessonRaw(coursesRoot, courseId, ref.file)
      const item: LessonReviewItem = {
        lessonId: ref.lessonId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        title: ref.title,
        file: ref.file,
        blockCount: 0,
        bookBlocks: [],
        review: reviewByLesson.get(ref.lessonId) ?? null,
        errors: [],
        warns: [],
        doc,
        words: 0
      }
      if (doc == null) {
        item.errors.push({
          path: '(file)',
          message: existsSync(path.join(coursesRoot, courseId, path.posix.normalize(ref.file)))
            ? '课件不是合法 JSON'
            : '课件文件缺失（manifest 引用了不存在的文件）'
        })
      } else {
        const validation = validateLessonDocument(doc)
        item.errors = validation.errors
        const blocks = (doc as { blocks?: unknown[] }).blocks
        if (Array.isArray(blocks)) {
          item.blockCount = blocks.length
          for (const b of blocks) {
            if (b == null || typeof b !== 'object') continue
            const block = b as Record<string, unknown>
            const src = block.source as Record<string, unknown> | undefined
            if (block.origin !== 'book' || src == null || typeof src.pdfPage !== 'number') continue
            const ocrFile = typeof src.ocrFile === 'string' ? src.ocrFile : undefined
            const excerpt =
              typeof block.md === 'string' && block.type === 'quote' ? block.md.slice(0, 120) : undefined
            item.bookBlocks.push({
              blockId: String(block.id ?? ''),
              blockType: String(block.type ?? ''),
              pdfPage: src.pdfPage,
              bookPage: typeof src.bookPage === 'number' ? src.bookPage : null,
              ...(ocrFile != null ? { ocrFile } : {}),
              ...(excerpt != null && excerpt.length > 0 ? { excerpt } : {})
            })
          }
        }
        if (validation.ok && Array.isArray(blocks)) {
          const report = checkLessonCapacity(blocks as Parameters<typeof checkLessonCapacity>[0])
          item.warns = report.warns
          item.words = report.words
        }
      }
      lessons.push(item)
    }
  }
  // KP 标记：供校对页 digest 定稿区判断（lessonId 在学习路径上 = KP 课件）
  return {
    courseId,
    title: manifest.title,
    materialId,
    reviews,
    lessons,
    pathKpIds: pathKpIds != null ? [...pathKpIds] : [],
    digests
  }
}

/** 校对页单课重校验（保存/重生成后刷新）。 */
export async function validateLessonForReview(
  coursesRoot: string,
  courseId: string,
  lessonId: string
): Promise<{ errors: { path: string; message: string }[]; warns: CapacityWarning[]; words: number }> {
  const manifest = await getManifestV2(coursesRoot, courseId)
  let fileRel: string | null = null
  for (const chapter of manifest.chapters) {
    const ref = chapter.lessons.find((l) => l.lessonId === lessonId)
    if (ref != null) {
      fileRel = ref.file
      break
    }
  }
  if (fileRel == null) throw new CourseV2Error(`课件不在课程中: ${lessonId}`)
  const doc = await readLessonRaw(coursesRoot, courseId, fileRel)
  if (doc == null) {
    return { errors: [{ path: '(file)', message: '课件文件缺失或不是合法 JSON' }], warns: [], words: 0 }
  }
  const validation = validateLessonDocument(doc)
  const blocks = (doc as { blocks?: unknown[] }).blocks
  if (!validation.ok || !Array.isArray(blocks)) {
    return { errors: validation.errors, warns: [], words: 0 }
  }
  const report = checkLessonCapacity(blocks as Parameters<typeof checkLessonCapacity>[0])
  return { errors: validation.errors, warns: report.warns, words: report.words }
}

/* ===== 页码抽查：块 source → OCR 页原文 ===== */

export interface OcrPageResult {
  ocrFile: string
  md: string
  bookPage: number | null
  pdfPage: number | null
  /** 按书内页码扫描时的邻近页（±1，回查用） */
  neighbors: string[]
}

/** 扫 ocr 目录下各章 pNNN.md 页首头部建「书内页码 → 文件」索引（与 kpSource 同款自证规则）。 */
async function scanOcrPageHeaders(
  materialsRoot: string,
  materialId: string
): Promise<Map<string, { pdf: number; book: number; file: string; dir: string }>> {
  const base = path.join(materialsRoot, materialId)
  if (!existsSync(base)) throw new CourseV2Error(`教材资料不存在: ${materialId}`)
  const headers = new Map<string, { pdf: number; book: number; file: string; dir: string }>()
  if (!existsSync(path.join(base, 'ocr'))) return headers
  for (const chapterSlug of (await fs.readdir(path.join(base, 'ocr'), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)) {
    const ocrDir = path.join(base, 'ocr', chapterSlug)
    const files = (await fs.readdir(ocrDir)).filter((f) => /^p\d+\.md$/.test(f)).sort().slice(0, MAX_SCAN_FILES)
    for (const f of files) {
      const head = (await fs.readFile(path.join(ocrDir, f), 'utf-8')).slice(0, 400)
      const hm = /##\s*PDF\s*p\.(\d+)\s*\|\s*书内页码\s*(\d+)/.exec(head)
      if (hm == null) continue
      // 同书内页码多章重名时后到不改先到（抽查场景足够）
      headers.set(`${chapterSlug}/${f}`, {
        pdf: Number(hm[1]),
        book: Number(hm[2]),
        file: `ocr/${chapterSlug}/${f}`,
        dir: chapterSlug
      })
    }
  }
  return headers
}

/**
 * 取页码抽查的 OCR 原文：ocrFile 直读优先；缺省按书内页码扫描页首头部。
 * 未命中返回 null（校对页显示「未找到对应 OCR 页」）。
 */
export async function getOcrPageForCourse(
  coursesRoot: string,
  materialsRoot: string,
  courseId: string,
  ref: { ocrFile?: string; bookPage?: number | null }
): Promise<OcrPageResult | null> {
  const manifest = await getManifestV2(coursesRoot, courseId)
  const materialId = manifest.sourceRef?.materialId
  if (materialId == null || materialId.length === 0) {
    throw new CourseV2Error(`课程「${courseId}」未关联教材资料（sourceRef.materialId 缺失），页码抽查不可用`)
  }
  if (ref.ocrFile != null && ref.ocrFile.length > 0) {
    const page = await readMaterialPage(materialsRoot, materialId, ref.ocrFile)
    return { ocrFile: page.ocrFile, md: page.md, bookPage: ref.bookPage ?? null, pdfPage: null, neighbors: [] }
  }
  if (ref.bookPage == null) throw new CourseV2Error('页码抽查需要 ocrFile 或 bookPage 至少一个')
  const headers = await scanOcrPageHeaders(materialsRoot, materialId)
  const hit = [...headers.values()].find((h) => h.book === ref.bookPage)
  if (hit == null) return null
  const page = await readMaterialPage(materialsRoot, materialId, hit.file)
  const neighbors = [...headers.values()]
    .filter((h) => Math.abs(h.book - (ref.bookPage ?? 0)) === 1)
    .map((h) => h.file)
    .sort()
  return {
    ocrFile: page.ocrFile,
    md: page.md,
    bookPage: hit.book,
    pdfPage: hit.pdf,
    neighbors
  }
}
