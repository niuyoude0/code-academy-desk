/**
 * 主/渲染进程共享的 IPC 契约。
 * P2 阶段先落 app:info 与 app:ping 两个通道；后续模块（课程包/工作区/Runner/Agent）
 * 各自在此扩展独立的通道组，保持命名 "<domain>:<action>"。
 */
export const IpcChannel = {
  AppInfo: 'app:info',
  Ping: 'app:ping',
  CourseImport: 'course:import',
  CourseList: 'course:list',
  CourseGet: 'course:get',
  CourseRemove: 'course:remove',
  CourseExport: 'course:export',
  SkillList: 'skill:list',
  SkillGet: 'skill:get',
  SkillReadFile: 'skill:readFile',
  SkillInstall: 'skill:install',
  MaterialImport: 'material:import',
  MaterialList: 'material:list',
  MaterialReadFile: 'material:readFile',
  MaterialRemove: 'material:remove',
  AgentChat: 'agent:chat',
  AgentAbort: 'agent:abort',
  AgentResume: 'agent:resume',
  AgentSettingsGet: 'agent:settings:get',
  AgentSettingsSet: 'agent:settings:set',
  AgentEvent: 'agent:event',
  McpList: 'mcp:list',
  McpAdd: 'mcp:add',
  McpUpdate: 'mcp:update',
  McpRemove: 'mcp:remove',
  PathGet: 'path:get',
  KpStart: 'kp:start',
  KpSkip: 'kp:skip',
  KpComplete: 'kp:complete',
  KpDigestSave: 'kp:digest:save',
  LessonGet: 'lesson:get',
  ExerciseGet: 'exercise:get',
  RunnerRun: 'runner:run',
  ReviewGet: 'review:get',
  ReviewSetStatus: 'review:setStatus',
  ReviewValidate: 'review:validate',
  ReviewPageText: 'review:pageText',
  CourseAssetRead: 'course:asset:read',
  InteractiveCompile: 'interactive:compile',
  InteractiveBridge: 'interactive:bridge'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  platform: string
}

/** IPC 统一返回信封：渲染层据此处理成功/失败。 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

import type { CourseIndexEntry, CoursePackage, ImportResult } from './course-schema'

/** 技能（agentskills.io SKILL.md 契约的元信息）。 */
export interface SkillEntry {
  name: string
  description: string
  source: 'builtin' | 'user'
}

/** 教材资料（book-prep-ocr 技能产物）元信息。 */
export interface MaterialEntry {
  id: string
  title: string
  authors?: string
  edition?: string
  publisher?: string
  year?: string
  pageOffsets: { section?: string; offset: number }[]
  factsheets: string[]
  ocrPageCount: number
  qaLogExists: boolean
}

/* ===== Agent 域（DSH Runtime 单通道） ===== */

/** 发起一轮对话：上下文由 DSH 会话持有，渲染层只带会话 id 与本轮用户输入。 */
export interface AgentTurnInput {
  /** 会话 id；null 表示开新会话（主进程生成并返回） */
  sessionId: string | null
  text: string
}

/** 主进程 → 渲染层的 Agent 流事件（经 AgentEvent 通道，附带 runId）。 */
export type AgentStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: string }
  | { type: 'tool-error'; toolCallId: string; toolName: string; error: string }
  | { type: 'finish'; finishReason: string }
  | { type: 'aborted' }
  | { type: 'error'; message: string }

/** 权限档位（DSH DSH_PERMISSION_MODE 预设，沙箱+审批联动）。 */
export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Agent 设置（读方向：apiKey 永远脱敏）。 */
export interface AgentSettingsView {
  configured: boolean
  provider: 'deepseek' | 'openai-compatible'
  model: string
  baseUrl?: string
  apiKeyMasked: string
  permissionMode: PermissionMode
}

/** Agent 设置（写方向：字段可选，只提交要改的）。 */
export interface AgentSettingsPatch {
  apiKey?: string
  model?: string
  baseUrl?: string | null
  permissionMode?: PermissionMode
}

/** MCP 服务器（DSH dsh-mcp-client；工具名 mcp__<serverName>__<tool>）。 */
export interface McpServerEntry {
  id: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  enabled: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

/* ===== 学习路径域（P5.4 知识点驱动） ===== */

import type { PathFile, ProgressFile } from './learning-path-schema'
export type { PathFile, ProgressFile } from './learning-path-schema'

/** 课程学习路径总览（path 未初始化时 path=null，progress 侧自动初始化为空）。 */
export interface CoursePathView {
  courseId: string
  title: string
  path: PathFile | null
  progress: ProgressFile
}

/** 完成判定（D6：quiz 本地判 + 编程题 Runner；forced = 应急门）。 */
export interface KpCompleteInput {
  courseId: string
  kpId: string
  quizBest?: string
  codingPassed?: boolean
  forced?: boolean
  digest?: { core: string; takeaway: string }
}

/* ===== 校对域（P5.7 review.json 人审） ===== */

import type { ReviewRecord, ReviewStatus, ReviewFile, ExerciseDocument } from './course-v2-schema'
import type { CapacityWarning } from './lesson-quality'
export type { ReviewRecord, ReviewStatus, ReviewFile, ExerciseDocument } from './course-v2-schema'
export type { CapacityWarning } from './lesson-quality'

/** book 块页码锚（页码抽查面板行）。 */
export interface BookBlockAnchor {
  blockId: string
  blockType: string
  pdfPage: number
  bookPage: number | null
  ocrFile?: string
  /** quote 块摘录前 120 字（面板预览） */
  excerpt?: string
}

/** 校对总览中的单课条目（损坏课件 doc=null 但 errors 有内容——校对页就是要看坏课件）。 */
export interface LessonReviewItem {
  lessonId: string
  chapterId: string
  chapterTitle: string
  title: string
  file: string
  blockCount: number
  bookBlocks: BookBlockAnchor[]
  review: ReviewRecord | null
  errors: { path: string; message: string }[]
  warns: CapacityWarning[]
  doc: unknown | null
  words: number
}

/** 校对页总览（review:get）。 */
export interface ReviewOverview {
  courseId: string
  title: string
  /** 教材资料 id（页码抽查用；未关联为 null） */
  materialId: string | null
  reviews: ReviewRecord[]
  lessons: LessonReviewItem[]
  /** 学习路径上的 KP id 集（lessonId 命中 = KP 课件，显示 digest 定稿区） */
  pathKpIds: string[]
  /** progress.json 中已有 digest 的 KP 现值（校对页 digest 定稿区回显） */
  digests: Record<string, { core: string; takeaway: string }>
}

/** 页码抽查的 OCR 页原文（review:pageText；未命中对应页为 null）。 */
export interface OcrPageResult {
  ocrFile: string
  md: string
  bookPage: number | null
  pdfPage: number | null
  neighbors: string[]
}

/* ===== Runner 域（P8 核心 + P5.8 编程题判定） ===== */

export interface RunnerTestResult {
  id: string
  name: string
  passed: boolean
  expected: string
  actual: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

/** 一次编程题运行（runner:run）。compile 仅 c 档位有；ok=false 时 results 为空。 */
export interface RunResult {
  language: string
  compile?: { ok: boolean; output: string }
  results: RunnerTestResult[]
  passedAll: boolean
  totalRunMs: number
  entryPath: string
}

/** 运行编程题（files/tests 形状 = CodeFile[]/TestCase[]，服务端 zod/字段级校验）。 */
export interface RunnerRunInput {
  courseId: string
  exerciseId: string
  language: string
  files: unknown
  tests: unknown[]
  timeoutMs?: number
}

/** 通过 contextBridge 暴露给渲染层的 API 面（window.api）。 */
export interface DesktopApi {
  appInfo(): Promise<AppInfo>
  ping(): Promise<'pong'>
  courseImport(): Promise<IpcResult<ImportResult>>
  courseList(): Promise<IpcResult<CourseIndexEntry[]>>
  courseGet(courseId: string): Promise<IpcResult<CoursePackage>>
  courseRemove(courseId: string): Promise<IpcResult<true>>
  /** 弹出保存对话框写出 zip，返回保存路径 */
  courseExport(courseId: string): Promise<IpcResult<string>>
  skillList(): Promise<IpcResult<SkillEntry[]>>
  /** 读取技能 SKILL.md 全文 */
  skillGet(name: string): Promise<IpcResult<string>>
  skillReadFile(name: string, relPath: string): Promise<IpcResult<string>>
  skillInstall(): Promise<IpcResult<SkillEntry>>
  materialImport(): Promise<IpcResult<MaterialEntry>>
  materialList(): Promise<IpcResult<MaterialEntry[]>>
  materialReadFile(id: string, relPath: string): Promise<IpcResult<string>>
  materialRemove(id: string): Promise<IpcResult<true>>
  /** 发起一轮 Agent 对话（上下文在 DSH 会话侧）；流事件经 onAgentEvent 推送。 */
  agentChat(input: AgentTurnInput): Promise<IpcResult<{ sessionId: string; runId: string }>>
  agentAbort(runId: string): Promise<IpcResult<true>>
  /** 恢复既有 DSH 会话（应用重启后继续上下文）；失败返回 false，调用方应开新会话。 */
  agentResume(sessionId: string): Promise<IpcResult<boolean>>
  agentSettingsGet(): Promise<IpcResult<AgentSettingsView>>
  agentSettingsSet(patch: AgentSettingsPatch): Promise<IpcResult<AgentSettingsView>>
  mcpList(): Promise<IpcResult<McpServerEntry[]>>
  mcpAdd(input: Omit<McpServerEntry, 'id'>): Promise<IpcResult<McpServerEntry>>
  mcpUpdate(patch: Partial<Omit<McpServerEntry, 'id'>> & { id: string }): Promise<IpcResult<McpServerEntry[]>>
  mcpRemove(id: string): Promise<IpcResult<true>>
  /** 学习路径总览（path.json 未建时 path=null） */
  pathGet(courseId: string): Promise<IpcResult<CoursePathView>>
  /** 开始/回溯学习某知识点（线性解锁校验在主进程） */
  kpStart(courseId: string, kpId: string): Promise<IpcResult<ProgressFile>>
  /** 跳过知识点（须已解锁；digest 链留空缺） */
  kpSkip(courseId: string, kpId: string): Promise<IpcResult<ProgressFile>>
  /** 完成判定（quiz≥2/3 且编程未失败；forced=true 为应急门；digest 缺省时主进程从课件自动提取） */
  kpComplete(input: KpCompleteInput): Promise<IpcResult<ProgressFile>>
  /** 直接写入/修订 KP digest（校对页人工定稿用） */
  kpDigestSave(input: { courseId: string; kpId: string; core: string; takeaway: string }): Promise<IpcResult<ProgressFile>>
  /** 校对总览：全量课件 + 校验结果 + 人审记录（损坏课件也带 errors 返回） */
  reviewGet(courseId: string): Promise<IpcResult<ReviewOverview>>
  /** 人审状态流转（draft→valid|approved|failed；failed 必须带 feedback） */
  reviewSetStatus(input: {
    courseId: string
    lessonId: string
    status: ReviewStatus
    feedback?: string
  }): Promise<IpcResult<ReviewFile>>
  /** 单课重校验（error=铁律/schema；warn=容量硬标准） */
  reviewValidate(courseId: string, lessonId: string): Promise<IpcResult<{ errors: { path: string; message: string }[]; warns: CapacityWarning[]; words: number }>>
  /** 页码抽查：块 source → OCR 页原文（未命中返回 null） */
  reviewPageText(courseId: string, ref: { ocrFile?: string; bookPage?: number | null }): Promise<IpcResult<OcrPageResult | null>>
  /** 读课件文档（学习视图渲染用） */
  lessonGet(courseId: string, chapterId: string, lessonId: string): Promise<IpcResult<unknown>>
  /** 读练习文档（编程题题面/起步文件/测试） */
  exerciseGet(courseId: string, exerciseId: string): Promise<IpcResult<ExerciseDocument>>
  /** 本机运行编程题（P8 Runner：临时工作区/超时杀树/stdin-stdout 测试判定） */
  runnerRun(input: RunnerRunInput): Promise<IpcResult<RunResult>>
  /** 读课程包 assets/ 内图片 → data URL（image 块渲染用） */
  courseAssetRead(courseId: string, relPath: string): Promise<IpcResult<{ dataUrl: string }>>
  /** 编译 interactive 组件 TSX → ESM（主进程 esbuild，白名单 import 重写为 cad-i:// chunk URL） */
  interactiveCompile(source: string): Promise<IpcResult<{ code: string; cached: boolean }>>
  /**
   * interactive 沙箱组件的宿主能力桥（D2：受限 Renderer + 白名单桥）。
   * kind ∈ fs.readCourseFile / fs.readCourseAsset / fs.getProgress / fs.getManifest / system.getInfo
   * （agent.askTutor 与 host.* 是渲染层本地动作，不经过主进程）
   */
  interactiveBridge(payload: {
    courseId: string
    kind: string
    params: Record<string, unknown>
  }): Promise<IpcResult<unknown>>
  /** 订阅 Agent 流事件；返回取消订阅函数。 */
  onAgentEvent(listener: (payload: { runId: string; event: AgentStreamEvent }) => void): () => void
}
