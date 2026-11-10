import { ipcMain } from 'electron'
import { IpcChannel, type CoursePathView, type KpCompleteInput } from '../shared/ipc'
import { getManifestV2, getLessonV2, getCourseAssetDataUrl } from './services/coursePackageV2'
import { getPath, getProgress, startKp, skipKp, completeKp } from './services/learningPath'

/**
 * P5.4 学习路径域 IPC：渲染层学习路径页的数据与动作。
 *  - 写操作只到 startKp/skipKp/completeKp（判定解锁规则在服务层）
 *  - 生成课件的触发走 Agent 对话（渲染层拼固定提示词经 agent:chat 发送），不经本域
 *  - course:asset:read 服务 image 块（P5.5），路径铁律在服务层
 */
export function registerPathIpc(coursesRoot: string): void {
  const wrap = async <T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  ipcMain.handle(IpcChannel.PathGet, (_e, payload: { courseId: string }) =>
    wrap(async (): Promise<CoursePathView> => {
      const { courseId } = payload
      let title = courseId
      try {
        const manifest = await getManifestV2(coursesRoot, courseId)
        title = manifest.title
      } catch {
        throw new Error(`课程不存在: ${courseId}`)
      }
      let path: CoursePathView['path'] = null
      try {
        path = await getPath(coursesRoot, courseId)
      } catch {
        path = null // path.json 未初始化（Agent 建课骨架后才有）
      }
      const progress = await getProgress(coursesRoot, courseId) // 缺失时自动初始化空进度
      return { courseId, title, path, progress }
    })
  )

  ipcMain.handle(IpcChannel.KpStart, (_e, payload: { courseId: string; kpId: string }) =>
    wrap(() => startKp(coursesRoot, payload.courseId, payload.kpId))
  )

  ipcMain.handle(IpcChannel.KpSkip, (_e, payload: { courseId: string; kpId: string }) =>
    wrap(() => skipKp(coursesRoot, payload.courseId, payload.kpId))
  )

  ipcMain.handle(IpcChannel.KpComplete, (_e, payload: KpCompleteInput) =>
    wrap(() =>
      completeKp(coursesRoot, payload.courseId, payload.kpId, {
        ...(payload.quizBest != null ? { quizBest: payload.quizBest } : {}),
        ...(payload.codingPassed != null ? { codingPassed: payload.codingPassed } : {}),
        ...(payload.forced === true ? { forced: true } : {}),
        ...(payload.digest != null ? { digest: payload.digest } : {})
      })
    )
  )

  ipcMain.handle(IpcChannel.LessonGet, (_e, payload: { courseId: string; chapterId: string; lessonId: string }) =>
    wrap(() => getLessonV2(coursesRoot, payload.courseId, payload.chapterId, payload.lessonId))
  )

  ipcMain.handle(IpcChannel.CourseAssetRead, (_e, payload: { courseId: string; relPath: string }) =>
    wrap(async () => ({ dataUrl: await getCourseAssetDataUrl(coursesRoot, payload.courseId, payload.relPath) }))
  )
}
