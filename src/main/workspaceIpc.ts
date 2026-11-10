import { ipcMain } from 'electron'
import { IpcChannel } from '../shared/ipc'
import { listWorkspaceTree, readWorkspaceFile, writeWorkspaceFile } from './services/workspaceFs'
import { runScript } from './services/runner'

/** P7/P8 文件工作区 IPC：workspace:tree/read/write/run（路径限定与大小上限在服务层）。 */
export function registerWorkspaceIpc(workspaceRoot: string): void {
  ipcMain.handle(IpcChannel.WorkspaceTree, async (_e, payload: { courseId: string }) => {
    try {
      return { ok: true, data: await listWorkspaceTree(workspaceRoot, payload.courseId) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannel.WorkspaceRead, async (_e, payload: { courseId: string; path: string }) => {
    try {
      return { ok: true, data: await readWorkspaceFile(workspaceRoot, payload.courseId, payload.path) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IpcChannel.WorkspaceWrite,
    async (_e, payload: { courseId: string; path: string; content: string }) => {
      try {
        return { ok: true, data: await writeWorkspaceFile(workspaceRoot, payload.courseId, payload.path, payload.content) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // P8 通用执行：文件名展平进 runs/<courseId>/_scratch 跑，捕获 stdout/stderr/退出码
  ipcMain.handle(
    IpcChannel.WorkspaceRun,
    async (_e, payload: { courseId: string; fileName: string; content: string }) => {
      try {
        const data = await runScript({
          workspaceRoot,
          courseId: payload.courseId,
          fileName: payload.fileName,
          content: payload.content
        })
        return { ok: true, data }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
