import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import JSZip from 'jszip'
import {
  CoursePackage,
  COURSE_PACKAGE_SCHEMA_VERSION
} from '../../shared/course-schema'
import type {
  CoursePackage as CoursePackageData,
  CourseIndexEntry,
  ImportResult
} from '../../shared/course-schema'

/**
 * 课程包 zip 服务（P4）：
 *  - 导入：校验大小 → 解析 course-package.json（zod）→ zip-slip 防护 → 落盘 courses/<courseId>/ → 更新索引
 *  - 导出：读目录 → zod 校验 → 打 zip
 * 索引 index.json 为 P4 临时实现（SQLite 接线后迁移为表）。
 */

export const MAX_ZIP_BYTES = 512 * 1024 * 1024 // 整包上限 512MB
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024 // 单条目解压后上限 16MB
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024 // course-package.json 上限 8MB

const INDEX_FILE = 'index.json'
const MANIFEST_FILE = 'course-package.json'

interface CourseIndex {
  courses: CourseIndexEntry[]
}

export class CoursePackageError extends Error {}

/** zip 条目路径安全检查：拒绝绝对路径、路径穿越与反斜杠。返回规范化后的正斜杠路径。 */
export function sanitizeZipEntry(entryName: string): string {
  if (entryName.includes('\\')) {
    throw new CoursePackageError(`zip 条目含反斜杠（拒绝）: ${entryName}`)
  }
  if (entryName.startsWith('/') || /^[a-zA-Z]:/.test(entryName)) {
    throw new CoursePackageError(`zip 条目为绝对路径（拒绝）: ${entryName}`)
  }
  const normalized = path.posix.normalize(entryName)
  if (normalized.startsWith('..') || normalized.includes('/../') || normalized === '..') {
    throw new CoursePackageError(`zip 条目存在路径穿越（拒绝）: ${entryName}`)
  }
  return normalized
}

function countExercises(pkg: CoursePackageData): number {
  return pkg.chapters.reduce((n, ch) => n + ch.exercises.length, 0)
}

async function readIndex(coursesRoot: string): Promise<CourseIndex> {
  const indexFile = path.join(coursesRoot, INDEX_FILE)
  if (!existsSync(indexFile)) return { courses: [] }
  const raw = await fs.readFile(indexFile, 'utf-8')
  const parsed = JSON.parse(raw) as CourseIndex
  return { courses: Array.isArray(parsed.courses) ? parsed.courses : [] }
}

async function writeIndex(coursesRoot: string, index: CourseIndex): Promise<void> {
  await fs.mkdir(coursesRoot, { recursive: true })
  const indexFile = path.join(coursesRoot, INDEX_FILE)
  const tmp = indexFile + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf-8')
  await fs.rename(tmp, indexFile)
}

async function upsertIndexEntry(coursesRoot: string, entry: CourseIndexEntry): Promise<void> {
  const index = await readIndex(coursesRoot)
  const others = index.courses.filter((c) => c.id !== entry.id)
  await writeIndex(coursesRoot, { courses: [...others, entry] })
}

async function removeFromIndex(coursesRoot: string, courseId: string): Promise<void> {
  const index = await readIndex(coursesRoot)
  await writeIndex(coursesRoot, { courses: index.courses.filter((c) => c.id !== courseId) })
}

/** v2 课程包服务复用同一份索引（P5.2）。 */
export async function upsertCourseIndexEntry(coursesRoot: string, entry: CourseIndexEntry): Promise<void> {
  await upsertIndexEntry(coursesRoot, entry)
}

/** 从内存中的 zip Buffer 导入课程包（导入与测试共用）。 */
export async function importCourseZipBuffer(
  coursesRoot: string,
  zipBuffer: Buffer
): Promise<ImportResult> {
  if (zipBuffer.byteLength > MAX_ZIP_BYTES) {
    throw new CoursePackageError(`课程包超过大小上限（${MAX_ZIP_BYTES / 1024 / 1024}MB）`)
  }

  const zip = await JSZip.loadAsync(zipBuffer)
  const manifestEntry = zip.file(MANIFEST_FILE)
  if (manifestEntry == null) {
    throw new CoursePackageError(`课程包缺少 ${MANIFEST_FILE}`)
  }

  const manifestBuffer = await manifestEntry.async('nodebuffer')
  if (manifestBuffer.byteLength > MAX_MANIFEST_BYTES) {
    throw new CoursePackageError(`${MANIFEST_FILE} 超过大小上限（${MAX_MANIFEST_BYTES / 1024 / 1024}MB）`)
  }

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(manifestBuffer.toString('utf-8'))
  } catch {
    throw new CoursePackageError(`${MANIFEST_FILE} 不是合法 JSON`)
  }

  const parsed = CoursePackage.safeParse(rawManifest)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new CoursePackageError(`课程包 schema 校验失败: ${firstIssue}`)
  }
  const pkg = parsed.data

  // 校验通过后，先安全地展开 assets/（zip-slip 防护 + 单条目大小限制）
  const courseDir = path.join(coursesRoot, pkg.course.id)
  if (existsSync(courseDir)) {
    throw new CoursePackageError(`课程已存在，拒绝覆盖: ${pkg.course.id}`)
  }
  await fs.mkdir(courseDir, { recursive: true })

  try {
    const assetEntries = Object.keys(zip.files).filter(
      (name) => name !== MANIFEST_FILE && !zip.files[name].dir
    )
    for (const entryName of assetEntries) {
      const safeName = sanitizeZipEntry(entryName)
      if (!safeName.startsWith('assets/')) {
        throw new CoursePackageError(`课程包只允许 ${MANIFEST_FILE} 与 assets/ 下的文件，拒绝: ${entryName}`)
      }
      const entry = zip.files[entryName]
      // JSZipObject 类型未暴露 _data（内部解压后大小），此处做类型收窄
      const size =
        (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
      if (size > MAX_ENTRY_BYTES) {
        throw new CoursePackageError(`条目超过单文件上限（${MAX_ENTRY_BYTES / 1024 / 1024}MB）: ${entryName}`)
      }
      const data = await entry.async('nodebuffer')
      const dest = path.join(courseDir, ...safeName.split('/'))
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, data)
    }

    await fs.writeFile(
      path.join(courseDir, MANIFEST_FILE),
      JSON.stringify(pkg, null, 2),
      'utf-8'
    )
  } catch (err) {
    // 失败回滚：删除半成品目录
    await fs.rm(courseDir, { recursive: true, force: true })
    throw err
  }

  const result: ImportResult = {
    courseId: pkg.course.id,
    title: pkg.course.title,
    chapterCount: pkg.chapters.length,
    exerciseCount: countExercises(pkg),
    workspaceGroupCount: pkg.workspaceGroups.length
  }

  await upsertIndexEntry(coursesRoot, {
    id: pkg.course.id,
    title: pkg.course.title,
    language: pkg.course.language,
    chapterCount: result.chapterCount,
    exerciseCount: result.exerciseCount,
    importedAt: new Date().toISOString()
  })

  return result
}

/** 从 zip 文件导入。 */
export async function importCourseZip(coursesRoot: string, zipPath: string): Promise<ImportResult> {
  const stat = await fs.stat(zipPath)
  if (stat.size > MAX_ZIP_BYTES) {
    throw new CoursePackageError(`课程包超过大小上限（${MAX_ZIP_BYTES / 1024 / 1024}MB）`)
  }
  const buffer = await fs.readFile(zipPath)
  return importCourseZipBuffer(coursesRoot, buffer)
}

/** 读取课程目录（course-package.json + assets/）并打包为 zip Buffer。 */
export async function exportCourseToZipBuffer(
  coursesRoot: string,
  courseId: string
): Promise<Buffer> {
  const courseDir = path.join(coursesRoot, courseId)
  const manifestFile = path.join(courseDir, MANIFEST_FILE)
  if (!existsSync(manifestFile)) {
    throw new CoursePackageError(`课程不存在: ${courseId}`)
  }
  const raw = JSON.parse(await fs.readFile(manifestFile, 'utf-8')) as unknown
  // 导出前再次校验，杜绝把坏数据发出去
  const parsed = CoursePackage.safeParse(raw)
  if (!parsed.success) {
    throw new CoursePackageError(`课程数据校验失败（导出中止）: ${parsed.error.issues[0]?.message}`)
  }

  const zip = new JSZip()
  zip.file(MANIFEST_FILE, JSON.stringify(parsed.data, null, 2))
  await addDirToZip(zip, courseDir, 'assets')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

async function addDirToZip(zip: JSZip, fsDir: string, zipPath: string): Promise<void> {
  if (!existsSync(fsDir)) return
  for (const name of await fs.readdir(fsDir)) {
    const abs = path.join(fsDir, name)
    const stat = await fs.stat(abs)
    const entryPath = `${zipPath}/${name}`
    if (stat.isDirectory()) {
      await addDirToZip(zip, abs, entryPath)
    } else {
      if (stat.size > MAX_ENTRY_BYTES) {
        throw new CoursePackageError(`资源超过单文件上限（${MAX_ENTRY_BYTES / 1024 / 1024}MB）: ${entryPath}`)
      }
      zip.file(entryPath, await fs.readFile(abs))
    }
  }
}

/** 导出课程为 zip 文件。 */
export async function exportCourseToZip(
  coursesRoot: string,
  courseId: string,
  outZipPath: string
): Promise<void> {
  const buffer = await exportCourseToZipBuffer(coursesRoot, courseId)
  await fs.mkdir(path.dirname(outZipPath), { recursive: true })
  await fs.writeFile(outZipPath, buffer)
}

export async function listCourses(coursesRoot: string): Promise<CourseIndexEntry[]> {
  const index = await readIndex(coursesRoot)
  return index.courses
}

export async function getCourse(coursesRoot: string, courseId: string): Promise<CoursePackageData> {
  const manifestFile = path.join(coursesRoot, courseId, MANIFEST_FILE)
  if (!existsSync(manifestFile)) {
    throw new CoursePackageError(`课程不存在: ${courseId}`)
  }
  const raw = JSON.parse(await fs.readFile(manifestFile, 'utf-8')) as unknown
  const parsed = CoursePackage.safeParse(raw)
  if (!parsed.success) {
    throw new CoursePackageError(`课程数据校验失败: ${parsed.error.issues[0]?.message}`)
  }
  return parsed.data
}

export async function removeCourse(coursesRoot: string, courseId: string): Promise<void> {
  const courseDir = path.join(coursesRoot, courseId)
  if (!existsSync(courseDir)) {
    throw new CoursePackageError(`课程不存在: ${courseId}`)
  }
  if (courseId === '.' || courseId === '..' || courseId.includes('/') || courseId.includes('\\')) {
    throw new CoursePackageError(`非法课程 id: ${courseId}`)
  }
  await fs.rm(courseDir, { recursive: true, force: true })
  await removeFromIndex(coursesRoot, courseId)
}

/** 从已导入课程的目录构建课程包（P5 book-ocr 导入将直接产出 CoursePackageData 再落盘）。 */
export function newEmptyCoursePackage(): CoursePackageData {
  return {
    schemaVersion: COURSE_PACKAGE_SCHEMA_VERSION,
    course: {
      id: 'untitled-course',
      title: '未命名课程',
      language: 'mixed'
    },
    chapters: [],
    workspaceGroups: []
  }
}
