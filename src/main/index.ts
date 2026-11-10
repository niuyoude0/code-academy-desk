import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { IpcChannel } from '../shared/ipc'
import type { AppInfo, IpcResult, SkillEntry, MaterialEntry } from '../shared/ipc'
import type { CourseIndexEntry, CoursePackage, ImportResult } from '../shared/course-schema'
import {
  importCourseZip,
  listCourses,
  getCourse,
  removeCourse,
  exportCourseToZip,
  CoursePackageError
} from './services/coursePackage'
import {
  ensureBuiltinSkills,
  builtinSkillsDir,
  listSkills,
  readSkillBody,
  readSkillFile,
  installSkillFromFolder,
  SkillError
} from './services/skills'
import {
  importMaterialFolder,
  listMaterials,
  readMaterialFile,
  removeMaterial,
  MaterialError
} from './services/courseMaterials'
import {
  createDshRuntime,
  resolveDshPaths,
  DshError,
  AgentSettingsError
} from './services/dshRuntime'
import {
  readAgentSettings,
  saveAgentSettings,
  toSettingsView
} from './services/agentSettings'
import { mkdirSync } from 'fs'
import {
  listMcpServers,
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  McpError
} from './services/mcpServers'
import type { AgentSettingsPatch, AgentTurnInput, McpServerEntry } from '../shared/ipc'
import { registerPathIpc } from './pathIpc'
import { registerReviewIpc } from './reviewIpc'
import { registerRunnerIpc } from './runnerIpc'
import { registerInteractiveProtocolScheme, registerInteractiveIpc } from './interactiveIpc'

// cad-i:// 沙箱协议必须在 app ready 前注册
registerInteractiveProtocolScheme()

/** --smoke 冒烟模式：窗口加载完成后输出 SMOKE_OK 并自动退出，供脚本化验证。 */
const isSmoke = process.argv.includes('--smoke')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a1120',
    autoHideMenuBar: true,
    title: 'Code Academy Desk',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 外部链接交给系统浏览器，禁止在应用内开新窗口
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.AppInfo, (): AppInfo => ({
    name: 'Code Academy Desk',
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node ?? 'unknown',
    platform: process.platform
  }))
  ipcMain.handle(IpcChannel.Ping, (): 'pong' => 'pong')
}

/** 课程域 IPC：错误统一收敛到 IpcResult 信封，渲染层无需 try/catch。 */
function registerCourseIpc(coursesRoot: string): void {
  const wrap = async <T>(fn: () => Promise<T>): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      if (err instanceof CoursePackageError) return { ok: false, error: err.message }
      console.error('[course] 未预期错误:', err)
      return { ok: false, error: '内部错误，请查看日志' }
    }
  }

  ipcMain.handle(IpcChannel.CourseImport, (): Promise<IpcResult<ImportResult>> =>
    wrap(async () => {
      const res = await dialog.showOpenDialog({
        title: '导入课程包（.zip）',
        filters: [{ name: '课程包', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (res.canceled || res.filePaths.length === 0) {
        throw new CoursePackageError('已取消导入')
      }
      return importCourseZip(coursesRoot, res.filePaths[0])
    })
  )

  ipcMain.handle(IpcChannel.CourseList, (): Promise<IpcResult<CourseIndexEntry[]>> =>
    wrap(() => listCourses(coursesRoot))
  )

  ipcMain.handle(
    IpcChannel.CourseGet,
    (_event, payload: { courseId: string }): Promise<IpcResult<CoursePackage>> =>
      wrap(() => getCourse(coursesRoot, payload.courseId))
  )

  ipcMain.handle(
    IpcChannel.CourseRemove,
    (_event, payload: { courseId: string }): Promise<IpcResult<true>> =>
      wrap(async (): Promise<true> => {
        await removeCourse(coursesRoot, payload.courseId)
        return true
      })
  )

  ipcMain.handle(
    IpcChannel.CourseExport,
    (_event, payload: { courseId: string }): Promise<IpcResult<string>> =>
      wrap(async () => {
        const res = await dialog.showSaveDialog({
          title: '导出课程包',
          defaultPath: `${payload.courseId}.zip`,
          filters: [{ name: '课程包', extensions: ['zip'] }]
        })
        if (res.canceled || res.filePath == null) {
          throw new CoursePackageError('已取消导出')
        }
        await exportCourseToZip(coursesRoot, payload.courseId, res.filePath)
        return res.filePath
      })
  )
}

/** 技能域 IPC。 */
function registerSkillIpc(skillsRoot: string): void {
  const wrap = async <T>(fn: () => Promise<T>): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      if (err instanceof SkillError) return { ok: false, error: err.message }
      console.error('[skill] 未预期错误:', err)
      return { ok: false, error: '内部错误，请查看日志' }
    }
  }
  const toEntry = (s: { name: string; description: string }): SkillEntry => ({
    name: s.name,
    description: s.description,
    source: 'user'
  })

  ipcMain.handle(IpcChannel.SkillList, (): Promise<IpcResult<SkillEntry[]>> =>
    wrap(async () => (await listSkills(skillsRoot)).map(toEntry))
  )
  ipcMain.handle(
    IpcChannel.SkillGet,
    (_e, payload: { name: string }): Promise<IpcResult<string>> =>
      wrap(() => readSkillBody(skillsRoot, payload.name))
  )
  ipcMain.handle(
    IpcChannel.SkillReadFile,
    (_e, payload: { name: string; relPath: string }): Promise<IpcResult<string>> =>
      wrap(() => readSkillFile(skillsRoot, payload.name, payload.relPath))
  )
  ipcMain.handle(IpcChannel.SkillInstall, (): Promise<IpcResult<SkillEntry>> =>
    wrap(async () => {
      const res = await dialog.showOpenDialog({
        title: '安装技能（选择技能文件夹）',
        properties: ['openDirectory']
      })
      if (res.canceled || res.filePaths.length === 0) {
        throw new SkillError('已取消安装')
      }
      return installSkillFromFolder(res.filePaths[0], skillsRoot)
    })
  )
}

/** 教材资料域 IPC（book-prep-ocr 技能产物）。 */
function registerMaterialIpc(materialsRoot: string): void {
  const wrap = async <T>(fn: () => Promise<T>): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      if (err instanceof MaterialError) return { ok: false, error: err.message }
      console.error('[material] 未预期错误:', err)
      return { ok: false, error: '内部错误，请查看日志' }
    }
  }

  ipcMain.handle(IpcChannel.MaterialImport, (): Promise<IpcResult<MaterialEntry>> =>
    wrap(async () => {
      const res = await dialog.showOpenDialog({
        title: '导入教材资料（book-prep-ocr 产物目录）',
        properties: ['openDirectory']
      })
      if (res.canceled || res.filePaths.length === 0) {
        throw new MaterialError('已取消导入')
      }
      const info = await importMaterialFolder(res.filePaths[0], materialsRoot)
      return {
        id: info.id,
        title: info.title ?? `教材资料 ${info.id}`,
        authors: info.authors,
        edition: info.edition,
        publisher: info.publisher,
        year: info.year,
        pageOffsets: info.pageOffsets,
        factsheets: info.factsheets,
        ocrPageCount: info.ocrPageCount,
        qaLogExists: info.qaLogExists
      }
    })
  )
  ipcMain.handle(IpcChannel.MaterialList, (): Promise<IpcResult<MaterialEntry[]>> =>
    wrap(async () =>
      (await listMaterials(materialsRoot)).map((m) => ({
        id: m.id,
        title: m.title ?? `教材资料 ${m.id}`,
        authors: m.authors,
        edition: m.edition,
        publisher: m.publisher,
        year: m.year,
        pageOffsets: m.pageOffsets,
        factsheets: m.factsheets,
        ocrPageCount: m.ocrPageCount,
        qaLogExists: m.qaLogExists
      }))
    )
  )
  ipcMain.handle(
    IpcChannel.MaterialReadFile,
    (_e, payload: { id: string; relPath: string }): Promise<IpcResult<string>> =>
      wrap(() => readMaterialFile(materialsRoot, payload.id, payload.relPath))
  )
  ipcMain.handle(
    IpcChannel.MaterialRemove,
    (_e, payload: { id: string }): Promise<IpcResult<true>> =>
      wrap(async (): Promise<true> => {
        await removeMaterial(materialsRoot, payload.id)
        return true
      })
  )
}

/** MCP 域 IPC：服务器 CRUD（配置存本机；profile patch 由 ensureProfile 在下次启动重生成，DSH 重启后生效）。 */
function registerMcpIpc(settingsRoot: string, onChange: () => void): void {
  const wrap = async <T>(fn: () => Promise<T>): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      if (err instanceof McpError) return { ok: false, error: err.message }
      console.error('[mcp] 未预期错误:', err)
      return { ok: false, error: err instanceof Error ? err.message : '内部错误' }
    }
  }

  ipcMain.handle(IpcChannel.McpList, (): Promise<IpcResult<McpServerEntry[]>> =>
    wrap(async () => listMcpServers(settingsRoot))
  )
  ipcMain.handle(
    IpcChannel.McpAdd,
    (_e, input: Omit<McpServerEntry, 'id'>): Promise<IpcResult<McpServerEntry>> =>
      wrap(async () => {
        const added = await addMcpServer(settingsRoot, input)
        onChange()
        return added
      })
  )
  ipcMain.handle(
    IpcChannel.McpUpdate,
    (_e, patch: Partial<Omit<McpServerEntry, 'id'>> & { id: string }): Promise<IpcResult<McpServerEntry[]>> =>
      wrap(async () => {
        const next = await updateMcpServer(settingsRoot, patch)
        onChange()
        return next
      })
  )
  ipcMain.handle(
    IpcChannel.McpRemove,
    (_e, payload: { id: string }): Promise<IpcResult<true>> =>
      wrap(async (): Promise<true> => {
        await removeMcpServer(settingsRoot, payload.id)
        onChange()
        return true
      })
  )
}

/** Agent 域 IPC：DSH Runtime 单通道（对话上下文归 DSH 会话）+ 设置读写（apiKey 永远脱敏）。 */
function registerAgentIpc(settingsRoot: string): { shutdown: () => void; restart: () => void } {
  const dsh = createDshRuntime({
    paths: resolveDshPaths(app.getAppPath(), app.getPath('userData')),
    settingsRoot,
    getWindow: () => BrowserWindow.getAllWindows()[0] ?? null
  })

  const wrap = async <T>(fn: () => Promise<T>): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn() }
    } catch (err) {
      if (err instanceof DshError || err instanceof AgentSettingsError) {
        return { ok: false, error: err.message }
      }
      console.error('[agent] 未预期错误:', err)
      return { ok: false, error: err instanceof Error ? err.message : '内部错误' }
    }
  }

  ipcMain.handle(
    IpcChannel.AgentChat,
    (event, payload: AgentTurnInput): Promise<IpcResult<{ sessionId: string; runId: string }>> =>
      wrap(() => dsh.chat(payload.text, payload.sessionId, event.sender))
  )
  ipcMain.handle(
    IpcChannel.AgentResume,
    (_e, payload: { sessionId: string }): Promise<IpcResult<boolean>> =>
      wrap(() => dsh.resume(payload.sessionId))
  )
  ipcMain.handle(
    IpcChannel.AgentAbort,
    (_e, payload: { runId: string }): Promise<IpcResult<true>> =>
      wrap(async (): Promise<true> => {
        dsh.abort(payload.runId)
        return true
      })
  )
  ipcMain.handle(IpcChannel.AgentSettingsGet, (): Promise<IpcResult<ReturnType<typeof toSettingsView>>> =>
    wrap(async () => toSettingsView(await readAgentSettings(settingsRoot)))
  )
  ipcMain.handle(
    IpcChannel.AgentSettingsSet,
    (_e, patch: AgentSettingsPatch): Promise<IpcResult<ReturnType<typeof toSettingsView>>> =>
      wrap(async () => {
        const view = toSettingsView(await saveAgentSettings(settingsRoot, patch))
        // 权限档位/模型等在 spawn 时生效：杀掉现有进程，下一轮按新设置懒重启
        dsh.restart()
        return view
      })
  )

  return { shutdown: () => dsh.shutdown(), restart: () => dsh.restart() }
}

app.whenReady().then(() => {
  registerIpc()
  const userData = app.getPath('userData')
  const skillsRoot = join(userData, 'skills')
  ensureBuiltinSkills(builtinSkillsDir(app.getAppPath()), skillsRoot)
  registerSkillIpc(skillsRoot)
  registerCourseIpc(join(userData, 'courses'))
  registerMaterialIpc(join(userData, 'materials'))
  registerPathIpc(join(userData, 'courses'))
  registerReviewIpc(join(userData, 'courses'), join(userData, 'materials'))
  registerRunnerIpc(join(userData, 'courses'), join(userData, 'workspace'), join(app.getAppPath(), 'resources', 'dsh-runtime', 'node24', 'node.exe'))
  registerInteractiveIpc(join(userData, 'courses'))
  const workspaceRoot = join(userData, 'workspace')
  mkdirSync(workspaceRoot, { recursive: true })
  const agentIpc = registerAgentIpc(userData)
  dshShutdown = agentIpc.shutdown
  // MCP 服务器变更 → 重启 DSH；profile patch 由 ensureProfile 在下次 boot 重新生成
  registerMcpIpc(userData, () => agentIpc.restart())
  const win = createWindow()

  if (isSmoke) {
    const timeout = setTimeout(() => {
      console.error('SMOKE_TIMEOUT')
      app.exit(1)
    }, 20000)
    win.webContents.on('did-finish-load', () => {
      clearTimeout(timeout)
      console.log('SMOKE_OK renderer-loaded')
      setTimeout(() => app.quit(), 300)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** DSH 运行时的优雅关闭（whenReady 时赋值）。 */
let dshShutdown: (() => void) | null = null
app.on('before-quit', () => {
  dshShutdown?.()
})
