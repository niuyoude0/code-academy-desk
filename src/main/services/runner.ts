import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import { CodeFile, type CodeFile as CodeFileType } from '../../shared/course-schema'
import type { RunResult, RunnerTestResult } from '../../shared/ipc'
import { MAX_OUTPUT_CHARS, decodeConsoleOutput } from './shell'

/**
 * P8 统一 Runner 核心（P5.8 编程题判定复用）：
 *  - 每次运行 = 独立工作区 <workspaceRoot>/runs/<courseId>/<exerciseId>/（先清空重写，产物留作排查）
 *  - 语言档位：python（PATH）/ c（gcc 编译 + 运行）/ javascript（vendor node24 优先，缺省 PATH node）
 *  - 判定 = stdin 喂 TestCase.input，stdout 归一比对 expectedOutput（\r\n→\n、去行尾空白、去末尾空行）
 *  - 超时 taskkill /T /F 杀整棵进程树（与 shell.ts 同款）；输出限幅 64KB
 *  - 代码本机直跑（产品既定方向：本地判题不做沙箱）；执行与写盘全部限定在 runs/ 子目录内
 */

const DEFAULT_TEST_TIMEOUT_MS = 10_000
const MAX_TEST_TIMEOUT_MS = 60_000
const MAX_FILES = 100

export class RunnerError extends Error {}

export type RunnerLanguage = 'python' | 'c' | 'javascript'

/** 语言归一：'py'/'python3'→python，'js'/'node'→javascript；白名单外拒绝。 */
export function normalizeRunnerLanguage(raw: string): RunnerLanguage {
  const l = raw.trim().toLowerCase()
  if (l === 'python' || l === 'py' || l === 'python3') return 'python'
  if (l === 'c') return 'c'
  if (l === 'javascript' || l === 'js' || l === 'node') return 'javascript'
  throw new RunnerError(`不支持的执行语言: ${raw}（当前档位 python/c/javascript）`)
}

function assertSafeRel(p: string): string {
  const norm = path.posix.normalize(p.replaceAll('\\', '/'))
  if (
    !/^[\w\-][\w\-. /]*$/.test(norm) ||
    norm.startsWith('..') ||
    norm.includes('../') ||
    path.posix.isAbsolute(norm) ||
    /^[a-zA-Z]:/.test(norm) ||
    norm.length === 0
  ) {
    throw new RunnerError(`非法工作区文件路径: ${p}`)
  }
  return norm
}

/** 校验并归一用户/课件提交的文件集（CodeFile schema：512KB/路径正则/readOnly 默认）。 */
export function parseFiles(raw: unknown): CodeFileType[] {
  if (!Array.isArray(raw) || raw.length > MAX_FILES) {
    throw new RunnerError(`文件数非法（1–${MAX_FILES}）`)
  }
  return raw.map((f) => CodeFile.parse(f))
}

/** entry 定位：python/js 取第一个对应扩展名文件；c 取全部 .c（GCC 一起编译）。 */
function pickEntries(files: CodeFileType[], language: RunnerLanguage): CodeFileType[] {
  const ext = language === 'python' ? '.py' : language === 'c' ? '.c' : '.js'
  const hits = files.filter((f) => assertSafeRel(f.path).toLowerCase().endsWith(ext))
  if (hits.length === 0) {
    throw new RunnerError(`起步文件中没有 .${ext.slice(1)} 文件（语言 ${language}）`)
  }
  return language === 'c' ? hits : [hits[0]]
}

/* ===== spawn 直跑（不经 shell，杜绝引号转义面）+ 超时杀树 ===== */

interface ExecOutcome {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  durationMs: number
}

function execWithTimeout(opts: {
  command: string
  args: string[]
  cwd: string
  input?: string
  timeoutMs: number
  env?: Record<string, string>
}): Promise<ExecOutcome> {
  const timeoutMs = Math.min(Math.max(opts.timeoutMs, 1000), MAX_TEST_TIMEOUT_MS)
  const child = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env }
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const startedAt = Date.now()
  let timedOut = false
  let settled = false

  return new Promise<ExecOutcome>((resolve) => {
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        exitCode: child.exitCode,
        timedOut,
        stdout: decodeConsoleOutput(Buffer.concat(stdoutChunks)).slice(0, MAX_OUTPUT_CHARS),
        stderr: decodeConsoleOutput(Buffer.concat(stderrChunks)).slice(0, MAX_OUTPUT_CHARS),
        durationMs: Date.now() - startedAt
      })
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid != null) {
        spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      }
      setTimeout(finish, 5000)
    }, timeoutMs)
    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c))
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c))
    if (opts.input != null) {
      child.stdin.write(opts.input)
    }
    child.stdin.end()
    child.on('error', (err) => {
      stderrChunks.push(Buffer.from(`进程启动失败: ${String(err)}`, 'utf-8'))
      finish()
    })
    child.on('close', finish)
  })
}

/** stdout/expected 归一比对：CRLF→LF、去行尾空白、去末尾空行。 */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

async function resolveNodeCommand(candidates: string[]): Promise<string> {
  for (const cmd of candidates) {
    if (cmd.includes('\\') || cmd.includes('/')) {
      if (existsSync(cmd)) return cmd
    } else {
      return cmd // PATH 上的命令名：交给 spawn 报错兜底
    }
  }
  throw new RunnerError('没有可用的 Node 运行时（vendor node24 与 PATH node 均缺失）')
}

async function assertCommandAvailable(command: string, args: string[], hint: string): Promise<void> {
  const probe = await execWithTimeout({ command, args, cwd: process.cwd(), timeoutMs: 8000 })
  if (probe.exitCode !== 0 && probe.stderr.includes('进程启动失败')) {
    throw new RunnerError(`未找到 ${command}：${hint}`)
  }
}

export interface RunExerciseInput {
  workspaceRoot: string
  courseId: string
  exerciseId: string
  language: string
  files: unknown
  tests: unknown[]
  timeoutMs?: number
  /** vendor node24 绝对路径（javascript 档位优先）；缺省回退 PATH node */
  node24Path?: string
}

/** 跑一个编程题：写工作区 → （C 先编译）→ 逐测试 stdin/stdout 判定。 */
export async function runExercise(input: RunExerciseInput): Promise<RunResult> {
  if (!/^[\w\-]+$/.test(input.courseId) || !/^[\w\-]+$/.test(input.exerciseId)) {
    throw new RunnerError('非法课程/练习 id')
  }
  const language = normalizeRunnerLanguage(input.language)
  const files = parseFiles(input.files)
  const entries = pickEntries(files, language)
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS, 1000), MAX_TEST_TIMEOUT_MS)

  const runDir = path.join(input.workspaceRoot, 'runs', input.courseId, input.exerciseId)
  await fs.rm(runDir, { recursive: true, force: true })
  await fs.mkdir(runDir, { recursive: true })
  for (const f of files) {
    const abs = path.join(runDir, assertSafeRel(f.path))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, f.content, 'utf-8')
  }

  const startedAt = Date.now()
  const env: Record<string, string> =
    language === 'python' ? { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } : {}

  let compile: RunResult['compile']
  let runCommand: string
  let runArgs: string[]

  if (language === 'c') {
    await assertCommandAvailable('gcc', ['--version'], '请安装 MinGW-w64 并把 gcc 加入 PATH')
    const outExe = 'main.exe'
    const compileRes = await execWithTimeout({
      command: 'gcc',
      args: [...entries.map((e) => assertSafeRel(e.path)), '-o', outExe],
      cwd: runDir,
      timeoutMs: Math.max(timeoutMs, 30_000)
    })
    compile = { ok: compileRes.exitCode === 0, output: `${compileRes.stdout}\n${compileRes.stderr}`.trim() }
    if (!compile.ok) {
      return { language, compile, results: [], passedAll: false, totalRunMs: Date.now() - startedAt, entryPath: entries[0].path }
    }
    runCommand = path.join(runDir, outExe)
    runArgs = []
  } else if (language === 'python') {
    await assertCommandAvailable('python', ['--version'], '请安装 Python 并加入 PATH')
    runCommand = 'python'
    runArgs = [assertSafeRel(entries[0].path)]
  } else {
    runCommand = await resolveNodeCommand([
      input.node24Path ?? '',
      'node'
    ].filter((s) => s !== ''))
    runArgs = [assertSafeRel(entries[0].path)]
  }

  const results: RunnerTestResult[] = []
  for (const t of input.tests as { id?: unknown; name?: unknown; input?: unknown; expectedOutput?: unknown }[]) {
    if (t == null || typeof t.id !== 'string' || typeof t.expectedOutput !== 'string') continue
    const res = await execWithTimeout({
      command: runCommand,
      args: runArgs,
      cwd: runDir,
      input: typeof t.input === 'string' ? t.input : '',
      timeoutMs,
      env
    })
    const actual = normalizeOutput(res.stdout)
    const expected = normalizeOutput(t.expectedOutput)
    results.push({
      id: t.id,
      name: typeof t.name === 'string' ? t.name : t.id,
      passed: !res.timedOut && res.exitCode === 0 && actual === expected,
      expected,
      actual,
      stderr: res.stderr,
      timedOut: res.timedOut,
      durationMs: res.durationMs
    })
  }

  return {
    language,
    ...(compile != null ? { compile } : {}),
    results,
    passedAll: results.length > 0 && results.every((r) => r.passed),
    totalRunMs: Date.now() - startedAt,
    entryPath: entries[0].path
  }
}

/* ===== P8 收尾：通用单文件执行（文件工作区「运行」按钮） ===== */

export interface ScriptRunResult {
  language: RunnerLanguage
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
}

export interface RunScriptInput {
  workspaceRoot: string
  courseId: string
  /** 文件名（含扩展名；展平到 scratch 目录执行） */
  fileName: string
  content: string
  timeoutMs?: number
  node24Path?: string
}

/** 通用单文件运行：无判定，捕获 stdout/stderr/退出码。复用 runExercise 的沙盒与超时杀树设施。 */
export async function runScript(input: RunScriptInput): Promise<ScriptRunResult> {
  if (!/^[\w\-]+$/.test(input.courseId)) {
    throw new RunnerError('非法课程 id')
  }
  const name = assertSafeRel(input.fileName)
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const language = normalizeRunnerLanguage(
    ext === '.py' ? 'python' : ext === '.js' ? 'javascript' : ext === '.c' ? 'c' : ext.replace(/^\./, '')
  )
  if (Buffer.byteLength(input.content, 'utf-8') > 512 * 1024) {
    throw new RunnerError('内容超过 512KB 上限')
  }

  const runDir = path.join(input.workspaceRoot, 'runs', input.courseId, '_scratch')
  await fs.rm(runDir, { recursive: true, force: true })
  await fs.mkdir(runDir, { recursive: true })
  await fs.writeFile(path.join(runDir, name), input.content, 'utf-8')

  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS, 1000), MAX_TEST_TIMEOUT_MS)
  const env: Record<string, string> =
    language === 'python' ? { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } : {}
  const startedAt = Date.now()

  let runCommand: string
  let runArgs: string[]

  if (language === 'c') {
    await assertCommandAvailable('gcc', ['--version'], '请安装 MinGW-w64 并把 gcc 加入 PATH')
    const compileRes = await execWithTimeout({
      command: 'gcc',
      args: [name, '-o', 'main.exe'],
      cwd: runDir,
      timeoutMs: Math.max(timeoutMs, 30_000)
    })
    if (compileRes.exitCode !== 0) {
      return {
        language,
        stdout: '',
        stderr: `编译失败:\n${compileRes.stdout}\n${compileRes.stderr}`.trim(),
        exitCode: compileRes.exitCode,
        timedOut: false,
        durationMs: Date.now() - startedAt
      }
    }
    runCommand = path.join(runDir, 'main.exe')
    runArgs = []
  } else if (language === 'python') {
    await assertCommandAvailable('python', ['--version'], '请安装 Python 并加入 PATH')
    runCommand = 'python'
    runArgs = [name]
  } else {
    runCommand = await resolveNodeCommand([input.node24Path ?? '', 'node'].filter((s) => s !== ''))
    runArgs = [name]
  }

  const res = await execWithTimeout({ command: runCommand, args: runArgs, cwd: runDir, timeoutMs, env })
  return {
    language,
    stdout: res.stdout,
    stderr: res.stderr,
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    durationMs: res.durationMs
  }
}
