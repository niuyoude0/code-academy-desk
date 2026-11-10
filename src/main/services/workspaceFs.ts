import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import * as git from 'isomorphic-git'

/**
 * P7 文件工作区服务：
 *  - 每课程一个持久沙盒目录 `<workspaceRoot>/files/<courseId>/`（与 runner 的 runs/ 互不干扰）
 *  - 读/写全部经路径限定（禁绝对路径/穿越/越出课程根），文本 ≤512KB
 *  - 每次写入做 isomorphic-git 快照（init 一次 + add + commit；失败不阻塞写入，返回 null）
 */

export class WorkspaceError extends Error {}

const MAX_TEXT = 512 * 1024
const MAX_NODES = 800
const MAX_DEPTH = 8

export interface WorkspaceNode {
  name: string
  /** 相对课程根的正斜杠路径（目录不带尾斜杠） */
  path: string
  type: 'file' | 'dir'
  size?: number
}

function assertCourseId(courseId: string): void {
  if (
    courseId.length === 0 ||
    courseId === '.' ||
    courseId === '..' ||
    courseId.includes('/') ||
    courseId.includes('\\')
  ) {
    throw new WorkspaceError(`非法课程 id: ${courseId}`)
  }
}

function courseDir(workspaceRoot: string, courseId: string): string {
  assertCourseId(courseId)
  return path.join(workspaceRoot, 'files', courseId)
}

/** relPath 安全校验：非绝对、无 ..、限定在课程根内；返回绝对路径。 */
function safeJoin(root: string, relPath: string): string {
  if (relPath.length === 0 || relPath.includes('\\') || relPath.startsWith('/')) {
    throw new WorkspaceError(`非法路径: ${relPath}`)
  }
  if (relPath.split('/').some((seg) => seg === '..' || seg === '.' || seg.length === 0)) {
    throw new WorkspaceError(`非法路径（穿越/空段）: ${relPath}`)
  }
  const abs = path.resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new WorkspaceError(`路径越出工作区: ${relPath}`)
  }
  return abs
}

async function walk(root: string, rel: string, depth: number, out: WorkspaceNode[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_NODES) return
  const abs = path.join(root, rel)
  const entries = await fs.readdir(abs, { withFileTypes: true })
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
  for (const e of entries) {
    if (out.length >= MAX_NODES) return
    if (e.name === '.git' || e.name.startsWith('.')) continue
    const childRel = rel === '' ? e.name : `${rel}/${e.name}`
    if (e.isDirectory()) {
      out.push({ name: e.name, path: childRel, type: 'dir' })
      await walk(root, childRel, depth + 1, out)
    } else if (e.isFile()) {
      const st = await fs.stat(path.join(root, childRel))
      out.push({ name: e.name, path: childRel, type: 'file', size: st.size })
    }
  }
}

/** 课程工作区文件树（扁平列表；.git 与点文件跳过；上限 800 节点）。 */
export async function listWorkspaceTree(workspaceRoot: string, courseId: string): Promise<WorkspaceNode[]> {
  const root = courseDir(workspaceRoot, courseId)
  if (!existsSync(root)) return []
  const out: WorkspaceNode[] = []
  await walk(root, '', 0, out)
  return out
}

/** 读文本文件（≤512KB；UTF-8）。 */
export async function readWorkspaceFile(
  workspaceRoot: string,
  courseId: string,
  relPath: string
): Promise<{ content: string }> {
  const root = courseDir(workspaceRoot, courseId)
  const abs = safeJoin(root, relPath)
  if (!existsSync(abs)) throw new WorkspaceError(`文件不存在: ${relPath}`)
  const st = await fs.stat(abs)
  if (!st.isFile()) throw new WorkspaceError(`不是文件: ${relPath}`)
  if (st.size > MAX_TEXT) throw new WorkspaceError(`文件超过 512KB，暂不支持在工作区打开: ${relPath}`)
  return { content: await fs.readFile(abs, 'utf-8') }
}

/** git 快照（best-effort）：init（幂等）+ add + commit；失败返回 null 不阻塞写入。 */
async function snapshot(root: string, relPath: string): Promise<string | null> {
  try {
    if (!existsSync(path.join(root, '.git'))) {
      await git.init({ fs, dir: root, defaultBranch: 'main' })
    }
    await git.add({ fs, dir: root, filepath: relPath })
    const oid = await git.commit({
      fs,
      dir: root,
      message: `snapshot: ${relPath}`,
      author: { name: 'Code Academy Desk', email: 'cad@local' }
    })
    return oid
  } catch (err) {
    console.warn('[workspace] git 快照失败（写入已保留）:', err instanceof Error ? err.message : err)
    return null
  }
}

/** 写文本文件（≤512KB）+ git 快照。 */
export async function writeWorkspaceFile(
  workspaceRoot: string,
  courseId: string,
  relPath: string,
  content: string
): Promise<{ commit: string | null }> {
  const root = courseDir(workspaceRoot, courseId)
  const abs = safeJoin(root, relPath)
  if (Buffer.byteLength(content, 'utf-8') > MAX_TEXT) {
    throw new WorkspaceError(`内容超过 512KB 上限: ${relPath}`)
  }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf-8')
  return { commit: await snapshot(root, relPath) }
}
