import { ipcMain } from 'electron'
import { IpcChannel } from '../shared/ipc'
import type { RunnerRunInput } from '../shared/ipc'
import { getExerciseV2 } from './services/coursePackageV2'
import { runExercise, RunnerError } from './services/runner'

/**
 * P8 Runner 域 IPC（P5.8 编程题判定复用）：
 *  - exercise:get 读练习文档（题面/起步文件/测试）
 *  - runner:run 本机执行 + stdin/stdout 测试判定（工作区/超时/路径限定在 runner.ts 服务层）
 *  - node24Path 由宿主传入（vendor 便携 node，javascript 档位优先）
 */
export function registerRunnerIpc(coursesRoot: string, workspaceRoot: string, node24Path: string): void {
  const wrap = async <T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  ipcMain.handle(IpcChannel.ExerciseGet, (_e, payload: { courseId: string; exerciseId: string }) =>
    wrap(() => getExerciseV2(coursesRoot, payload.courseId, payload.exerciseId))
  )

  ipcMain.handle(IpcChannel.RunnerRun, (_e, payload: RunnerRunInput) =>
    wrap(async () => {
      try {
        return await runExercise({
          workspaceRoot,
          courseId: payload.courseId,
          exerciseId: payload.exerciseId,
          language: payload.language,
          files: payload.files,
          tests: Array.isArray(payload.tests) ? payload.tests : [],
          ...(payload.timeoutMs != null ? { timeoutMs: payload.timeoutMs } : {}),
          node24Path
        })
      } catch (err) {
        // RunnerError 直接透出可读信息；其他错误包装避免泄漏内部栈
        if (err instanceof RunnerError) throw err
        throw new RunnerError(err instanceof Error ? err.message : String(err))
      }
    })
  )
}
