import { spawn } from 'child_process'
import { existsSync } from 'fs'

/**
 * 本机 shell 执行工具（与 AI 框架无关，P8 统一 Runner 直接复用）：
 *  - PowerShell/cmd 直跑
 *  - 超时 taskkill /T /F 强杀整棵进程树
 *  - UTF-8 强制 + GBK 解码兜底（zh-CN 控制台 OEM 936）
 *  - 输出限幅
 */

export const MAX_OUTPUT_CHARS = 64_000
export const DEFAULT_TIMEOUT_MS = 60_000
export const MAX_TIMEOUT_MS = 300_000

export interface CommandOutcome {
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  stdout: string
  stderr: string
  durationMs: number
}

export class ShellError extends Error {}

/** UTF-8 优先解码；出现替换符时按 GBK 重试（cmd/旧 PS 的 OEM 936 兜底）。 */
export function decodeConsoleOutput(buf: Buffer): string {
  const utf8 = buf.toString('utf-8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    const gbk = new TextDecoder('gbk').decode(buf)
    if (!gbk.includes('\uFFFD')) return gbk
  } catch {
    // ICU 缺 GBK 编码表时保持 utf-8 结果
  }
  return utf8
}

function capOutput(text: string, used: { truncated: boolean }): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text
  used.truncated = true
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[输出超限，已截断]`
}

/**
 * 执行一条 shell 命令并等待退出。
 * - powershell：首句强制 UTF-8（PS 5.1 控制台默认 OEM 936）
 * - 超时：taskkill /pid <pid> /T /F 强杀整棵进程树
 * - stdin 关闭，避免交互式命令挂住循环
 */
export function runShellCommand(opts: {
  command: string
  shell?: 'powershell' | 'cmd'
  timeoutMs?: number
  cwd?: string
}): Promise<CommandOutcome> {
  const shell = opts.shell ?? 'powershell'
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS)
  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : undefined

  const finalCommand =
    shell === 'powershell'
      ? `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; ${opts.command}`
      : opts.command
  const child =
    shell === 'cmd'
      ? spawn('cmd.exe', ['/d', '/s', '/c', finalCommand], {
          cwd,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      : spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', finalCommand],
          { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        )

  const used = { truncated: false }
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const startedAt = Date.now()
  let timedOut = false
  let settled = false

  return new Promise<CommandOutcome>((resolve) => {
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        exitCode: child.exitCode,
        timedOut,
        truncated: used.truncated,
        stdout: capOutput(decodeConsoleOutput(Buffer.concat(stdoutChunks)), used),
        stderr: capOutput(decodeConsoleOutput(Buffer.concat(stderrChunks)), used),
        durationMs: Date.now() - startedAt
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid != null) {
        // 强杀整棵进程树（子进程一并结束）
        spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      }
      // /F 强杀后 close 事件理应立刻到达；再加一层兜底
      setTimeout(finish, 5000)
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', (err) => {
      stderrChunks.push(Buffer.from(`进程启动失败: ${String(err)}`, 'utf-8'))
      finish()
    })
    child.on('close', finish)
  })
}
