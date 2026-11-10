import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import { getManifestV2, CourseV2Error } from './coursePackageV2'
import { getPath } from './learningPath'

/**
 * P5.2.5 KP 结构化取料（插件 cad_get_kp_source / cad_get_page / cad_list_material_files 的实现）：
 *  - 把技能最容易出错的「找 factsheet 节 + 算页偏移 + 读 ocr 页」合成一步
 *  - pdfPage 不靠换算：直接扫描 ocr 页首 `## PDF p.N | 书内页码 M` 头部自证，找不到再回退 meta.json 偏移
 *  - 纯 Node 实现（无 electron 依赖），插件构建时同源打包
 */

export interface KpSourceResult {
  kpId: string
  title: string
  chapterId: string
  bookPage: number | null
  pdfPage: number | null
  materialId: string
  factsheetFile: string
  /** factsheet 中该 KP 的「知识点详情」节文本 */
  factsheetSection: string
  /** 命中的 ocr 页（含转写文本，截断到 32KB） */
  ocrFile: string | null
  pageMd: string | null
  /** 相邻页（书内页码±1）的 ocr 文件名，供回查 */
  neighborOcrFiles: string[]
}

const MAX_SECTION_CHARS = 32_000
const MAX_PAGE_CHARS = 64_000
const MAX_SCAN_FILES = 400

function sanitizeRel(sub: string, label: string): string {
  const norm = path.posix.normalize(sub.replaceAll('\\', '/'))
  if (
    norm.length === 0 ||
    norm === '.' ||
    norm.startsWith('..') ||
    norm.includes('../') ||
    path.posix.isAbsolute(norm) ||
    /^[a-zA-Z]:/.test(norm)
  ) {
    throw new CourseV2Error(`非法${label}路径: ${sub}`)
  }
  return norm
}

function normalizeTitle(s: string): string {
  return s.replaceAll(/\s|　/g, '').replaceAll(/[·•]/g, '')
}

/** 按 KP 取结构化料：factsheet 详情节 + 页码自证的 ocr 原文。 */
export async function getKpSource(
  coursesRoot: string,
  materialsRoot: string,
  courseId: string,
  kpId: string
): Promise<KpSourceResult> {
  const manifest = await getManifestV2(coursesRoot, courseId)
  const materialId = manifest.sourceRef?.materialId
  if (materialId == null || materialId.length === 0) {
    throw new CourseV2Error(`课程「${courseId}」未关联教材资料（sourceRef.materialId 缺失）`)
  }
  const materialDir = path.join(materialsRoot, materialId)
  if (!existsSync(materialDir)) {
    throw new CourseV2Error(`教材资料不存在: ${materialId}（materialsRoot=${materialsRoot}）`)
  }
  const pathFile = await getPath(coursesRoot, courseId)
  const entry = pathFile.kps.find((k) => k.id === kpId)
  if (entry == null) throw new CourseV2Error(`知识点不在学习路径中: ${kpId}`)

  // 1) 收集 factsheet 候选（sourceRef 列出的优先；缺失则扫目录）
  let factsheetFiles = manifest.sourceRef?.factsheets.filter((f) => f.endsWith('.md')) ?? []
  if (factsheetFiles.length === 0) {
    factsheetFiles = (await fs.readdir(materialDir)).filter((f) => /^factsheet-ch\d+\.md$/.test(f))
  }
  if (factsheetFiles.length === 0) {
    throw new CourseV2Error(`教材资料「${materialId}」下没有 factsheet-chNN.md`)
  }

  // 2) 在 factsheet 里定位该 KP 的详情节：先按书内页码匹配标题，再按标题包含关系
  let factsheetFile = ''
  let section = ''
  let headingPage: number | null = null
  const titleNorm = normalizeTitle(entry.title)
  for (const f of factsheetFiles) {
    const text = await fs.readFile(path.join(materialDir, f), 'utf-8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = /^###\s+K\d+\s*[·•]\s*(.+?)\s*[·•]\s*书内\s*p\.(\d+)/.exec(lines[i])
      if (m == null) continue
      const headTitle = normalizeTitle(m[1])
      const headPage = Number(m[2])
      const pageHit = entry.bookPage != null && headPage === entry.bookPage
      const titleHit =
        headTitle.length >= 2 && titleNorm.length >= 2 && (headTitle.includes(titleNorm) || titleNorm.includes(headTitle))
      if (!pageHit && !titleHit) continue
      // 节文本 = 该标题行到下一个 ###/## 之前
      const out: string[] = [lines[i]]
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{2,3}\s/.test(lines[j])) break
        out.push(lines[j])
      }
      factsheetFile = f
      section = out.join('\n').slice(0, MAX_SECTION_CHARS)
      headingPage = headPage
      break
    }
    if (factsheetFile !== '') break
  }
  if (factsheetFile === '') {
    throw new CourseV2Error(
      `在 ${factsheetFiles.join(', ')} 中找不到知识点「${entry.title}」（bookPage=${entry.bookPage ?? '无'}）的详情节；请核对 factsheet 的「知识点详情」标题格式：### K# · 标题 · 书内 p.X`
    )
  }

  // 3) ocr 页定位：factsheet 文件名 → ocr/chNN/；扫页首头部找「书内页码 == bookPage」
  const chapterSlug = /factsheet-(ch\d+)\.md$/.exec(factsheetFile)?.[1] ?? ''
  const ocrDir = path.join(materialDir, 'ocr', chapterSlug)
  const targetPage = entry.bookPage ?? headingPage
  let ocrFile: string | null = null
  let pageMd: string | null = null
  let pdfPage: number | null = null
  const neighbors: string[] = []
  if (chapterSlug !== '' && existsSync(ocrDir)) {
    const files = (await fs.readdir(ocrDir)).filter((f) => /^p\d+\.md$/.test(f)).sort().slice(0, MAX_SCAN_FILES)
    const headers = new Map<string, { pdf: number; book: number }>()
    for (const f of files) {
      const head = (await fs.readFile(path.join(ocrDir, f), 'utf-8')).slice(0, 400)
      const hm = /##\s*PDF\s*p\.(\d+)\s*\|\s*书内页码\s*(\d+)/.exec(head)
      if (hm != null) headers.set(f, { pdf: Number(hm[1]), book: Number(hm[2]) })
    }
    if (targetPage != null) {
      for (const [f, h] of headers) {
        if (h.book !== targetPage) continue
        ocrFile = `ocr/${chapterSlug}/${f}`
        pdfPage = h.pdf
        pageMd = (await fs.readFile(path.join(ocrDir, f), 'utf-8')).slice(0, MAX_PAGE_CHARS)
        break
      }
    }
    if (pageMd == null && headers.size > 0) {
      // 没命中目标页：返回最近的一页作为锚点（按书内页码距离）
      const sorted = [...headers.entries()].sort(
        (a, b) => Math.abs(a[1].book - (targetPage ?? 0)) - Math.abs(b[1].book - (targetPage ?? 0))
      )
      const [f, h] = sorted[0]
      ocrFile = `ocr/${chapterSlug}/${f}`
      pdfPage = h.pdf
      pageMd = (await fs.readFile(path.join(ocrDir, f), 'utf-8')).slice(0, MAX_PAGE_CHARS)
    }
    if (targetPage != null) {
      for (const [f, h] of headers) {
        if (Math.abs(h.book - targetPage) === 1) neighbors.push(`ocr/${chapterSlug}/${f}`)
      }
    }
  }

  return {
    kpId: entry.id,
    title: entry.title,
    chapterId: entry.chapterId,
    bookPage: entry.bookPage ?? null,
    pdfPage,
    materialId,
    factsheetFile,
    factsheetSection: section,
    ocrFile,
    pageMd,
    neighborOcrFiles: neighbors
  }
}

/** 读单页 ocr 转写（路径白名单：必须 ocr/ 下 .md）。 */
export async function readMaterialPage(
  materialsRoot: string,
  materialId: string,
  ocrFile: string
): Promise<{ ocrFile: string; md: string }> {
  const rel = sanitizeRel(ocrFile, 'ocr')
  if (!rel.startsWith('ocr/') || !rel.endsWith('.md')) {
    throw new CourseV2Error(`只允许读取 ocr/ 下的 .md 页文件: ${ocrFile}`)
  }
  const abs = path.join(materialsRoot, materialId, rel)
  if (!existsSync(abs)) throw new CourseV2Error(`ocr 页不存在: ${ocrFile}`)
  return { ocrFile: rel, md: (await fs.readFile(abs, 'utf-8')).slice(0, MAX_PAGE_CHARS) }
}

/** 列教材资料目录（一层，含类型与大小；subPath 必须留在资料目录内）。 */
export async function listMaterialFiles(
  materialsRoot: string,
  materialId: string,
  subPath?: string
): Promise<{ entries: { name: string; type: 'file' | 'dir'; size: number }[] }> {
  const base = path.join(materialsRoot, materialId)
  if (!existsSync(base)) throw new CourseV2Error(`教材资料不存在: ${materialId}`)
  const dir = subPath != null && subPath.length > 0 ? path.join(base, sanitizeRel(subPath, '资料子目录')) : base
  if (!existsSync(dir)) throw new CourseV2Error(`资料子目录不存在: ${subPath}`)
  const entries: { name: string; type: 'file' | 'dir'; size: number }[] = []
  for (const name of await fs.readdir(dir)) {
    const stat = await fs.stat(path.join(dir, name))
    entries.push({ name, type: stat.isDirectory() ? 'dir' : 'file', size: stat.size })
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return { entries }
}
