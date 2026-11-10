import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, existsSync } from 'fs'
import path from 'path'
import os from 'os'
import {
  listWorkspaceTree,
  readWorkspaceFile,
  writeWorkspaceFile,
  WorkspaceError
} from '../src/main/services/workspaceFs'

/**
 * P7 文件工作区服务测试（真实本机执行，零 AI 消耗）：
 *  - 写入/读取/树列表 + 子目录
 *  - 路径限定：穿越/绝对路径/反斜杠/空段拒绝
 *  - isomorphic-git 快照：写入生成 commit（best-effort，成功时返回 oid）
 */

let tmpRoot: string

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'cad-ws-'))
})

describe('P7 workspaceFs', () => {
  it('写入+读取+树列表（含子目录）；写入生成 git 快照', async () => {
    const w = await writeWorkspaceFile(tmpRoot, 't1', 'notes.md', '# hello\n')
    expect(w.commit).not.toBe(null)
    expect(w.commit).toMatch(/^[0-9a-f]{40}$/)

    await writeWorkspaceFile(tmpRoot, 't1', 'src/main.py', 'print(1)\n')
    const r = await readWorkspaceFile(tmpRoot, 't1', 'src/main.py')
    expect(r.content).toBe('print(1)\n')

    const tree = await listWorkspaceTree(tmpRoot, 't1')
    expect(tree.map((n) => n.path)).toContain('notes.md')
    expect(tree.map((n) => n.path)).toContain('src')
    expect(tree.map((n) => n.path)).toContain('src/main.py')
    expect(tree.every((n) => !n.path.startsWith('.git'))).toBe(true)
    // .git 目录被过滤
    expect(existsSync(path.join(tmpRoot, 'files', 't1', '.git'))).toBe(true)
  })

  it('空课程返回空树；未存在文件读取报错', async () => {
    expect(await listWorkspaceTree(tmpRoot, 'empty-course')).toEqual([])
    await expect(readWorkspaceFile(tmpRoot, 't1', 'missing.md')).rejects.toThrow(/不存在/)
  })

  it('路径限定：穿越/绝对路径/反斜杠/空段拒绝', async () => {
    await expect(writeWorkspaceFile(tmpRoot, 't1', '../escape.md', 'x')).rejects.toThrow(/非法路径/)
    await expect(writeWorkspaceFile(tmpRoot, 't1', '/abs.md', 'x')).rejects.toThrow(/非法路径/)
    await expect(writeWorkspaceFile(tmpRoot, 't1', 'a\\\\b.md', 'x')).rejects.toThrow(/非法路径/)
    await expect(writeWorkspaceFile(tmpRoot, 't1', 'a//b.md', 'x')).rejects.toThrow(/非法路径/)
    await expect(writeWorkspaceFile(tmpRoot, 't1', 'a/../b.md', 'x')).rejects.toThrow(/非法路径/)
    await expect(readWorkspaceFile(tmpRoot, '../other', 'x.md')).rejects.toThrow(/非法课程/)
    // 二次快照（同一课程多次写入）依然成功
    const w2 = await writeWorkspaceFile(tmpRoot, 't1', 'notes.md', '# hello v2\n')
    expect(w2.commit).not.toBe(null)
  })

  it('非课程 id 拒绝；内容超限拒绝', async () => {
    await expect(listWorkspaceTree(tmpRoot, '..')).rejects.toThrow(/非法课程/)
    await expect(writeWorkspaceFile(tmpRoot, 't1', 'big.md', 'x'.repeat(513 * 1024))).rejects.toThrow(/512KB/)
  })
})
