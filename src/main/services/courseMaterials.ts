import { promises as fs } from 'fs'
import { existsSync, readdirSync, statSync } from 'fs'
import path from 'path'

/**
 * 教材资料导入（book-prep-ocr 技能产物）：
 *  - 资料原样复制到 userData/materials/<id>/（跳过 pages/ 大图，记录 sourcePath 供回查）
 *  - meta.json 宽松解析（字段名不统一，按语义识别；缺失项留给 Agent 技能 course-material-processor 处理）
 *  - 课程的构建由 Agent 按技能执行，本服务只负责存层与枚举
 */

export interface MaterialPageOffset {
  section?: string
  offset: number
}

export interface MaterialInfo {
  id: string
  dir: string
  sourcePath: string
  title?: string
  authors?: string
  edition?: string
  publisher?: string
  year?: string
  pageOffsets: MaterialPageOffset[]
  factsheets: string[]
  ocrPageCount: number
  qaLogExists: boolean
  metaRaw: unknown
}

export class MaterialError extends Error {}

const SKIP_DIRS = new Set(['pages'])

export async function importMaterialFolder(srcFolder: string, materialsRoot: string): Promise<MaterialInfo> {
  if (!existsSync(srcFolder) || !statSync(srcFolder).isDirectory()) {
    throw new MaterialError(`目录不存在: ${srcFolder}`)
  }
  const entries = readdirSync(srcFolder)
  const hasMeta = entries.includes('meta.json')
  const factsheetFiles = entries.filter((f) => /^factsheet-[\w\-]+\.md$/.test(f))
  if (!hasMeta && factsheetFiles.length === 0) {
    throw new MaterialError('所选目录缺少 meta.json 或 factsheet-*.md，不是 book-prep-ocr 产物')
  }

  const id = path.basename(srcFolder).replace(/[^\w\-.]+/g, '-').slice(0, 80) || 'material'
  const dest = path.join(materialsRoot, id)
  if (existsSync(dest)) {
    throw new MaterialError(`教材资料「${id}」已导入过`)
  }

  await fs.mkdir(dest, { recursive: true })
  try {
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      const src = path.join(srcFolder, entry)
      const d = path.join(dest, entry)
      if (statSync(src).isDirectory()) await copyDir(src, d)
      else await fs.copyFile(src, d)
    }
  } catch (err) {
    await fs.rm(dest, { recursive: true, force: true })
    throw err
  }

  const meta = hasMeta ? readJsonSafe(path.join(dest, 'meta.json')) : undefined
  const ocrPageCount = countOcrPages(dest)

  const info: MaterialInfo = {
    id,
    dir: dest,
    sourcePath: srcFolder,
    title: pickStr(meta, ['title', 'bookTitle', 'book_name', '书名']),
    authors: pickStr(meta, ['authors', 'author', '作者']),
    edition: pickStr(meta, ['edition', '版次']),
    publisher: pickStr(meta, ['publisher', '出版社']),
    year: pickStr(meta, ['year', '年份']),
    pageOffsets: parseOffsets(meta),
    factsheets: (existsSync(dest) ? readdirSync(dest) : []).filter((f) =>
      /^factsheet-[\w\-]+\.md$/.test(f)
    ),
    ocrPageCount,
    qaLogExists: existsSync(path.join(dest, 'qa-log.md')),
    metaRaw: meta
  }
  if (info.title == null && factsheetFiles.length > 0) {
    info.title = `教材资料 ${id}`
  }
  return info
}

export async function listMaterials(materialsRoot: string): Promise<MaterialInfo[]> {
  if (!existsSync(materialsRoot)) return []
  const list: MaterialInfo[] = []
  for (const name of await fs.readdir(materialsRoot)) {
    const dir = path.join(materialsRoot, name)
    if (!statSync(dir).isDirectory()) continue
    if (!existsSync(path.join(dir, 'meta.json'))) continue
    const meta = readJsonSafe(path.join(dir, 'meta.json'))
    const factsheets = readdirSync(dir).filter((f) => /^factsheet-[\w\-]+\.md$/.test(f))
    list.push({
      id: name,
      dir,
      sourcePath: pickStr(meta, ['sourcePath']) ?? '',
      title: pickStr(meta, ['title', 'bookTitle', 'book_name', '书名']) ?? `教材资料 ${name}`,
      authors: pickStr(meta, ['authors', 'author', '作者']),
      edition: pickStr(meta, ['edition', '版次']),
      publisher: pickStr(meta, ['publisher', '出版社']),
      year: pickStr(meta, ['year', '年份']),
      pageOffsets: parseOffsets(meta),
      factsheets,
      ocrPageCount: countOcrPages(dir),
      qaLogExists: existsSync(path.join(dir, 'qa-log.md')),
      metaRaw: meta
    })
  }
  return list
}

/** 读取教材资料内的文本文件（factsheet / meta.json / qa-log / ocr 逐页 md），供校对 UI 与 Agent 使用。 */
export async function readMaterialFile(materialsRoot: string, id: string, relPath: string): Promise<string> {
  assertSafeId(id)
  const safe = sanitizeRelPath(relPath)
  const file = path.join(materialsRoot, id, ...safe.split('/'))
  if (!existsSync(file)) throw new MaterialError(`文件不存在: ${relPath}`)
  return fs.readFile(file, 'utf-8')
}

export async function removeMaterial(materialsRoot: string, id: string): Promise<void> {
  assertSafeId(id)
  const dir = path.join(materialsRoot, id)
  if (!existsSync(dir)) throw new MaterialError(`教材资料不存在: ${id}`)
  await fs.rm(dir, { recursive: true, force: true })
}

function countOcrPages(dest: string): number {
  const ocrDir = path.join(dest, 'ocr')
  if (!existsSync(ocrDir)) return 0
  let count = 0
  for (const ch of readdirSync(ocrDir)) {
    const chDir = path.join(ocrDir, ch)
    if (!statSync(chDir).isDirectory()) continue
    count += readdirSync(chDir).filter((f) => f.endsWith('.md')).length
  }
  return count
}

function readJsonSafe(file: string): unknown {
  try {
    return JSON.parse(require('fs').readFileSync(file, 'utf-8')) as unknown
  } catch {
    return undefined
  }
}

function pickStr(obj: unknown, keys: string[]): string | undefined {
  if (obj == null || typeof obj !== 'object') return undefined
  const rec = obj as Record<string, unknown>
  for (const key of keys) {
    const v = rec[key]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

function parseOffsets(meta: unknown): MaterialPageOffset[] {
  if (meta == null || typeof meta !== 'object') return []
  const rec = meta as Record<string, unknown>
  const single = rec['pageOffset'] ?? rec['page_offset']
  if (typeof single === 'number') return [{ offset: single }]
  const table =
    rec['pageOffsets'] ?? rec['page_offsets'] ?? rec['page_offset_table'] ?? rec['offsets']
  if (!Array.isArray(table)) return []
  const out: MaterialPageOffset[] = []
  for (const item of table) {
    if (typeof item === 'number') out.push({ offset: item })
    else if (item != null && typeof item === 'object') {
      const r = item as Record<string, unknown>
      const offset = r['offset']
      if (typeof offset === 'number') {
        out.push({ section: typeof r['section'] === 'string' ? r['section'] : undefined, offset })
      }
    }
  }
  return out
}

function assertSafeId(id: string): void {
  if (id.length === 0 || id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
    throw new MaterialError(`非法资料 id: ${id}`)
  }
}

function sanitizeRelPath(relPath: string): string {
  const normalized = path.posix.normalize(relPath.replaceAll('\\', '/'))
  if (normalized.startsWith('..') || normalized.includes('../') || path.posix.isAbsolute(normalized)) {
    throw new MaterialError(`非法资料文件路径: ${relPath}`)
  }
  return normalized
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  for (const name of await fs.readdir(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if ((await fs.stat(s)).isDirectory()) await copyDir(s, d)
    else await fs.copyFile(s, d)
  }
}
