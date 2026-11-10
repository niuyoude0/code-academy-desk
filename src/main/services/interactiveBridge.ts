import { promises as fs } from 'fs'
import path from 'path'
import { getProgress } from './learningPath'
import { getManifestV2 } from './coursePackageV2'
import { getCourseAssetDataUrl } from './coursePackageV2'

/**
 * P5.6 interactive 桥服务（D2 裁决：独立受限 Renderer + 白名单桥）。
 *  - 沙箱侧（AI 生成代码）不可信：路径限定/只读/尺寸上限全部在主进程强制
 *  - fs 桥 = 课程数据只读桥：仅允许课程包内 manifest/path/progress/chapters/exercises 文本文件
 *  - system.getInfo / agent.askTutor 不在本服务（前者要 electron app、后者是渲染层本地动作），
 *    IPC 层分发时处理，见 interactiveIpc.ts
 */

export class InteractiveBridgeError extends Error {}

const TEXT_MAX_BYTES = 2 * 1024 * 1024

/** 课程包内允许桥读的文本路径（posix 相对；铁律与 getCourseAssetDataUrl 同风格）。 */
function assertCourseRelText(relPath: string): string[] {
  const norm = relPath.replaceAll('\\', '/')
  if (path.isAbsolute(norm) || norm.includes('..')) {
    throw new InteractiveBridgeError(`非法路径: ${relPath}`)
  }
  const parts = norm.split('/').filter((p) => p.length > 0 && p !== '.')
  const top = parts[0]
  const topAllowed = ['manifest.json', 'path.json', 'progress.json', 'chapters', 'exercises']
  if (parts.length === 0 || !topAllowed.includes(top ?? '')) {
    throw new InteractiveBridgeError(
      `fs 桥仅允许读取课程包内 ${topAllowed.join(' / ')}（收到: ${relPath}；图片用 readCourseAsset）`
    )
  }
  if ((top === 'chapters' || top === 'exercises') && parts.length < 2) {
    throw new InteractiveBridgeError(`非法路径: ${relPath}`)
  }
  return parts
}

/** fs.readCourseFile：课程包内文本文件（≤2MB）。 */
export async function readCourseFileText(coursesRoot: string, courseId: string, relPath: string): Promise<string> {
  const parts = assertCourseRelText(relPath)
  const file = path.join(coursesRoot, courseId, ...parts)
  const st = await fs.stat(file).catch(() => null)
  if (st == null || !st.isFile()) throw new InteractiveBridgeError(`课程文件不存在: ${relPath}`)
  if (st.size > TEXT_MAX_BYTES) throw new InteractiveBridgeError(`文件超过 2MB 上限: ${relPath}`)
  return fs.readFile(file, 'utf-8')
}

/** fs.readCourseAsset：assets/ 内图片 → data URL（复用 image 块的同一铁律实现，错误统一为本域类型）。 */
export async function readCourseAssetDataUrl(
  coursesRoot: string,
  courseId: string,
  relPath: string
): Promise<string> {
  try {
    return await getCourseAssetDataUrl(coursesRoot, courseId, relPath)
  } catch (err) {
    throw new InteractiveBridgeError(err instanceof Error ? err.message : String(err))
  }
}

/** fs.getProgress：当前课程学习进度（只读）。 */
export async function getCourseProgress(coursesRoot: string, courseId: string): Promise<unknown> {
  return getProgress(coursesRoot, courseId)
}

/** fs.getManifest：当前课程清单（章节树/标题/语言；只读）。 */
export async function getCourseManifest(coursesRoot: string, courseId: string): Promise<unknown> {
  return getManifestV2(coursesRoot, courseId)
}
