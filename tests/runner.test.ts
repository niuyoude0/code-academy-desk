import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, existsSync, readdirSync, statSync } from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'
import {
  runExercise,
  runScript,
  normalizeRunnerLanguage,
  normalizeOutput,
  parseFiles,
  RunnerError
} from '../src/main/services/runner'

/**
 * P8 统一 Runner 核心测试（真实本机执行，零 AI 消耗）：
 *  - python / javascript 档位全链路：stdin 喂入 → stdout 归一比对
 *  - 超时杀树 / 归一化 / 路径安全 / 语言白名单
 *  - gcc 缺失 → 编译器提示错误（本机无 gcc；若装了则跳过该用例）
 */

let tmpRoot: string
const node24 = path.join(__dirname, '..', 'resources', 'dsh-runtime', 'node24', 'node.exe')
const hasNode24 = existsSync(node24)

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-runner-'))
})

function py(files: Record<string, string>, tests: unknown[]): Promise<unknown> {
  return runExercise({
    workspaceRoot: tmpRoot,
    courseId: 't1',
    exerciseId: 'ex1',
    language: 'python',
    files: Object.entries(files).map(([p, content]) => ({ path: p, content, readOnly: false })),
    tests
  })
}

describe('P8 runner：python 档位', () => {
  it('stdin 喂入 + stdout 归一比对：通过 / 不通过 / 超时', async () => {
    const r = (await py(
      { 'main.py': 'n = int(input())\nprint(n * 2)\n' },
      [
        { id: 't1', name: '正常', input: '21\n', expectedOutput: '42' },
        { id: 't2', name: '负数', input: '-3\n', expectedOutput: '-6' }
      ]
    )) as import('../src/shared/ipc').RunResult
    expect(r.language).toBe('python')
    expect(r.passedAll).toBe(true)
    expect(r.results).toHaveLength(2)
    expect(r.results.every((x) => x.passed)).toBe(true)
    expect(r.entryPath).toBe('main.py')

    // 期望不一致 → failed，actual/expected 保留供对照
    const bad = (await py({ 'main.py': 'print(input())\n' }, [
      { id: 't1', name: '错', input: 'abc\n', expectedOutput: 'xyz' }
    ])) as import('../src/shared/ipc').RunResult
    expect(bad.passedAll).toBe(false)
    expect(bad.results[0]).toMatchObject({ passed: false, expected: 'xyz', actual: 'abc' })

    // 死循环 → timedOut 杀树（真实 3s 超时）
    const loop = (await py({ 'main.py': 'while True:\n    pass\n' }, [
      { id: 't1', name: '挂死', input: '', expectedOutput: '' }
    ])) as import('../src/shared/ipc').RunResult
    expect(loop.results[0].timedOut).toBe(true)
    expect(loop.results[0].passed).toBe(false)
  }, 30_000)

  it('多文件 + 子目录起步文件；运行产物留在 runs/<courseId>/<exerciseId>/', async () => {
    const r = (await py(
      {
        'main.py': 'import util.helper as h\nprint(h.twice(input().strip()))\n',
        'util/helper.py': 'def twice(s):\n    return s * 2\n',
        'README.md': '只读材料不参与执行'
      },
      [{ id: 't1', name: '拼接', input: 'ab\n', expectedOutput: 'abab' }]
    )) as import('../src/shared/ipc').RunResult
    expect(r.passedAll).toBe(true)
    const dir = path.join(tmpRoot, 'runs', 't1', 'ex1')
    expect(existsSync(path.join(dir, 'main.py'))).toBe(true)
    expect(existsSync(path.join(dir, 'util', 'helper.py'))).toBe(true)
    expect(existsSync(path.join(dir, 'README.md'))).toBe(true)
  })

  it('非法输入拒绝：路径穿越 / 绝对路径 / 缺 entry / 语言白名单外', async () => {
    // '../' 被 CodeFile 正则先拒（ZodError）；断言只要求拒绝
    await expect(
      py({ '../escape.py': 'x' }, [])
    ).rejects.toThrow()
    await expect(
      runExercise({
        workspaceRoot: tmpRoot,
        courseId: 't1',
        exerciseId: 'ex1',
        language: 'python',
        files: [{ path: 'C:/abs/x.py', content: 'x', readOnly: false }],
        tests: []
      })
    ).rejects.toThrow() // CodeFile 正则（无冒号）或 assertSafeRel 任一层拦截
    await expect(
      runExercise({
        workspaceRoot: tmpRoot,
        courseId: 't1',
        exerciseId: 'ex1',
        language: 'python',
        files: [{ path: 'main.js', content: 'x', readOnly: false }],
        tests: []
      })
    ).rejects.toThrow(/没有 \.py 文件/)
    await expect(
      runExercise({
        workspaceRoot: tmpRoot,
        courseId: 't1',
        exerciseId: 'ex1',
        language: 'ruby',
        files: [{ path: 'main.rb', content: 'x', readOnly: false }],
        tests: []
      })
    ).rejects.toThrow(/不支持的执行语言/)
    await expect(
      runExercise({
        workspaceRoot: tmpRoot,
        courseId: '../bad',
        exerciseId: 'ex1',
        language: 'python',
        files: [{ path: 'main.py', content: 'x', readOnly: false }],
        tests: []
      })
    ).rejects.toThrow(/非法课程/)
  })
})

describe('P8 runner：javascript 档位（vendor node24 优先）', () => {
  it('node24 直跑 stdin/stdout 判定', async () => {
    if (!hasNode24) return // vendor 缺失时回退 PATH node，本用例仍应工作
    const r = (await runExercise({
      workspaceRoot: tmpRoot,
      courseId: 't2',
      exerciseId: 'ex-js',
      language: 'js',
      files: [{ path: 'main.js', content: 'let s = 0\nfor (const line of require("fs").readFileSync(0, "utf-8").split("\\n")) { if (line.trim()) s += Number(line) }\nconsole.log(s)\n', readOnly: false }],
      tests: [
        { id: 't1', name: '求和', input: '1\n2\n3\n', expectedOutput: '6' },
        { id: 't2', name: '空输入', input: '', expectedOutput: '0' }
      ],
      node24Path: node24
    })) as import('../src/shared/ipc').RunResult
    expect(r.passedAll).toBe(true)
    expect(r.language).toBe('javascript')
  })
})

describe('P8 runner：c 档位（本机无 gcc → 编译器提示）', () => {
  it('gcc 缺失时报可读错误', async () => {
    const probe = spawnSync('gcc', ['--version'], { timeout: 8000, windowsHide: true })
    if (probe.status === 0) return // 本机装了 gcc 则跳过缺失路径
    await expect(
      runExercise({
        workspaceRoot: tmpRoot,
        courseId: 't3',
        exerciseId: 'ex-c',
        language: 'c',
        files: [{ path: 'main.c', content: 'int main(void){return 0;}', readOnly: false }],
        tests: [{ id: 't1', name: 'x', input: '', expectedOutput: '' }]
      })
    ).rejects.toThrow(/gcc|未找到/)
  })
})

describe('P8 runner：纯函数', () => {
  it('normalizeOutput：CRLF/行尾空白/末尾空行归一', () => {
    expect(normalizeOutput('a \r\nb\t\r\n\r\n')).toBe('a\nb')
    expect(normalizeOutput('42')).toBe('42')
    expect(normalizeOutput('')).toBe('')
  })
  it('normalizeRunnerLanguage 别名与拒绝', () => {
    expect(normalizeRunnerLanguage('Python')).toBe('python')
    expect(normalizeRunnerLanguage('python3')).toBe('python')
    expect(normalizeRunnerLanguage('py')).toBe('python')
    expect(normalizeRunnerLanguage('JS')).toBe('javascript')
    expect(normalizeRunnerLanguage('node')).toBe('javascript')
    expect(normalizeRunnerLanguage('C')).toBe('c')
    expect(() => normalizeRunnerLanguage('ruby')).toThrow(RunnerError)
  })
  it('parseFiles：zod 校验（内容上限/路径正则/readOnly 缺省）', () => {
    const files = parseFiles([{ path: 'a/b.py', content: 'x' }])
    expect(files[0]).toMatchObject({ path: 'a/b.py', readOnly: false })
    expect(() => parseFiles([{ path: '../x.py', content: 'x' }])).toThrow()
    expect(() => parseFiles('not-array')).toThrow(RunnerError)
    // runs 目录只允许 courseId 一层（路径限定自证）
    const runs = path.join(tmpRoot, 'runs')
    if (existsSync(runs)) {
      expect(readdirSync(runs).every((d) => /^[\w\-]+$/.test(d))).toBe(true)
    }
    void statSync
  })
})

describe('P8 通用单文件执行（runScript，文件工作区「运行」）', () => {
  it('python stdout/退出码捕获；js node24 档位', async () => {
    const r = (await runScript({
      workspaceRoot: tmpRoot,
      courseId: 't1',
      fileName: 'scratch.py',
      content: 'print(6 * 7)\n'
    })) as import('../src/shared/ipc').ScriptRunResult
    expect(r.language).toBe('python')
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('42')
    expect(r.stderr).toBe('')

    if (!hasNode24) return
    const j = (await runScript({
      workspaceRoot: tmpRoot,
      courseId: 't1',
      fileName: 'scratch.js',
      content: 'console.log("ok", 1 + 1)\n',
      node24Path: node24
    })) as import('../src/shared/ipc').ScriptRunResult
    expect(j.language).toBe('javascript')
    expect(j.stdout.trim()).toBe('ok 2')
  }, 30_000)

  it('非零退出码与 stderr 保留；超时杀树；非法扩展名拒绝', async () => {
    const bad = (await runScript({
      workspaceRoot: tmpRoot,
      courseId: 't1',
      fileName: 'boom.py',
      content: 'import sys\nprint("to-out")\nsys.stderr.write("to-err")\nsys.exit(3)\n'
    })) as import('../src/shared/ipc').ScriptRunResult
    expect(bad.exitCode).toBe(3)
    expect(bad.stdout.trim()).toBe('to-out')
    expect(bad.stderr).toContain('to-err')

    const loop = (await runScript({
      workspaceRoot: tmpRoot,
      courseId: 't1',
      fileName: 'hang.py',
      content: 'while True:\n    pass\n',
      timeoutMs: 3000
    })) as import('../src/shared/ipc').ScriptRunResult
    expect(loop.timedOut).toBe(true)

    await expect(
      runScript({ workspaceRoot: tmpRoot, courseId: 't1', fileName: 'doc.md', content: 'x' })
    ).rejects.toThrow(/不支持的执行语言/)
  }, 30_000)
})
