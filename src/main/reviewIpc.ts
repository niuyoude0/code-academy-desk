import { ipcMain } from 'electron'
import { IpcChannel } from '../shared/ipc'
import type { ReviewStatus } from '../shared/course-v2-schema'
import { setReviewStatusV2 } from './services/coursePackageV2'
import { getReviewOverview, validateLessonForReview, getOcrPageForCourse } from './services/reviewView'
import { saveKpDigest } from './services/learningPath'

/**
 * P5.7 校对域 IPC：review.json 人审（总览/状态流转/重校验/页码抽查）+ digest 人工定稿。
 *  - 全部只写 review.json / progress.json；课件内容文件只读
 *  - 页码抽查读 materialsRoot（只读 ocr/ 下 .md，白名单在 kpSource.readMaterialPage）
 */
export function registerReviewIpc(coursesRoot: string, materialsRoot: string): void {
  const wrap = async <T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  ipcMain.handle(IpcChannel.ReviewGet, (_e, payload: { courseId: string }) =>
    wrap(() => getReviewOverview(coursesRoot, payload.courseId))
  )

  ipcMain.handle(
    IpcChannel.ReviewSetStatus,
    (_e, payload: { courseId: string; lessonId: string; status: ReviewStatus; feedback?: string }) =>
      wrap(async () => {
        const feedback = payload.feedback != null && payload.feedback.length > 0 ? payload.feedback : undefined
        // failed 必须带错误清单：主进程现跑一遍校验写入，避免渲染层传旧数据
        if (payload.status === 'failed') {
          const v = await validateLessonForReview(coursesRoot, payload.courseId, payload.lessonId)
          return setReviewStatusV2(coursesRoot, payload.courseId, payload.lessonId, 'failed', {
            errors: v.errors,
            ...(feedback != null ? { feedback } : {})
          })
        }
        return setReviewStatusV2(coursesRoot, payload.courseId, payload.lessonId, payload.status, {
          ...(feedback != null ? { feedback } : {})
        })
      })
  )

  ipcMain.handle(IpcChannel.ReviewValidate, (_e, payload: { courseId: string; lessonId: string }) =>
    wrap(() => validateLessonForReview(coursesRoot, payload.courseId, payload.lessonId))
  )

  ipcMain.handle(
    IpcChannel.ReviewPageText,
    (_e, payload: { courseId: string; ref: { ocrFile?: string; bookPage?: number | null } }) =>
      wrap(() => getOcrPageForCourse(coursesRoot, materialsRoot, payload.courseId, payload.ref))
  )

  ipcMain.handle(
    IpcChannel.KpDigestSave,
    (_e, payload: { courseId: string; kpId: string; core: string; takeaway: string }) =>
      wrap(() =>
        saveKpDigest(coursesRoot, payload.courseId, payload.kpId, {
          core: payload.core,
          takeaway: payload.takeaway
        })
      )
  )
}
