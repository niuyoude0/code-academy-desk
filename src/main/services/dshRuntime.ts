import { spawn, type ChildProcess } from 'child_process'
import { existsSync, symlinkSync, writeFileSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'
import { dialog, type BrowserWindow, type WebContents } from 'electron'
import type { AgentStreamEvent } from '../../shared/ipc'
import { IpcChannel } from '../../shared/ipc'
import { readAgentSettings, AgentSettingsError } from './agentSettings'
import { ShellError } from './shell'
import { listMcpServers, buildMcpPatchRows, composeProfilePatch } from './mcpServers'

/**
 * Profile 初始化（P5.0 spike 已验证的官方路线，幂等）：
 * 1. $DSH_HOME/profiles/cad 不存在 → `--profile cad --from-default-profile sdk` 创建（--dump-config 只组合不挂载）
 * 2. profile node_modules/@deepseek-ai 与 /@cad junction 到 vendor 树（pnpm 同款作用域机制，解决 bare specifier 解析）
 * 3. 重写应用托管的 profile cordis.patch.yml（course-tools 插件 + MCP 服务器行）
 */
export async function ensureProfile(paths: DshRuntimePaths, settingsRoot: string): Promise<void> {
  const { profileDir, nodeExe, dshEntry, dshHome, vendorRoot, profile } = paths
  if (!existsSync(profileDir)) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(nodeExe, [dshEntry, '--profile', profile, '--from-default-profile', 'sdk', '--dump-config'], {
        cwd: vendorRoot,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, DSH_HOME: dshHome }
      })
      let err = ''
      child.stderr?.on('data', (c: Buffer) => {
        err += String(c)
      })
      child.on('exit', (code) => {
        if (code === 0 && existsSync(profileDir)) resolve()
        else reject(new DshError(`profile 初始化失败 (exit ${code}): ${err.slice(-400)}`))
      })
      child.on('error', reject)
    })
  }

  // junction：让 profile 作用域解析 vendor 树里的 @deepseek-ai/* 与 @cad/*（含我们的业务插件）
  const profileNm = path.join(profileDir, 'node_modules')
  for (const scope of ['@deepseek-ai', '@cad']) {
    const link = path.join(profileNm, scope)
    const target = path.join(vendorRoot, 'node_modules', scope)
    if (!existsSync(link)) {
      mkdirSync(path.dirname(link), { recursive: true })
      symlinkSync(target, link, 'junction')
    }
  }

  // 应用托管 patch：course-tools 插件 + 启用的 MCP 服务器
  const patchFile = path.join(profileDir, 'cordis.patch.yml')
  let mcpRows: string[] = []
  try {
    mcpRows = buildMcpPatchRows(await listMcpServers(settingsRoot))
  } catch (err) {
    console.error('[dsh] MCP 配置读取失败（跳过 MCP 行）:', err)
  }
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(patchFile, composeProfilePatch(mcpRows), 'utf-8')
}

/**
 * P9.6 DSH Runtime 单通道 Agent 层（架构决策 2026-11-10：AI SDK 主干已删）。
 * - spawn 独立 Node 24 + @deepseek-ai/dsh `--profile sdk`（含技能），stdio JSON-RPC
 * - 协议：initialize → session/prompt → session.event/session.status 通知；
 *   反向请求 approval/request（桥接原生对话框）、user-question/ask（暂答 cancelled）
 * - 上下文归 DSH 会话（$DSH_HOME JSONL 持久化），应用只保存 sessionId 关联
 * - stop：协议无取消方法，杀进程并在下一轮懒重启（限流手段，非安全边界）
 */

export class DshError extends Error {}

/* ===== 纯函数（可单测）：帧解析与事件映射 ===== */

/** 从缓冲中切出完整的换行分隔 JSON-RPC 帧，返回剩余不完整片段。 */
export function extractJsonFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = []
  let rest = buffer
  let idx: number
  while ((idx = rest.indexOf('\n')) >= 0) {
    const line = rest.slice(0, idx).trim()
    rest = rest.slice(idx + 1)
    if (line.length > 0) frames.push(line)
  }
  return { frames, rest }
}

interface DshContentBlock {
  type?: string
  text?: string
}

interface DshSessionEvent {
  type?: string
  data?: {
    turn?: number
    step?: number
    reason?: { kind?: string; error?: { message?: string; code?: string } }
    callId?: string
    name?: string
    arguments?: string
    message?: { content?: DshContentBlock[]; interrupted?: boolean; isError?: boolean; toolCallId?: string }
    error?: { name?: string; code?: string; reason?: string }
  }
}

/**
 * DSH session.event → 渲染层 AgentStreamEvent。
 * - assistant/message 的 text 块 → text-delta（DSH 按步推送整块文本，非逐 token）
 * - tool/call → tool-call；tool/result → tool-result（isError → tool-error）
 * - turn/end completed → finish；error → error；aborted → aborted
 */
export function mapSessionEvent(event: DshSessionEvent): AgentStreamEvent[] {
  const out: AgentStreamEvent[] = []
  const type = event.type ?? ''
  const data = event.data ?? {}
  switch (type) {
    case 'assistant/message': {
      for (const block of data.message?.content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
          out.push({ type: 'text-delta', text: block.text })
        }
        // reasoning / tool-call 块不进聊天流（工具调用有独立 tool/call 事件）
      }
      break
    }
    case 'tool/call':
      out.push({
        type: 'tool-call',
        toolCallId: data.callId ?? '',
        toolName: data.name ?? '',
        input: data.arguments ?? ''
      })
      break
    case 'tool/result': {
      const msg = data.message ?? {}
      const text = (msg.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
      if (msg.isError === true) {
        out.push({ type: 'tool-error', toolCallId: msg.toolCallId ?? data.callId ?? '', toolName: '', error: text || data.error?.reason || '工具执行失败' })
      } else {
        out.push({ type: 'tool-result', toolCallId: msg.toolCallId ?? data.callId ?? '', toolName: '', output: text })
      }
      break
    }
    case 'turn/end': {
      if (data.reason?.kind === 'error') {
        out.push({ type: 'error', message: data.reason.error?.message ?? '本轮执行出错' })
      } else if (data.reason?.kind === 'aborted') {
        out.push({ type: 'aborted' })
      } else {
        out.push({ type: 'finish', finishReason: data.reason?.kind ?? 'completed' })
      }
      break
    }
    default:
      break
  }
  return out
}

/* ===== 运行时管理 ===== */

export interface DshRuntimePaths {
  /** 独立 Node 24 可执行文件（Electron 内嵌 Node 被 require-builtin 指纹白名单拒绝） */
  nodeExe: string
  /** @deepseek-ai/dsh 的 bin.js 入口 */
  dshEntry: string
  /** vendor 根（node_modules/@cad 业务插件所在的作用域） */
  vendorRoot: string
  /** DSH_HOME（会话/配置/附件持久化根） */
  dshHome: string
  /** profile 目录（$DSH_HOME/profiles/<profile>，官方插件安装位） */
  profileDir: string
  /** 会话工作目录 */
  workspace: string
  /** 课程包根（注入插件 env CAD_COURSES_ROOT） */
  coursesRoot: string
  /** 教材资料根（注入插件 env CAD_MATERIALS_ROOT） */
  materialsRoot: string
  profile: string
}

/** 解析 DSH 运行时路径：环境变量可覆盖（dev 指向探针安装），默认取应用自带 vendor 目录。 */
export function resolveDshPaths(appPath: string, userData: string): DshRuntimePaths {
  const vendorRoot = process.env['CAD_DSH_ROOT'] ?? path.join(appPath, 'resources', 'dsh-runtime')
  const nodeExe =
    process.env['CAD_DSH_NODE'] ?? path.join(vendorRoot, 'node24', 'node.exe')
  const dshEntry =
    process.env['CAD_DSH_ENTRY'] ??
    path.join(vendorRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const profile = process.env['CAD_DSH_PROFILE'] ?? 'cad'
  const dshHome = process.env['CAD_DSH_HOME'] ?? path.join(userData, 'dsh', 'home')
  return {
    nodeExe,
    dshEntry,
    vendorRoot,
    dshHome,
    profileDir: path.join(dshHome, 'profiles', profile),
    workspace: path.join(userData, 'workspace'),
    coursesRoot: path.join(userData, 'courses'),
    materialsRoot: path.join(userData, 'materials'),
    profile
  }
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export interface DshRuntimeOptions {
  paths: DshRuntimePaths
  settingsRoot: string
  getWindow: () => BrowserWindow | null
}

export function createDshRuntime(opts: DshRuntimeOptions): {
  chat: (text: string, sessionId: string | null, sender: WebContents) => Promise<{ sessionId: string; runId: string }>
  resume: (sessionId: string) => Promise<boolean>
  abort: (runId: string) => boolean
  /** 杀掉当前进程，下一轮按最新设置懒重启（设置变更后调用）。 */
  restart: () => void
  shutdown: () => void
} {
  const { paths, settingsRoot, getWindow } = opts
  let child: ChildProcess | null = null
  let initialized = false
  let booting: Promise<void> | null = null
  let stderrTail = ''
  let buf = ''
  const pending = new Map<number, PendingRequest>()
  const activeRuns = new Map<string, { sender: WebContents; sessionId: string }>()
  let nextId = 1

  const emit = (runId: string, run: { sender: WebContents }, event: AgentStreamEvent): void => {
    if (!run.sender.isDestroyed()) {
      run.sender.send(IpcChannel.AgentEvent, { runId, event })
    }
  }

  const killProcess = (reason: string): void => {
    if (child != null) {
      try {
        child.kill()
      } catch {
        // 进程已退出
      }
      if (child.pid != null && process.platform === 'win32') {
        spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      }
    }
    child = null
    initialized = false
    booting = null
    buf = ''
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.reject(new DshError(`DSH 运行时已停止（${reason}）`))
    }
    pending.clear()
    for (const [runId, run] of activeRuns) {
      emit(runId, run, { type: 'aborted' })
    }
    activeRuns.clear()
  }

  const handleFrame = (frame: Record<string, unknown>): void => {
    const id = frame['id'] as number | undefined
    const method = frame['method'] as string | undefined
    if (id != null && method == null) {
      // 响应帧
      const p = pending.get(id)
      if (p != null) {
        pending.delete(id)
        clearTimeout(p.timer)
        if (frame['error'] != null) {
          p.reject(new DshError(`${JSON.stringify(frame['error'])}`))
        } else {
          p.resolve(frame['result'])
        }
      }
      return
    }
    if (method != null && id != null) {
      // 服务端 → 客户端请求
      const params = (frame['params'] ?? {}) as Record<string, unknown>
      if (method === 'approval/request') {
        void handleApproval(params).then((outcome) => {
          write({ jsonrpc: '2.0', id, result: { outcome } })
        })
        return
      }
      if (method === 'user-question/ask') {
        write({ jsonrpc: '2.0', id, result: { cancelled: true } })
        return
      }
      write({ jsonrpc: '2.0', id, error: { code: -32601, message: `未支持的方法 ${method}` } })
      return
    }
    if (method != null) {
      // 通知帧
      if (method === 'session.event') {
        const { sessionId, event } = frame['params'] as { sessionId: string; event: DshSessionEvent }
        for (const [runId, run] of activeRuns) {
          if (run.sessionId === sessionId) {
            for (const mapped of mapSessionEvent(event)) emit(runId, run, mapped)
          }
        }
        return
      }
      if (method === 'session.status' && (frame['params'] as { status?: string }).status === 'idle') {
        const sessionId = (frame['params'] as { sessionId: string }).sessionId
        for (const [runId, run] of activeRuns) {
          if (run.sessionId === sessionId) {
            activeRuns.delete(runId)
            emit(runId, run, { type: 'finish', finishReason: 'completed' })
          }
        }
        return
      }
      // subagent.started / session.title 等：渲染层暂不关心
    }
  }

  const handleApproval = async (params: Record<string, unknown>): Promise<string> => {
    const win = getWindow()
    if (win == null) return 'rejected'
    const toolName = String(params['toolName'] ?? '未知工具')
    const reason = params['reason'] != null ? String(params['reason']) : undefined
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['允许一次', '拒绝'],
      defaultId: 0,
      cancelId: 1,
      title: 'Agent 请求使用工具',
      message: `Agent 请求使用工具：${toolName}`,
      detail: reason ?? '（未提供说明）'
    })
    return response === 0 ? 'allowed-once' : 'rejected'
  }

  const write = (obj: Record<string, unknown>): void => {
    if (child?.stdin != null && !child.stdin.destroyed) {
      child.stdin.write(JSON.stringify(obj) + '\n')
    }
  }

  const request = <T>(method: string, params: unknown, timeoutMs = 30000): Promise<T> => {
    if (child == null || !initialized) return Promise.reject(new DshError('DSH 运行时未就绪'))
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new DshError(`DSH 请求超时: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve: resolve as (r: unknown) => void, reject, timer })
      write({ jsonrpc: '2.0', id, method, params })
    })
  }

  const boot = async (): Promise<void> => {
    if (initialized) return
    if (booting != null) return booting
    booting = (async (): Promise<void> => {
      if (!existsSync(paths.nodeExe)) {
        throw new DshError(`未找到 DSH 运行时 Node：${paths.nodeExe}（可设 CAD_DSH_NODE 覆盖）`)
      }
      if (!existsSync(paths.dshEntry)) {
        throw new DshError(`未找到 DSH 入口：${paths.dshEntry}（可设 CAD_DSH_ROOT/CAD_DSH_ENTRY 覆盖）`)
      }
      const settings = await readAgentSettings(settingsRoot)
      if (settings.apiKey == null || settings.apiKey.length === 0) {
        throw new AgentSettingsError('尚未配置 AI API Key：请点击右上角 ⚙ 填写 DeepSeek API Key')
      }
      await ensureProfile(paths, settingsRoot)

      const spawnArgs = [paths.dshEntry, '--profile', paths.profile]
      child = spawn(paths.nodeExe, spawnArgs, {
        cwd: paths.workspace,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DSH_HOME: paths.dshHome,
          // 权限档位预设（DSH 原生联动：沙箱模式 + 审批策略）
          DSH_PERMISSION_MODE: settings.permissionMode,
          DSH_SYSTEM_PROMPT:
            '你是 Code Academy Desk（教材驱动的桌面编程学习工作台）的 AI 助教。中文回复；引用教材内容必须带页码；教材没有的内容不得发明；AI 补充的内容必须显式标注"AI 补充"。',
          DEEPSEEK_API_KEY: settings.apiKey,
          // 业务插件 @cad/course-tools 的数据根（课程包/教材资料）
          CAD_COURSES_ROOT: paths.coursesRoot,
          CAD_MATERIALS_ROOT: paths.materialsRoot,
          ...(settings.baseUrl != null ? { DEEPSEEK_BASE_URL: settings.baseUrl } : {})
        }
      })

      child.stdout!.setEncoding('utf-8')
      child.stdout!.on('data', (chunk: string) => {
        buf += chunk
        const { frames, rest } = extractJsonFrames(buf)
        buf = rest
        for (const f of frames) {
          try {
            handleFrame(JSON.parse(f) as Record<string, unknown>)
          } catch (err) {
            console.error('[dsh] 非协议帧:', String(f).slice(0, 200), err)
          }
        }
      })
      child.stderr!.setEncoding('utf-8')
      child.stderr!.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-4000)
      })
      child.on('exit', (code) => {
        const hadRuns = activeRuns.size > 0
        killProcess(`进程退出 code=${code}`)
        if (hadRuns || (code !== 0 && code !== null)) {
          console.error('[dsh] stderr 尾部:', stderrTail.slice(-1500))
        }
      })

      await request<{ serverInfo: { name: string; version: string } }>(
        'initialize',
        {
          cwd: paths.workspace,
          approvalRequests: true,
          provider: 'deepseek-official',
          model: settings.model
        },
        60000
      )
      initialized = true
      stderrTail = ''
    })()
    try {
      await booting
    } finally {
      if (initialized) booting = null
      else booting = null
    }
  }

  const chat = async (
    text: string,
    sessionId: string | null,
    sender: WebContents
  ): Promise<{ sessionId: string; runId: string }> => {
    if (text.trim().length === 0) throw new DshError('消息为空')
    await boot()
    const sid = sessionId ?? `cad-${randomUUID()}`
    const runId = randomUUID()
    activeRuns.set(runId, { sender, sessionId: sid })
    try {
      await request<{ messageId: string }>(
        'session/prompt',
        { sessionId: sid, contentBlocks: [{ type: 'text', text }] },
        30000
      )
    } catch (err) {
      activeRuns.delete(runId)
      // 已存在的会话（跨重启复用 id）尝试 resume 后重试一次
      if (err instanceof DshError && err.message.includes('already exists')) {
        await request<Record<string, never>>('session/resume', { sessionId: sid }, 30000)
        activeRuns.set(runId, { sender, sessionId: sid })
        await request<{ messageId: string }>(
          'session/prompt',
          { sessionId: sid, contentBlocks: [{ type: 'text', text }] },
          30000
        )
      } else {
        throw err
      }
    }
    return { sessionId: sid, runId }
  }

  const resume = async (sessionId: string): Promise<boolean> => {
    await boot()
    try {
      await request<Record<string, never>>('session/resume', { sessionId }, 30000)
      return true
    } catch {
      return false
    }
  }

  const abort = (runId: string): boolean => {
    // 协议未提供取消方法：杀进程（下一轮懒重启），已入队 token 会中断
    if (activeRuns.has(runId)) {
      killProcess('用户中止')
      return true
    }
    return false
  }

  const shutdown = (): void => {
    if (child != null && initialized) {
      try {
        write({ jsonrpc: '2.0', id: nextId++, method: 'shutdown', params: undefined })
      } catch {
        // stdin 已关
      }
    }
    killProcess('应用退出')
  }

  const restart = (): void => {
    if (child != null) killProcess('设置变更')
  }

  return { chat, resume, abort, restart, shutdown }
}

export { AgentSettingsError, ShellError }
