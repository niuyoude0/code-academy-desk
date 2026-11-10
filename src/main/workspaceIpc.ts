import { ipcMain } from 'electron'
import { IpcChannel } from '../shared/ipc'
import { listWorkspaceTree, readWorkspaceFile, writeWorkspaceFile, WorkspaceError } from './services/workspaceFs'

/** P7 文件工作区 IPC：workspace:tree/read/write（路径限定与大小上限在服务层）。 */
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
}
