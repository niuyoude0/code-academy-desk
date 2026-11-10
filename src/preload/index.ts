import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '../shared/ipc'
import type {
  AppInfo,
  DesktopApi,
  IpcResult,
  SkillEntry,
  MaterialEntry,
  AgentTurnInput,
  AgentSettingsPatch,
  AgentSettingsView,
  AgentStreamEvent,
  McpServerEntry,
  KpCompleteInput,
  CoursePathView,
  ExerciseDocument,
  RunnerRunInput,
  RunResult
} from '../shared/ipc'
import type { ProgressFile } from '../shared/learning-path-schema'
import type { CoursePackage, CourseIndexEntry, ImportResult } from '../shared/course-schema'

const api: DesktopApi = {
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannel.AppInfo),
  ping: (): Promise<'pong'> => ipcRenderer.invoke(IpcChannel.Ping),
  courseImport: (): Promise<IpcResult<ImportResult>> =>
    ipcRenderer.invoke(IpcChannel.CourseImport),
  courseList: (): Promise<IpcResult<CourseIndexEntry[]>> =>
    ipcRenderer.invoke(IpcChannel.CourseList),
  courseGet: (courseId: string): Promise<IpcResult<CoursePackage>> =>
    ipcRenderer.invoke(IpcChannel.CourseGet, { courseId }),
  courseRemove: (courseId: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(IpcChannel.CourseRemove, { courseId }),
  courseExport: (courseId: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannel.CourseExport, { courseId }),
  skillList: (): Promise<IpcResult<SkillEntry[]>> => ipcRenderer.invoke(IpcChannel.SkillList),
  skillGet: (name: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannel.SkillGet, { name }),
  skillReadFile: (name: string, relPath: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannel.SkillReadFile, { name, relPath }),
  skillInstall: (): Promise<IpcResult<SkillEntry>> => ipcRenderer.invoke(IpcChannel.SkillInstall),
  materialImport: (): Promise<IpcResult<MaterialEntry>> =>
    ipcRenderer.invoke(IpcChannel.MaterialImport),
  materialList: (): Promise<IpcResult<MaterialEntry[]>> =>
    ipcRenderer.invoke(IpcChannel.MaterialList),
  materialReadFile: (id: string, relPath: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannel.MaterialReadFile, { id, relPath }),
  materialRemove: (id: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(IpcChannel.MaterialRemove, { id }),
  agentChat: (input: AgentTurnInput): Promise<IpcResult<{ sessionId: string; runId: string }>> =>
    ipcRenderer.invoke(IpcChannel.AgentChat, input),
  agentAbort: (runId: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(IpcChannel.AgentAbort, { runId }),
  agentResume: (sessionId: string): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke(IpcChannel.AgentResume, { sessionId }),
  mcpList: (): Promise<IpcResult<McpServerEntry[]>> => ipcRenderer.invoke(IpcChannel.McpList),
  mcpAdd: (input: Omit<McpServerEntry, 'id'>): Promise<IpcResult<McpServerEntry>> =>
    ipcRenderer.invoke(IpcChannel.McpAdd, input),
  mcpUpdate: (
    patch: Partial<Omit<McpServerEntry, 'id'>> & { id: string }
  ): Promise<IpcResult<McpServerEntry[]>> => ipcRenderer.invoke(IpcChannel.McpUpdate, patch),
  mcpRemove: (id: string): Promise<IpcResult<true>> => ipcRenderer.invoke(IpcChannel.McpRemove, { id }),
  pathGet: (courseId: string): Promise<IpcResult<CoursePathView>> =>
    ipcRenderer.invoke(IpcChannel.PathGet, { courseId }),
  kpStart: (courseId: string, kpId: string): Promise<IpcResult<ProgressFile>> =>
    ipcRenderer.invoke(IpcChannel.KpStart, { courseId, kpId }),
  kpSkip: (courseId: string, kpId: string): Promise<IpcResult<ProgressFile>> =>
    ipcRenderer.invoke(IpcChannel.KpSkip, { courseId, kpId }),
  kpComplete: (input: KpCompleteInput): Promise<IpcResult<ProgressFile>> =>
    ipcRenderer.invoke(IpcChannel.KpComplete, input),
  lessonGet: (courseId: string, chapterId: string, lessonId: string): Promise<IpcResult<unknown>> =>
    ipcRenderer.invoke(IpcChannel.LessonGet, { courseId, chapterId, lessonId }),
  exerciseGet: (courseId: string, exerciseId: string): Promise<IpcResult<ExerciseDocument>> =>
    ipcRenderer.invoke(IpcChannel.ExerciseGet, { courseId, exerciseId }),
  runnerRun: (input: RunnerRunInput): Promise<IpcResult<RunResult>> =>
    ipcRenderer.invoke(IpcChannel.RunnerRun, input),
  courseAssetRead: (courseId: string, relPath: string): Promise<IpcResult<{ dataUrl: string }>> =>
    ipcRenderer.invoke(IpcChannel.CourseAssetRead, { courseId, relPath }),
  interactiveCompile: (source: string): Promise<IpcResult<{ code: string; cached: boolean }>> =>
    ipcRenderer.invoke(IpcChannel.InteractiveCompile, { source }),
  interactiveBridge: (payload: {
    courseId: string
    kind: string
    params: Record<string, unknown>
  }): Promise<IpcResult<unknown>> => ipcRenderer.invoke(IpcChannel.InteractiveBridge, payload),
  agentSettingsGet: (): Promise<IpcResult<AgentSettingsView>> =>
    ipcRenderer.invoke(IpcChannel.AgentSettingsGet),
  agentSettingsSet: (patch: AgentSettingsPatch): Promise<IpcResult<AgentSettingsView>> =>
    ipcRenderer.invoke(IpcChannel.AgentSettingsSet, patch),
  onAgentEvent: (
    listener: (payload: { runId: string; event: AgentStreamEvent }) => void
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { runId: string; event: AgentStreamEvent }): void =>
      listener(payload)
    ipcRenderer.on(IpcChannel.AgentEvent, handler)
    return () => ipcRenderer.removeListener(IpcChannel.AgentEvent, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
